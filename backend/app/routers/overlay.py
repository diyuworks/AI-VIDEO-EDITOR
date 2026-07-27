import cv2
import numpy as np
import tempfile
import os
import subprocess
from datetime import timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class OverlayRequest(BaseModel):
    object_name: str
    polygon_per_frame: List[List[List[float]]]  # Step 3 ka output
    highlight_color: str = "#FFEB3B"  # yellow, default
    border_thickness: int = 4
    label: Optional[str] = None  # plot name / label text


def hex_to_bgr(hex_color: str):
    """#FFEB3B -> (BGR tuple for OpenCV)"""
    hex_color = hex_color.lstrip("#")
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    return (b, g, r)  # OpenCV BGR order use karta hai


@router.post("/render-overlay")
def render_overlay(request: OverlayRequest):
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT
    from typing import Optional

    # Step A: Video ka secure URL nikalo
    try:
        video_url = minio_client.presigned_get_object(
            MINIO_BUCKET, request.object_name, expires=timedelta(minutes=20)
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    cap = cv2.VideoCapture(video_url)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Step B: Temporary output file banao (bina audio ke, sirf video)
    temp_dir = tempfile.mkdtemp()
    temp_video_path = os.path.join(temp_dir, "overlay_temp.mp4")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))

    color_bgr = hex_to_bgr(request.highlight_color)
    total_polygon_frames = len(request.polygon_per_frame)

    frame_idx = 0
    while True:
        success, frame = cap.read()
        if not success:
            break

        # Agar is frame ke liye polygon data available hai
        if frame_idx < total_polygon_frames:
            polygon_points = np.array(
                request.polygon_per_frame[frame_idx], dtype=np.int32
            )

            # Semi-transparent fill ke liye overlay banate hain
            overlay = frame.copy()
            cv2.fillPoly(overlay, [polygon_points], color_bgr)
            alpha = 0.25  # transparency level (0=invisible, 1=solid)
            frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

            # Border draw karo (thoda glow effect ke liye do baar draw karenge)
            cv2.polylines(frame, [polygon_points], isClosed=True,
                          color=color_bgr, thickness=request.border_thickness + 4)
            cv2.polylines(frame, [polygon_points], isClosed=True,
                          color=(255, 255, 255), thickness=request.border_thickness)

            # Draw plot name label above the polygon if provided
            if request.label:
                min_y_idx = np.argmin(polygon_points[:, 1])
                label_x = polygon_points[min_y_idx][0]
                label_y = polygon_points[min_y_idx][1] - 15
                
                # Bounds check safety
                label_x = max(10, min(label_x, width - 150))
                label_y = max(30, min(label_y, height - 10))

                label_text = request.label
                (text_w, text_h), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                cv2.rectangle(frame, 
                              (label_x - 5, label_y - text_h - 8),
                              (label_x + text_w + 5, label_y + 5),
                              color_bgr, -1)
                cv2.putText(frame, label_text, (label_x, label_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

        out.write(frame)
        frame_idx += 1

    cap.release()
    out.release()

    # Step C: FFmpeg se re-encode karo (OpenCV ka codec browser-friendly nahi hota hamesha)
    final_output_path = os.path.join(temp_dir, "overlay_final.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-i", temp_video_path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        final_output_path
    ], check=True, capture_output=True)

    # Step D: Result MinIO mein upload karo
    output_object_name = f"highlighted_{request.object_name}"
    with open(final_output_path, "rb") as f:
        file_data = f.read()

    from io import BytesIO
    minio_client.put_object(
        MINIO_BUCKET,
        output_object_name,
        data=BytesIO(file_data),
        length=len(file_data),
        content_type="video/mp4",
    )

    # Cleanup
    os.remove(temp_video_path)
    os.remove(final_output_path)

    output_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{output_object_name}"

    return {
        "success": True,
        "output_object_name": output_object_name,
        "url": output_url,
        "frames_processed": frame_idx,
    }


@router.post("/merge-audio/{highlighted_object_name}")
def merge_audio_back(highlighted_object_name: str, original_object_name: str):
    """
    Highlighted (audio-less) video mein original video ka audio wapas jodta hai.
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT

    temp_dir = tempfile.mkdtemp()

    # Step A: Dono videos ke secure URLs nikalo
    try:
        highlighted_url = minio_client.presigned_get_object(
            MINIO_BUCKET, highlighted_object_name, expires=timedelta(minutes=20)
        )
        original_url = minio_client.presigned_get_object(
            MINIO_BUCKET, original_object_name, expires=timedelta(minutes=20)
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    # Step B: Dono ko local temp files mein download karo
    # (FFmpeg ko direct streaming URLs se kaam karne mein kabhi dikkat ho sakti hai, isliye safe side)
    highlighted_local = os.path.join(temp_dir, "highlighted.mp4")
    original_local = os.path.join(temp_dir, "original.mp4")

    subprocess.run(["ffmpeg", "-y", "-i", highlighted_url, "-c", "copy", highlighted_local],
                   check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", original_url, "-c", "copy", original_local],
                   check=True, capture_output=True)

    # Step C: Check karo original video mein audio stream hai bhi ya nahi
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", original_local],
        capture_output=True, text=True
    )
    has_audio = bool(probe.stdout.strip())

    final_output_path = os.path.join(temp_dir, "final_with_audio.mp4")

    if has_audio:
        # Step D: Highlighted video (visual) + Original video (audio) merge karo
        subprocess.run([
            "ffmpeg", "-y",
            "-i", highlighted_local,      # video source
            "-i", original_local,          # audio source
            "-c:v", "copy",
            "-map", "0:v:0",               # sirf highlighted video ka visual
            "-map", "1:a:0",               # sirf original video ka audio
            "-c:a", "aac",
            "-shortest",                    # jo chhota ho usi ki length use karo
            final_output_path
        ], check=True, capture_output=True)
    else:
        # Agar original mein audio hi nahi tha, toh highlighted video hi final hai
        final_output_path = highlighted_local

    # Step E: Result MinIO mein upload karo
    final_object_name = f"final_{highlighted_object_name}"
    with open(final_output_path, "rb") as f:
        file_data = f.read()

    from io import BytesIO
    minio_client.put_object(
        MINIO_BUCKET,
        final_object_name,
        data=BytesIO(file_data),
        length=len(file_data),
        content_type="video/mp4",
    )

    # Cleanup
    for path in [highlighted_local, original_local, final_output_path]:
        if os.path.exists(path):
            os.remove(path)

    output_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{final_object_name}"

    return {
        "success": True,
        "final_object_name": final_object_name,
        "url": output_url,
        "had_audio": has_audio,
    }
