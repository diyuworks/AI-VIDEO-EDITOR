import cv2
import numpy as np
import tempfile
import os
from collections import deque
from datetime import timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlmodel import Session
from app.database import get_session

router = APIRouter()

# ---- Tuning constants ----
# Same base parameters as before (proven in segment_plot_precise.py:
# test_precise_response.json - 0.91 confidence, clean 15s track).
MAX_CORNERS = 200
QUALITY_LEVEL = 0.01
MIN_DISTANCE = 7
MIN_SURVIVING_FEATURES = 30
RESEED_EVERY_N_FRAMES = 15
RANSAC_REPROJ_THRESHOLD = 5.0

# Implausible-transform guards (per-frame, i.e. change since the LAST frame,
# not cumulative drift from frame 0 - a real camera move accumulates large
# total change over time, that's expected; what's implausible is a big jump
# in ONE step).
IMPLAUSIBLE_TRANSLATION_FRAC = 0.12
# A fixed scale-change cap breaks on a real, deliberate zoom (common in
# reel edits) - a sustained zoom easily produces >15% per-frame scale
# change, which used to get rejected as "implausible" and froze the
# polygon at its pre-zoom size while the field kept shrinking underneath
# it. Instead we track a rolling history of recent PLAUSIBLE scale
# changes and set the effective cap relative to that trend: a frame is
# only implausible if its scale jump is well outside what's already been
# happening, not just outside some fixed number.
BASE_IMPLAUSIBLE_SCALE_CHANGE = 0.15   # floor - always allow at least this much
SCALE_TREND_MULTIPLIER = 4.0           # how many x the recent trend counts as "still plausible"
SCALE_TREND_WINDOW = 12                # frames of history to judge the trend from
IMPLAUSIBLE_AREA_RATIO_MIN = 0.25   # polygon shrank to <25% of previous area in one frame
IMPLAUSIBLE_AREA_RATIO_MAX = 4.0    # polygon grew to >400% of previous area in one frame
MAX_CONSECUTIVE_IMPLAUSIBLE = 5

# Set to True to print a line every time a frame is rejected, showing
# exactly which guard tripped and by how much - flip on if tracking looks
# wrong again and you need to see WHY rather than guess.
DEBUG_LOG_REJECTIONS = True

# Point (2) - re-seed features from inside/near the polygon, not the whole
# frame. A pure whole-frame reseed is fine for a rigidly static scene, but
# drone footage has real parallax: distant background and near-ground plot
# edges do NOT move identically under altitude/perspective change, so
# whole-frame features can out-vote the plot's own motion. Pad the polygon's
# bounding box so we still catch edge/corner texture just outside the
# boundary line itself (the boundary itself is often low-texture crop
# interior). Falls back to whole-frame if the ROI has too little texture.
ROI_PAD_FRAC = 0.35
MIN_ROI_FEATURES = 40

# Point (3) - no more hard wall-clock cutoff. Tracking continues as long as
# it keeps passing the plausibility guards below; it only stops improving
# (freezes/smooths) when genuinely lost. A soft ceiling still exists as a
# last-resort safety valve for pathological cases (e.g. a whole video of
# solid-color sky with zero trackable texture), but it's far higher than the
# old fixed 18s and is a safety net, not the primary mechanism.
SAFETY_CEILING_SECONDS = 90.0

# Point (4) - instead of an instant freeze, blend back toward the last good
# polygon over this many frames, and lightly smooth the transform on GOOD
# frames too, so neither a loss-of-tracking nor a re-seed recovery produces
# a visible "pop" in the overlay.
SMOOTHING_ALPHA = 0.35          # EMA weight for successful-frame smoothing
FALLBACK_BLEND_FRAMES = 10      # frames over which a freeze eases in


class Point(BaseModel):
    x: float
    y: float


class TrackingRequest(BaseModel):
    object_name: str
    initial_points: List[Point]


def _polygon_area(poly: np.ndarray) -> float:
    """Shoelace formula. poly: (N, 2) array."""
    x = poly[:, 0]
    y = poly[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def _is_simple_polygon(poly: np.ndarray) -> bool:
    """
    Cheap self-intersection check for a small polygon (4-8 points is typical
    for a hand-clicked plot boundary, so O(n^2) segment checks are fine).
    Prevents the tracked shape from warping into a bowtie/crossed quad,
    which a pure scale/translation guard wouldn't necessarily catch.
    """
    n = len(poly)
    if n < 4:
        return True

    def segments_intersect(p1, p2, p3, p4) -> bool:
        def ccw(a, b, c):
            return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
        d1, d2 = ccw(p3, p4, p1), ccw(p3, p4, p2)
        d3, d4 = ccw(p1, p2, p3), ccw(p1, p2, p4)
        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
            return True
        return False

    edges = [(poly[i], poly[(i + 1) % n]) for i in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            # Skip adjacent edges (they legitimately share an endpoint).
            if j == i or j == (i + 1) % n or i == (j + 1) % n:
                continue
            if segments_intersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1]):
                return False
    return True


def _build_roi_mask(frame_shape, polygon: np.ndarray, pad_frac: float) -> np.ndarray:
    h, w = frame_shape[:2]
    x_min, y_min = polygon.min(axis=0)
    x_max, y_max = polygon.max(axis=0)
    box_w, box_h = x_max - x_min, y_max - y_min
    pad_x, pad_y = box_w * pad_frac, box_h * pad_frac

    mask = np.zeros((h, w), dtype=np.uint8)
    x0 = int(max(0, x_min - pad_x))
    y0 = int(max(0, y_min - pad_y))
    x1 = int(min(w, x_max + pad_x))
    y1 = int(min(h, y_max + pad_y))
    mask[y0:y1, x0:x1] = 255
    return mask


def _reseed(gray: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Point (2): try a polygon-local ROI first, fall back to whole frame."""
    roi_mask = _build_roi_mask(gray.shape, polygon, ROI_PAD_FRAC)
    roi_pts = cv2.goodFeaturesToTrack(
        gray, maxCorners=MAX_CORNERS, qualityLevel=QUALITY_LEVEL,
        minDistance=MIN_DISTANCE, mask=roi_mask,
    )
    if roi_pts is not None and len(roi_pts) >= MIN_ROI_FEATURES:
        return roi_pts
    # Not enough texture near the plot (e.g. very uniform crop, motion
    # blur) - whole-frame reseed is still better than tracking with too
    # few points, even if less locally representative.
    return cv2.goodFeaturesToTrack(
        gray, maxCorners=MAX_CORNERS, qualityLevel=QUALITY_LEVEL, minDistance=MIN_DISTANCE,
    )


@router.post("/track-boundary")
def track_boundary(request: TrackingRequest):
    import traceback
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET

    # Video ko local temp file me download karo
    # (presigned URLs ke saath cv2.VideoCapture Windows pe fail hota hai)
    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "track_source.mp4")
    try:
        minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
    except Exception as e:
        print(f"[tracking] MinIO download failed for {request.object_name}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        print(f"[tracking] cv2.VideoCapture failed to open: {source_local_path}")
        raise HTTPException(status_code=400, detail=f"Could not open video: {request.object_name}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    safety_ceiling_frames = int(SAFETY_CEILING_SECONDS * fps)

    success, prev_frame = cap.read()
    if not success:
        raise HTTPException(status_code=400, detail="Could not read first frame")
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    frame_height, frame_width = prev_frame.shape[:2]

    current_polygon = np.array([[p.x, p.y] for p in request.initial_points], dtype=np.float32)
    original_area = _polygon_area(current_polygon)
    last_good_polygon = current_polygon.copy()

    tracked_polygons: List[list] = [current_polygon.tolist()]

    prev_pts = _reseed(prev_gray, current_polygon)
    frames_since_reseed = 0
    consecutive_implausible = 0
    lost_tracking = False
    lost_at_frame: Optional[int] = None
    prev_scale = 1.0
    scale_change_history: deque = deque(maxlen=SCALE_TREND_WINDOW)
    frame_idx = 1

    while frame_idx < total_frames:
        success, frame = cap.read()
        if not success:
            break

        # Point (3): no fixed wall-clock cutoff - only the safety ceiling,
        # which should essentially never trigger unless tracking is already
        # lost (in which case we're already frozen/blending anyway).
        if frame_idx > safety_ceiling_frames:
            lost_tracking = True

        if lost_tracking:
            # Point (4): don't hard-freeze - ease the polygon toward its
            # last-good position over a few frames so a viewer doesn't see
            # a sudden stop-motion pop. After the blend window, it settles
            # at last_good_polygon exactly (a true freeze), which is still
            # the right behavior for a long-lost track - just not abrupt.
            frames_since_lost = frame_idx - lost_at_frame if lost_at_frame else 0
            blend_t = min(1.0, frames_since_lost / FALLBACK_BLEND_FRAMES)
            eased = (1 - blend_t) * current_polygon + blend_t * last_good_polygon
            tracked_polygons.append(eased.tolist())
            frame_idx += 1
            continue

        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if prev_pts is None or len(prev_pts) < MIN_SURVIVING_FEATURES:
            lost_tracking = True
            lost_at_frame = frame_idx
            tracked_polygons.append(current_polygon.tolist())
            frame_idx += 1
            continue

        next_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None)
        if next_pts is None or status is None:
            lost_tracking = True
            lost_at_frame = frame_idx
            tracked_polygons.append(current_polygon.tolist())
            frame_idx += 1
            continue

        good_prev = prev_pts[status.flatten() == 1]
        good_next = next_pts[status.flatten() == 1]

        if len(good_prev) < 4:
            lost_tracking = True
            lost_at_frame = frame_idx
            tracked_polygons.append(current_polygon.tolist())
            frame_idx += 1
            continue

        M, _ = cv2.estimateAffinePartial2D(
            good_prev, good_next, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_REPROJ_THRESHOLD
        )
        if M is None:
            lost_tracking = True
            lost_at_frame = frame_idx
            tracked_polygons.append(current_polygon.tolist())
            frame_idx += 1
            continue

        tx, ty = M[0, 2], M[1, 2]
        translation_frac = (tx**2 + ty**2) ** 0.5 / (frame_width**2 + frame_height**2) ** 0.5
        a, b = M[0, 0], M[0, 1]
        scale = (a**2 + b**2) ** 0.5
        scale_change = abs(scale - prev_scale)
        # Update the reference point for next frame's delta regardless of
        # whether THIS frame ends up trusted enough to move the polygon -
        # otherwise a rejected frame leaves a stale reference and the next
        # comparison spans two frames' worth of change instead of one,
        # which just makes rejection more likely to cascade.
        prev_scale = scale
        # Same reasoning: record what we actually observed into the trend
        # history regardless of accept/reject, so a sustained zoom's trend
        # can establish itself within a few frames instead of being stuck
        # unable to ever pass the fixed floor (a real deadlock: history
        # only grows on accepted frames, but accepting requires history).
        scale_change_history.append(scale_change)

        candidate = cv2.transform(current_polygon.reshape(-1, 1, 2), M).reshape(-1, 2)

        # Point (1): guard against implausible SHAPE, not just implausible
        # transform magnitude. estimateAffinePartial2D (similarity: rotate +
        # uniform-scale + translate) can't shear or produce a non-simple
        # polygon on its own the way a full homography could - but we still
        # sanity-check area ratio and simplicity as defense-in-depth against
        # numerical blow-ups or a bad RANSAC inlier set.
        candidate_area = _polygon_area(candidate)
        area_ratio = candidate_area / max(_polygon_area(current_polygon), 1e-6)

        # Effective scale-change cap adapts to what's actually been
        # happening recently. During a steady zoom, recent scale changes
        # are consistently elevated, so the trend-based cap rises with
        # them - a continuation of the same zoom stays plausible. A
        # sudden one-off jump unrelated to any trend still gets caught
        # against the floor.
        if len(scale_change_history) >= 3:
            recent_trend = float(np.median(scale_change_history))
        else:
            recent_trend = 0.0
        effective_scale_cap = max(BASE_IMPLAUSIBLE_SCALE_CHANGE, SCALE_TREND_MULTIPLIER * recent_trend)

        fail_translation = translation_frac > IMPLAUSIBLE_TRANSLATION_FRAC
        fail_scale = scale_change > effective_scale_cap
        fail_area = area_ratio < IMPLAUSIBLE_AREA_RATIO_MIN or area_ratio > IMPLAUSIBLE_AREA_RATIO_MAX
        fail_simple = not _is_simple_polygon(candidate)
        implausible = fail_translation or fail_scale or fail_area or fail_simple

        if implausible and DEBUG_LOG_REJECTIONS:
            reasons = []
            if fail_translation:
                reasons.append(f"translation {translation_frac:.3f} > {IMPLAUSIBLE_TRANSLATION_FRAC}")
            if fail_scale:
                reasons.append(f"scale_change {scale_change:.3f} > cap {effective_scale_cap:.3f} (trend {recent_trend:.3f})")
            if fail_area:
                reasons.append(f"area_ratio {area_ratio:.3f} outside [{IMPLAUSIBLE_AREA_RATIO_MIN}, {IMPLAUSIBLE_AREA_RATIO_MAX}]")
            if fail_simple:
                reasons.append("self-intersecting polygon")
            print(f"[tracking] frame {frame_idx} rejected: {'; '.join(reasons)}")

        if implausible:
            consecutive_implausible += 1
            if consecutive_implausible >= MAX_CONSECUTIVE_IMPLAUSIBLE:
                lost_tracking = True
                lost_at_frame = frame_idx
                last_good_polygon = current_polygon.copy()
            tracked_polygons.append(current_polygon.tolist())
            prev_pts = _reseed(curr_gray, current_polygon)
            frames_since_reseed = 0
            prev_gray = curr_gray
            frame_idx += 1
            continue

        consecutive_implausible = 0

        # Point (4): light EMA smoothing on the polygon itself to reduce
        # frame-to-frame jitter from optical-flow noise, without lagging
        # behind genuine sustained motion (the EMA tracks the true signal
        # within a couple of frames since alpha is fairly high).
        smoothed = SMOOTHING_ALPHA * current_polygon + (1 - SMOOTHING_ALPHA) * candidate
        current_polygon = smoothed
        last_good_polygon = current_polygon.copy()
        tracked_polygons.append(current_polygon.tolist())

        frames_since_reseed += 1
        if frames_since_reseed >= RESEED_EVERY_N_FRAMES or len(good_next) < MIN_SURVIVING_FEATURES:
            prev_pts = _reseed(curr_gray, current_polygon)
            frames_since_reseed = 0
        else:
            prev_pts = good_next.reshape(-1, 1, 2)

        prev_gray = curr_gray
        frame_idx += 1

    cap.release()

    # Cleanup downloaded source video
    if os.path.exists(source_local_path):
        os.remove(source_local_path)

    warning = None
    if lost_tracking:
        warning = (
            "Feature tracking was lost at some point (implausible transform, "
            "insufficient features, or the safety ceiling) - remaining frames "
            "ease toward the last known-good polygon rather than freezing "
            "instantly or extrapolating an unreliable guess."
        )

    return {
        "object_name": request.object_name,
        "total_frames": total_frames,
        "frames_tracked": len(tracked_polygons),
        "polygon_per_frame": tracked_polygons,
        "warning": warning,
    }
