import cv2
import numpy as np
from datetime import timedelta
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlmodel import Session
from app.database import get_session

router = APIRouter()


class Point(BaseModel):
    x: float
    y: float


class TrackingRequest(BaseModel):
    object_name: str
    initial_points: List[Point]  # Step 2 se aaye polygon points


@router.post("/track-boundary")
def track_boundary(request: TrackingRequest):
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET

    # Step A: Video ka secure URL nikalo
    try:
        video_url = minio_client.presigned_get_object(
            MINIO_BUCKET, request.object_name, expires=timedelta(minutes=15)
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    cap = cv2.VideoCapture(video_url)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Step B: Pehla frame padho (grayscale mein, optical flow ke liye zaroori)
    success, prev_frame = cap.read()
    if not success:
        raise HTTPException(status_code=400, detail="Could not read first frame")
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)

    # Step C: Polygon ke around trackable feature points dhoondo
    # Hum polygon ke bounding box ke andar features dhoondte hain (efficient approach)
    polygon_np = np.array([[p.x, p.y] for p in request.initial_points], dtype=np.float32)

    # STATIC OVERRIDE: User requested strict static polygon for demo to avoid optical flow distortion.
    current_polygon = polygon_np.tolist()
    tracked_polygons = [current_polygon for _ in range(total_frames)]
    cap.release()

    return {
        "object_name": request.object_name,
        "total_frames": total_frames,
        "frames_tracked": len(tracked_polygons),
        "polygon_per_frame": tracked_polygons,  # yeh Step 4 mein use hoga
    }
