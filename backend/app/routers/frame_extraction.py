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
    import time
    t0 = time.time()
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET
    t_import = time.time()
    
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
    
    t_file = time.time()
    cap = cv2.VideoCapture(video_path, cv2.CAP_FFMPEG)
    t_open = time.time()

    if not cap.isOpened():
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=400, detail="Could not open video for reading")

    if timestamp >= 0.0:
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_number = int(timestamp * fps) if fps > 0 else 0
        if frame_number >= total_frames - 5 and total_frames > 5:
            frame_number = total_frames - 5
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)

    success, frame = cap.read()
    cap.release()
    t_read = time.time()

    if temp_path and os.path.exists(temp_path):
        try:
            os.remove(temp_path)
            os.rmdir(os.path.dirname(temp_path))
        except Exception:
            pass

    if not success:
        raise HTTPException(status_code=400, detail="Could not read frame from video")

    success, encoded_image = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    t_encode = time.time()
    with open("debug_extract.log", "a") as f:
        f.write(f"DEBUG EXTRACT: import {t_import-t0:.3f} | file {t_file-t_import:.3f} | open {t_open-t_file:.3f} | read {t_read-t_open:.3f} | encode {t_encode-t_read:.3f}\n")
    
    return StreamingResponse(
        io.BytesIO(encoded_image.tobytes()),
        media_type="image/jpeg"
    )

