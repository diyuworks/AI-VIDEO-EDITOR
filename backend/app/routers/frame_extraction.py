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

    # Step A: Video ko local temp file me download karo
    # HTTP stream me OpenCV kabhi-kabhi starting frames skip kar deta hai
    temp_dir = tempfile.mkdtemp()
    local_video_path = os.path.join(temp_dir, "extract_source.mp4")
    try:
        minio_client.fget_object(MINIO_BUCKET, object_name, local_video_path)
    except Exception as e:
        demo_p = os.path.join("demo_clips", object_name)
        if os.path.exists(demo_p):
            import shutil
            shutil.copy(demo_p, local_video_path)
        else:
            raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")

    # Step B: OpenCV se local video kholo (guarantees frame parity with tracking)
    cap = cv2.VideoCapture(local_video_path)

    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video for reading")

    # Step C: Sahi timestamp pe jump karo if needed
    if timestamp > 0.0:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_number = int(timestamp * fps) if fps > 0 else 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)

    # Step D: Frame padho
    success, frame = cap.read()
    cap.release()

    if not success:
        raise HTTPException(status_code=400, detail="Could not read frame from video")

    # Step E: Frame ko JPEG image mein encode karo
    success, encoded_image = cv2.imencode(".jpg", frame)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode frame as image")

    # Step F: Image ko response ke roop mein bhejo
    return StreamingResponse(
        io.BytesIO(encoded_image.tobytes()),
        media_type="image/jpeg"
    )
