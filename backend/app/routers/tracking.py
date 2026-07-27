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
    current_polygon = np.array([[p.x, p.y] for p in request.initial_points], dtype=np.float32)
    tracked_polygons: List[list] = []

    # User explicitly requested that the highlight does NOT track or move with the video.
    # It should stay exactly where they marked it on the screen for the entire duration.
    for _ in range(total_frames):
        tracked_polygons.append(current_polygon.tolist())

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
