"""
Real click-to-segment-and-track plot boundary endpoint.

Combines the two R&D-proven pieces into one real feature:
  1. SAM (Segment Anything) Ã¢â‚¬â€ click a point, get a precise boundary on that frame.
  2. CSRT tracking Ã¢â‚¬â€ carry that boundary forward across subsequent frames.

PROVEN RELIABLE WINDOW: ~15-18 seconds from the click point, based on real
testing (see project notes). MAX_TRACK_SECONDS below enforces that Ã¢â‚¬â€ this is
NOT an arbitrary safety limit, it's the actual boundary of what was verified
to work before visible drift set in.

REQUIRES A GPU to run at usable speed Ã¢â‚¬â€ SAM on CPU was never benchmarked and
is a real unknown. This is intended to run wherever a GPU is actually
available (confirmed: works on an RTX 2050 laptop). Do not assume this works
on a GPU-less deployment without testing CPU speed first.

Setup:
    pip install segment-anything torch torchvision opencv-python-headless

    Download a checkpoint (~375MB, vit_b Ã¢â‚¬â€ chosen for smaller VRAM budgets):
    https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
    Place it at backend/models/sam_vit_b_01ec64.pth

Add to main.py:
    from app.routers import segment_plot
    app.include_router(segment_plot.router)
"""

import os
import tempfile
import uuid
from typing import List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import MINIO_BUCKET
from app.routers.uploads import minio_client

router = APIRouter()

CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "models", "sam_vit_b_01ec64.pth")
MODEL_TYPE = "vit_b"

# The actual proven-reliable window from real testing — NOT arbitrary.
# Tracking held up cleanly through ~20s, started visibly loosening by ~25-30s.
# Capped conservatively below that edge rather than right at it.
MAX_TRACK_SECONDS = 18.0
TRACK_SCALE = 0.5  # downscale factor for tracking speed, per the real perf test

_sam_predictor = None


def get_predictor():
    """Lazy-load SAM once per process, not per-request — loading the
    checkpoint is expensive and shouldn't happen on every call."""
    global _sam_predictor
    if _sam_predictor is None:
        if not os.path.exists(CHECKPOINT_PATH):
            raise HTTPException(
                status_code=500,
                detail=f"SAM checkpoint not found at {CHECKPOINT_PATH}. See module docstring for download instructions.",
            )
        try:
            import torch
            from segment_anything import sam_model_registry, SamPredictor
            device = "cuda" if torch.cuda.is_available() else "cpu"
            sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
            sam.to(device)
            _sam_predictor = SamPredictor(sam)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load SAM model: {e}")
    return _sam_predictor


class SegmentPlotRequest(BaseModel):
    object_name: str
    click_x: int  # pixel coords in the video's native resolution
    click_y: int
    click_time: float  # seconds into the video where the click happened
    track_seconds: float = MAX_TRACK_SECONDS


class BoxFrame(BaseModel):
    time: float
    x_pct: float  # box position as % of frame, matching the existing Mark Land box format
    y_pct: float
    width_pct: float
    height_pct: float


class SegmentPlotResponse(BaseModel):
    initial_mask_score: float
    frame_width: int
    frame_height: int
    path: List[BoxFrame]
    warning: Optional[str] = None


def download_video_to_temp(object_name: str) -> str:
    tmp_path = os.path.join(tempfile.gettempdir(), f"segplot_{uuid.uuid4().hex}.mp4")

    minio_client.fget_object(MINIO_BUCKET, object_name, tmp_path)
    return tmp_path


@router.post("/segment-plot", response_model=SegmentPlotResponse)
async def segment_plot(req: SegmentPlotRequest):
    if req.track_seconds > MAX_TRACK_SECONDS:
        req.track_seconds = MAX_TRACK_SECONDS  # silently clamp, but tell the caller
        clamped = True
    else:
        clamped = False

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

        # --- Step 1: SAM segmentation at the click point ---
        predictor = get_predictor()
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        try:
            predictor.set_image(frame_rgb)
            point_coords = np.array([[req.click_x, req.click_y]])
            point_labels = np.array([1])
            masks, scores, _ = predictor.predict(
                point_coords=point_coords, point_labels=point_labels, multimask_output=True
            )
        except (torch.OutOfMemoryError, RuntimeError) as e:
            if isinstance(e, torch.OutOfMemoryError) or "out of memory" in str(e).lower() or "cuda" in str(e).lower():
                print("CUDA Out Of Memory or CUDA error during SAM inference. Falling back to CPU...")
                torch.cuda.empty_cache()
                sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
                sam.to("cpu")
                predictor = SamPredictor(sam)
                predictor.set_image(frame_rgb)
                point_coords = np.array([[req.click_x, req.click_y]])
                point_labels = np.array([1])
                masks, scores, _ = predictor.predict(
                    point_coords=point_coords, point_labels=point_labels, multimask_output=True
                )
            else:
                raise e

        best_idx = int(np.argmax(scores))
        best_mask = masks[best_idx]
        best_score = float(scores[best_idx])

        ys, xs = np.where(best_mask)
        if len(xs) == 0:
            raise HTTPException(status_code=422, detail="SAM returned an empty mask for this click point")
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
        init_box = (int(x0), int(y0), int(x1 - x0), int(y1 - y0))

        # --- Step 2: CSRT tracking forward from the SAM box ---
        frame_small = cv2.resize(frame, None, fx=TRACK_SCALE, fy=TRACK_SCALE)
        box_small = tuple(int(v * TRACK_SCALE) for v in init_box)
        tracker = cv2.TrackerCSRT_create()
        tracker.init(frame_small, box_small)

        path: List[BoxFrame] = []
        path.append(BoxFrame(
            time=req.click_time,
            x_pct=100 * init_box[0] / frame_w,
            y_pct=100 * init_box[1] / frame_h,
            width_pct=100 * init_box[2] / frame_w,
            height_pct=100 * init_box[3] / frame_h,
        ))

        sample_interval_sec = 0.5  # keep payload small â€” interpolate on the frontend between samples
        next_sample_t = req.click_time + sample_interval_sec
        end_t = req.click_time + req.track_seconds
        frame_idx = click_frame_idx

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_idx += 1
            t = frame_idx / fps
            if t > end_t:
                break

            frame_small = cv2.resize(frame, None, fx=TRACK_SCALE, fy=TRACK_SCALE)
            success, tracked_box = tracker.update(frame_small)
            if not success:
                break  # stop rather than report a box we know is wrong

            if t >= next_sample_t:
                x, y, w_, h_ = [v / TRACK_SCALE for v in tracked_box]
                path.append(BoxFrame(
                    time=round(t, 2),
                    x_pct=100 * x / frame_w,
                    y_pct=100 * y / frame_h,
                    width_pct=100 * w_ / frame_w,
                    height_pct=100 * h_ / frame_h,
                ))
                next_sample_t += sample_interval_sec

        cap.release()
        cap = None

        warning = None
        if clamped:
            warning = f"track_seconds clamped to {MAX_TRACK_SECONDS}s â€” this is the real proven-reliable limit, not arbitrary."
        if len(path) < 2:
            warning = "Tracking stopped almost immediately â€” result may be unreliable for this clip/click point."

        return SegmentPlotResponse(
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
