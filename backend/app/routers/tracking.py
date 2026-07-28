import cv2
import numpy as np
import tempfile
import os
from typing import List
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
    initial_poly = np.array([[p.x, p.y] for p in request.initial_points], dtype=np.float32)
    current_poly = initial_poly.copy()
    tracked_polygons: List[list] = []

    ret, prev_frame = cap.read()
    if not ret or prev_frame is None:
        cap.release()
        raise HTTPException(status_code=400, detail="Could not read video frames for tracking.")

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    tracked_polygons.append(current_poly.tolist())

    # Build mask around initial polygon to collect feature points
    poly_pts_int = np.array(initial_poly, dtype=np.int32)
    mask = np.zeros_like(prev_gray)
    cv2.fillPoly(mask, [poly_pts_int], 255)
    
    # Expand mask slightly to catch surrounding landmarks for robust tracking
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask = cv2.dilate(mask, kernel, iterations=1)

    # Combine polygon vertices and internal features
    vertex_pts = initial_poly.reshape(-1, 1, 2)
    extra_features = cv2.goodFeaturesToTrack(prev_gray, maxCorners=100, qualityLevel=0.01, minDistance=5, mask=mask)
    
    if extra_features is not None:
        prev_pts = np.vstack((vertex_pts, extra_features))
    else:
        prev_pts = vertex_pts

    lk_params = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))

    for _ in range(1, total_frames):
        ret, curr_frame = cap.read()
        if not ret or curr_frame is None:
            tracked_polygons.append(current_poly.tolist())
            continue

        curr_gray = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY)

        if len(prev_pts) >= 4:
            next_pts, status, err = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None, **lk_params)
            
            if next_pts is not None and status is not None:
                good_prev = prev_pts[status == 1]
                good_next = next_pts[status == 1]

                if len(good_prev) >= 4:
                    H, inlier_mask = cv2.findHomography(good_prev, good_next, cv2.RANSAC, 3.0)
                    
                    if H is not None and not np.isnan(H).any() and abs(np.linalg.det(H)) > 0.01:
                        # Warp polygon using Homography matrix
                        poly_3d = current_poly.reshape(-1, 1, 2)
                        warped_poly = cv2.perspectiveTransform(poly_3d, H).reshape(-1, 2)
                        
                        # Apply subtle Exponential Moving Average for jitter reduction
                        current_poly = 0.8 * warped_poly + 0.2 * current_poly
                        prev_pts = good_next.reshape(-1, 1, 2)
                    else:
                        prev_pts = good_next.reshape(-1, 1, 2)

        tracked_polygons.append(current_poly.tolist())
        prev_gray = curr_gray

        # Re-detect features if tracking points drop below threshold
        if len(prev_pts) < 10:
            current_poly_int = np.array(current_poly, dtype=np.int32)
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
