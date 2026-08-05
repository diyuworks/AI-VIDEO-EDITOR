import cv2
import numpy as np
import tempfile
import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

class Point(BaseModel):
    x: float
    y: float

class TrackingRequest(BaseModel):
    object_name: str
    initial_points: List[Point]

@router.post("/track-boundary")
def track_boundary(request: TrackingRequest):
    import traceback
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET

    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "track_source.mp4")
    demo_p = os.path.join("demo_clips", request.object_name)
    if os.path.exists(demo_p) and os.path.getsize(demo_p) > 0:
        import shutil
        shutil.copy(demo_p, source_local_path)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
        except Exception as e:
            print(f"[tracking] MinIO download failed for {request.object_name}: {e}")
            traceback.print_exc()
            raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        print(f"[tracking] cv2.VideoCapture failed to open: {source_local_path}")
        raise HTTPException(status_code=400, detail=f"Could not open video: {request.object_name}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    initial_poly = np.array([[p.x, p.y] for p in request.initial_points], dtype=np.float32)

    ret, prev_frame = cap.read()
    if not ret or prev_frame is None:
        cap.release()
        raise HTTPException(status_code=400, detail="Could not read video frames for tracking.")

    orig_h, orig_w = prev_frame.shape[:2]
    MAX_W, MAX_H = 480, 854
    scale_factor = min(MAX_W / float(orig_w), MAX_H / float(orig_h), 1.0)

    if scale_factor < 1.0:
        prev_frame_proc = cv2.resize(prev_frame, (int(orig_w * scale_factor), int(orig_h * scale_factor)), interpolation=cv2.INTER_AREA)
    else:
        prev_frame_proc = prev_frame

    initial_poly_scaled = initial_poly * scale_factor
    current_poly_scaled = initial_poly_scaled.copy()
    tracked_polygons: List[list] = []

    prev_gray = cv2.cvtColor(prev_frame_proc, cv2.COLOR_BGR2GRAY)
    tracked_polygons.append(initial_poly.tolist())

    # Build mask around initial polygon to collect feature points
    poly_pts_int = np.array(initial_poly_scaled, dtype=np.int32)
    mask = np.zeros_like(prev_gray)
    cv2.fillPoly(mask, [poly_pts_int], 255)
    
    # Expand mask slightly to catch surrounding landmarks for robust tracking
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask = cv2.dilate(mask, kernel, iterations=1)

    # Combine polygon vertices and internal features
    vertex_pts = initial_poly_scaled.reshape(-1, 1, 2)
    extra_features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=100, qualityLevel=0.01, minDistance=5, mask=mask)
    
    if extra_features is not None:
        prev_pts = np.vstack((vertex_pts, extra_features))
    else:
        prev_pts = vertex_pts

    lk_params = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))

    for _ in range(1, total_frames):
        ret, curr_frame = cap.read()
        if not ret or curr_frame is None:
            tracked_polygons.append((current_poly_scaled / scale_factor).tolist())
            continue

        if scale_factor < 1.0:
            curr_frame_proc = cv2.resize(curr_frame, (int(orig_w * scale_factor), int(orig_h * scale_factor)), interpolation=cv2.INTER_AREA)
        else:
            curr_frame_proc = curr_frame

        curr_gray = cv2.cvtColor(curr_frame_proc, cv2.COLOR_BGR2GRAY)

        if len(prev_pts) >= 4:
            next_pts, status, err = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None, **lk_params)
            
            if next_pts is not None and status is not None:
                good_prev = prev_pts[status == 1]
                good_next = next_pts[status == 1]

                if len(good_prev) >= 4:
                    H, inlier_mask = cv2.findHomography(good_prev, good_next, cv2.RANSAC, 3.0)
                    
                    if H is not None and not np.isnan(H).any() and abs(np.linalg.det(H)) > 0.01:
                        ones = np.ones((len(current_poly_scaled), 1), dtype=np.float32)
                        pts_homo = np.hstack([current_poly_scaled, ones])
                        transformed_pts = (H @ pts_homo.T).T
                        
                        if not np.isnan(transformed_pts).any():
                            w_coords = transformed_pts[:, 2:3]
                            w_coords[w_coords == 0] = 1.0
                            current_poly_scaled = transformed_pts[:, :2] / w_coords

                        prev_pts = good_next.reshape(-1, 1, 2)

        prev_gray = curr_gray
        tracked_polygons.append((current_poly_scaled / scale_factor).tolist())
        prev_gray = curr_gray

        # Re-detect features if tracking points drop below threshold
        if len(prev_pts) < 10:
            current_poly_int = np.array(current_poly_scaled, dtype=np.int32)
            fresh_mask = np.zeros_like(curr_gray)
            cv2.fillPoly(fresh_mask, [current_poly_int], 255)
            fresh_mask = cv2.dilate(fresh_mask, kernel, iterations=1)
            fresh_features = cv2.goodFeaturesToTrack(curr_gray, maxCorners=100, qualityLevel=0.01, minDistance=5, mask=fresh_mask)
            
            cur_vertex_pts = current_poly.reshape(-1, 1, 2)
            if fresh_features is not None:
                prev_pts = np.vstack((cur_vertex_pts, fresh_features))
            else:
                prev_pts = cur_vertex_pts

    cap.release()

    # Clean up temp files
    if os.path.exists(source_local_path):
        os.remove(source_local_path)
    if os.path.exists(temp_dir):
        os.rmdir(temp_dir)

    return {
        "success": True,
        "frames_processed": total_frames,
        "polygon_per_frame": tracked_polygons,
    }

class TrackingHighlight(BaseModel):
    initial_points: List[Point]
    start_timestamp: Optional[float] = 0.0

class TrackingMultiRequest(BaseModel):
    object_name: str
    highlights: List[TrackingHighlight]

@router.post("/track-boundary-multi")
def track_boundary_multi(request: TrackingMultiRequest):
    import traceback
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET

    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "track_source.mp4")
    demo_p = os.path.join("demo_clips", request.object_name)
    if os.path.exists(demo_p) and os.path.getsize(demo_p) > 0:
        import shutil
        shutil.copy(demo_p, source_local_path)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Could not open video: {request.object_name}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    # Read all frames to memory for robust bidirectional tracking
    frames = []
    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            break
        frames.append(frame)
    cap.release()

    if len(frames) == 0:
        raise HTTPException(status_code=400, detail="Could not read video frames for tracking.")

    total_frames = len(frames)
    orig_h, orig_w = frames[0].shape[:2]
    MAX_W, MAX_H = 480, 854
    scale_factor = min(MAX_W / float(orig_w), MAX_H / float(orig_h), 1.0)

    # Pre-process all gray frames
    gray_frames = []
    for f in frames:
        if scale_factor < 1.0:
            f_proc = cv2.resize(f, (int(orig_w * scale_factor), int(orig_h * scale_factor)), interpolation=cv2.INTER_AREA)
        else:
            f_proc = f
        gray_frames.append(cv2.cvtColor(f_proc, cv2.COLOR_BGR2GRAY))

    lk_params = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))

    polygons_per_frame = [ [None] * total_frames for _ in request.highlights ]

    for idx, highlight in enumerate(request.highlights):
        t_start = highlight.start_timestamp or 0.0
        start_frame_idx = int(t_start * fps)
        start_frame_idx = max(0, min(start_frame_idx, total_frames - 1))

        initial_poly = np.array([[p.x, p.y] for p in highlight.initial_points], dtype=np.float32)
        initial_poly_scaled = initial_poly * scale_factor

        polygons_per_frame[idx][start_frame_idx] = initial_poly.tolist()

        # Helper function for tracking between two gray frames
        def track_step(prev_gray, curr_gray, cur_poly_scaled, prev_pts):
            if prev_pts is None or len(prev_pts) < 4:
                # Refresh points inside/around mask
                poly_pts_int = np.array(cur_poly_scaled, dtype=np.int32)
                mask = np.zeros_like(prev_gray)
                if len(poly_pts_int) > 2:
                    cv2.fillPoly(mask, [poly_pts_int], 255)
                else:
                    cv2.polylines(mask, [poly_pts_int], False, 255, 5)
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
                mask = cv2.dilate(mask, kernel, iterations=1)
                
                vertex_pts = cur_poly_scaled.reshape(-1, 1, 2)
                extra_features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=100, qualityLevel=0.01, minDistance=5, mask=mask)
                if extra_features is not None:
                    prev_pts = np.vstack((vertex_pts, extra_features))
                else:
                    prev_pts = vertex_pts

            curr_pts, status, err = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None, **lk_params)
            new_poly = cur_poly_scaled.copy()
            next_pts = None

            if curr_pts is not None and status is not None:
                good_curr = curr_pts[status == 1]
                good_prev = prev_pts[status == 1]

                if len(good_curr) >= 4:
                    M, inliers = cv2.findHomography(good_prev, good_curr, cv2.RANSAC, 5.0)
                    if M is not None:
                        homog_pts = np.array([cur_poly_scaled], dtype=np.float32)
                        new_poly = cv2.perspectiveTransform(homog_pts, M)[0]

                next_pts = good_curr.reshape(-1, 1, 2)

            return new_poly, next_pts

        # 1. Forward Pass (start_frame_idx -> total_frames - 1)
        cur_poly = initial_poly_scaled.copy()
        cur_pts = None
        for f_idx in range(start_frame_idx + 1, total_frames):
            prev_g = gray_frames[f_idx - 1]
            curr_g = gray_frames[f_idx]
            cur_poly, cur_pts = track_step(prev_g, curr_g, cur_poly, cur_pts)
            polygons_per_frame[idx][f_idx] = (cur_poly / scale_factor).tolist()

        # 2. Backward Pass (start_frame_idx -> 0)
        cur_poly = initial_poly_scaled.copy()
        cur_pts = None
        for f_idx in range(start_frame_idx - 1, -1, -1):
            prev_g = gray_frames[f_idx + 1]
            curr_g = gray_frames[f_idx]
            cur_poly, cur_pts = track_step(prev_g, curr_g, cur_poly, cur_pts)
            polygons_per_frame[idx][f_idx] = (cur_poly / scale_factor).tolist()

    # Clean up temp dir
    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass

    return {"polygons_per_frame": polygons_per_frame}
