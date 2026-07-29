import cv2
import numpy as np
import tempfile
import os
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import io

router = APIRouter()


@router.get("/extract-frame/{object_name}")
def extract_frame(object_name: str, timestamp: float = 0.0):
    """
    Video ka ek specific frame nikalta hai aur image ke roop mein return karta hai.
    timestamp: kis second ka frame chahiye (default: 0.0 = first frame)
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET

    # Step A: Try local demo_clips DIRECTLY (zero-copy, instant), then fall back to MinIO
    demo_p = os.path.join("demo_clips", object_name)
    temp_path = None

    if os.path.exists(demo_p) and os.path.getsize(demo_p) > 0:
        video_path = demo_p  # Read directly — no copy needed!
    else:
        temp_dir = tempfile.mkdtemp()
        temp_path = os.path.join(temp_dir, "extract_source.mp4")
        try:
            minio_client.fget_object(MINIO_BUCKET, object_name, temp_path)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")
        video_path = temp_path

    # Step B: OpenCV se video kholo
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=400, detail="Could not open video for reading")

    # Step C: Sahi timestamp pe jump karo if needed
    if timestamp > 0.0:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_number = int(timestamp * fps) if fps > 0 else 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)

    # Step D: Frame padho
    success, frame = cap.read()
    cap.release()

    # Cleanup temp file if used
    if temp_path and os.path.exists(temp_path):
        try:
            os.remove(temp_path)
            os.rmdir(os.path.dirname(temp_path))
        except Exception:
            pass

    if not success:
        raise HTTPException(status_code=400, detail="Could not read frame from video")

    # Step E: Frame ko JPEG image mein encode karo
    success, encoded_image = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode frame as image")

    # Step F: Image ko response ke roop mein bhejo
    return StreamingResponse(
        io.BytesIO(encoded_image.tobytes()),
        media_type="image/jpeg"
    )

