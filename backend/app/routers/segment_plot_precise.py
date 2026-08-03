"""
Precise-shape click-to-segment-and-track plot boundary endpoint.

Upgrade over /segment-plot: that endpoint reduces SAM's mask to a bounding
box and tracks the box with CSRT, which loses the actual curved/irregular
shape of the plot. This endpoint instead:

  1. SAM (Segment Anything) - click a point, get a precise polygon boundary
     on that frame (same predictor as /segment-plot, reused via
     app.routers.segment_plot.get_predictor() to avoid loading SAM twice on
     a 4GB VRAM card).
  2. Optical flow (cv2.goodFeaturesToTrack + calcOpticalFlowPyrLK) tracks
     camera motion across the frame - not just inside the plot - so the
     motion estimate stays stable even as the plot itself scrolls out of a
     feature-rich region.
  3. Homography (cv2.findHomography, RANSAC) turns that motion into a single
     transform per frame, which is used to warp SAM's ORIGINAL polygon
     forward. This follows the real curved boundary, not an approximated
     rectangle.

NOT YET INDEPENDENTLY VERIFIED ON THIS MACHINE. A similar approach was
sandbox-tested in a separate session and reportedly held up with no visible
drift across a 15s clip, but that result has not been reproduced here. Treat
MAX_TRACK_SECONDS below as a conservative placeholder (matching the
proven-reliable CSRT box window from /segment-plot) until this endpoint is
actually tested end-to-end and the real drift point is found by eye, the
same way the box version's limit was established.

Setup: same as /segment-plot (segment-anything, torch, opencv-python-headless
with contrib for optical flow - contrib not strictly required here since we
don't use TrackerCSRT, but keep it installed for /segment-plot compatibility).

Add to main.py:
    from app.routers import segment_plot_precise
    app.include_router(segment_plot_precise.router)
"""

import os
import tempfile
import uuid
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import MINIO_BUCKET
from app.routers.uploads import minio_client
from app.routers.segment_plot import get_predictor, CHECKPOINT_PATH, MODEL_TYPE

router = APIRouter()

MAX_TRACK_SECONDS = 18.0

MAX_CORNERS = 200
QUALITY_LEVEL = 0.01
MIN_DISTANCE = 7
MIN_SURVIVING_FEATURES = 30
RESEED_EVERY_N_FRAMES = 15
RANSAC_REPROJ_THRESHOLD = 5.0

POLY_EPSILON_FRACTION = 0.006


def download_video_to_temp(object_name: str) -> str:
    tmp_path = os.path.join(tempfile.gettempdir(), f"segplotprecise_{uuid.uuid4().hex}.mp4")
    minio_client.fget_object(MINIO_BUCKET, object_name, tmp_path)
    return tmp_path


def extract_polygon(mask: np.ndarray) -> np.ndarray:
    mask_uint8 = (mask.astype(np.uint8)) * 255
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise HTTPException(status_code=422, detail="Could not extract a polygon from the SAM mask")
    largest = max(contours, key=cv2.contourArea)
    epsilon = POLY_EPSILON_FRACTION * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, epsilon, True)
    return approx.reshape(-1, 2).astype(np.float32)


def run_sam_with_fallback(predictor, frame_rgb: np.ndarray, click_x: int, click_y: int):
    point_coords = np.array([[click_x, click_y]])
    point_labels = np.array([1])
    try:
        masks, scores, _ = predictor.predict(
            point_coords=point_coords, point_labels=point_labels, multimask_output=True
        )
    except Exception as e:
        if "out of memory" in str(e).lower() or "cuda" in str(e).lower():
            print("CUDA Out Of Memory or CUDA error during SAM inference. Falling back to CPU...")
            try:
                import torch
                from segment_anything import sam_model_registry, SamPredictor
                torch.cuda.empty_cache()
                sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
                sam.to("cpu")
                predictor = SamPredictor(sam)
                predictor.set_image(frame_rgb)
                masks, scores, _ = predictor.predict(
                    point_coords=point_coords, point_labels=point_labels, multimask_output=True
                )
            except Exception as ex_cpu:
                raise ex_cpu
        else:
            raise e
    return masks, scores


class SegmentPlotPreciseRequest(BaseModel):
    object_name: str
    click_x: int
    click_y: int
    click_time: float
    track_seconds: float = MAX_TRACK_SECONDS


class PolygonFrame(BaseModel):
    time: float
    points_pct: List[Tuple[float, float]]


class SegmentPlotPreciseResponse(BaseModel):
    initial_mask_score: float
    frame_width: int
    frame_height: int
    path: List[PolygonFrame]
    warning: Optional[str] = None


@router.post("/segment-plot-precise", response_model=SegmentPlotPreciseResponse)
async def segment_plot_precise(req: SegmentPlotPreciseRequest):
    print(f"[DEBUG] Received /segment-plot-precise request: object_name={req.object_name}, click_x={req.click_x}, click_y={req.click_y}, click_time={req.click_time}")
    clamped = req.track_seconds > MAX_TRACK_SECONDS
    track_seconds = min(req.track_seconds, MAX_TRACK_SECONDS)

    video_path = download_video_to_temp(req.object_name)
    cap = None
    try:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        click_frame_idx = int(req.click_time * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, click_frame_idx)
        ok, frame = cap.read()
        if not ok:
            raise HTTPException(status_code=400, detail="Could not read frame at click_time")
        print(f"[DEBUG] Video frame shape: {frame.shape}")

        predictor = get_predictor()
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        masks, scores = run_sam_with_fallback(predictor, frame_rgb, req.click_x, req.click_y)

        best_idx = int(np.argmax(scores))
        best_mask = masks[best_idx]
        best_score = float(scores[best_idx])

        polygon = extract_polygon(best_mask)

        def to_points_pct(poly: np.ndarray) -> List[Tuple[float, float]]:
            return [(100 * float(x) / frame_w, 100 * float(y) / frame_h) for x, y in poly]

        path: List[PolygonFrame] = [PolygonFrame(time=req.click_time, points_pct=to_points_pct(polygon))]

        prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        prev_pts = cv2.goodFeaturesToTrack(
            prev_gray, maxCorners=MAX_CORNERS, qualityLevel=QUALITY_LEVEL, minDistance=MIN_DISTANCE
        )

        sample_interval_sec = 0.5
        next_sample_t = req.click_time + sample_interval_sec
        end_t = req.click_time + track_seconds
        frame_idx = click_frame_idx
        frames_since_reseed = 0
        current_polygon = polygon.copy()
        lost_tracking = False

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_idx += 1
            t = frame_idx / fps
            if t > end_t:
                break

            curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            if prev_pts is None or len(prev_pts) < MIN_SURVIVING_FEATURES:
                lost_tracking = True
                break

            next_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None)
            if next_pts is None or status is None:
                lost_tracking = True
                break

            good_prev = prev_pts[status.flatten() == 1]
            good_next = next_pts[status.flatten() == 1]

            if len(good_prev) < 4:
                lost_tracking = True
                break

            M, _ = cv2.estimateAffinePartial2D(good_prev, good_next, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_REPROJ_THRESHOLD)
            if M is None:
                lost_tracking = True
                break

            # Allow natural scaling to track zooms, instead of forcing scale to exactly 1.0
            # to prevent diagonal drift and bounding mismatches.
            # a = M[0, 0]
            # b = M[0, 1]
            # scale = (a**2 + b**2) ** 0.5
            # if scale > 0:
            #     M[0, 0] /= scale
            #     M[0, 1] /= scale
            #     M[1, 0] /= scale
            #     M[1, 1] /= scale

            warped = cv2.transform(current_polygon.reshape(-1, 1, 2), M)
            current_polygon = warped.reshape(-1, 2)

            if t >= next_sample_t:
                path.append(PolygonFrame(time=round(t, 2), points_pct=to_points_pct(current_polygon)))
                next_sample_t += sample_interval_sec

            frames_since_reseed += 1
            if frames_since_reseed >= RESEED_EVERY_N_FRAMES or len(good_next) < MIN_SURVIVING_FEATURES:
                prev_pts = cv2.goodFeaturesToTrack(
                    curr_gray, maxCorners=MAX_CORNERS, qualityLevel=QUALITY_LEVEL, minDistance=MIN_DISTANCE
                )
                frames_since_reseed = 0
            else:
                prev_pts = good_next.reshape(-1, 1, 2)

            prev_gray = curr_gray

        cap.release()
        cap = None

        warning = None
        if clamped:
            warning = f"track_seconds clamped to {MAX_TRACK_SECONDS}s - conservative placeholder, not yet independently re-verified for this endpoint."
        if lost_tracking:
            warning = "Feature tracking lost partway through (not enough trackable points) - stopped rather than return an unreliable warp."
        if len(path) < 2:
            warning = "Tracking stopped almost immediately - result may be unreliable for this clip/click point."

        return SegmentPlotPreciseResponse(
            initial_mask_score=best_score,
            frame_width=frame_w,
            frame_height=frame_h,
            path=path,
            warning=warning,
        )
    finally:
        if cap is not None:
            cap.release()
        try:
            os.unlink(video_path)
        except Exception as delete_err:
            print(f"Failed to delete temp file {video_path}: {delete_err}")
