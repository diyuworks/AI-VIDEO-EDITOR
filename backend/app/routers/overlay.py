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

            # Animate the border drawing: first 25 frames (1 second at 25 fps)
            ANIM_FRAMES = 25
            FADE_FRAMES = 10
            M = len(polygon_points)

            if M >= 3:
                if frame_idx < ANIM_FRAMES:
                    # Live tracing dynamic border drawing animation
                    t = frame_idx / ANIM_FRAMES
                    curr_progress = t * M
                    K = int(curr_progress)
                    fr = curr_progress - K
                    
                    # Draw fully completed border segments
                    for i in range(K):
                        p_start = tuple(polygon_points[i])
                        p_end = tuple(polygon_points[(i + 1) % M])
                        cv2.line(frame, p_start, p_end, color_bgr, thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                        cv2.line(frame, p_start, p_end, (255, 255, 255), thickness=request.border_thickness, lineType=cv2.LINE_AA)
                        
                    # Draw current partial tracing segment
                    if K < M:
                        p_start = polygon_points[K]
                        p_next = polygon_points[(K + 1) % M]
                        p_end_x = int(p_start[0] + fr * (p_next[0] - p_start[0]))
                        p_end_y = int(p_start[1] + fr * (p_next[1] - p_start[1]))
                        p_end = (p_end_x, p_end_y)
                        p_start_tuple = tuple(p_start)
                        
                        cv2.line(frame, p_start_tuple, p_end, color_bgr, thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                        cv2.line(frame, p_start_tuple, p_end, (255, 255, 255), thickness=request.border_thickness, lineType=cv2.LINE_AA)
                else:
                    # Border is complete, draw closed polygon outline with anti-aliasing
                    cv2.polylines(frame, [polygon_points], isClosed=True,
                                  color=color_bgr, thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                    cv2.polylines(frame, [polygon_points], isClosed=True,
                                  color=(255, 255, 255), thickness=request.border_thickness, lineType=cv2.LINE_AA)
                    
                    # Fade-in semi-transparent overlay fill
                    overlay = frame.copy()
                    cv2.fillPoly(overlay, [polygon_points], color_bgr)
                    
                    if frame_idx < ANIM_FRAMES + FADE_FRAMES:
                        alpha = 0.25 * ((frame_idx - ANIM_FRAMES) / FADE_FRAMES)
                    else:
                        alpha = 0.25
                        
                    frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)
                    
                    # Draw plot name label (only after tracing outline completes)
                    if request.label:
                        min_y_idx = np.argmin(polygon_points[:, 1])
                        label_x = polygon_points[min_y_idx][0]
                        
                        # Calculate dynamic scale based on video width to make it highly legible
                        font_scale = max(0.9, width / 750.0)
                        font_thickness = max(2, int(width / 350.0))
                        
                        label_text = request.label
                        (text_w, text_h), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness)
                        
                        # Space offset above the top point of the polygon
                        label_y = polygon_points[min_y_idx][1] - 25
                        
                        # Bounds check safety so it stays fully inside the frame
                        label_x = max(15, min(label_x, width - text_w - 20))
                        label_y = max(text_h + 20, min(label_y, height - 20))

                        # Background box for the text label
                        cv2.rectangle(frame, 
                                      (label_x - 12, label_y - text_h - 12),
                                      (label_x + text_w + 12, label_y + 12),
                                      color_bgr, -1)
                        
                        # Plot name text drawing
                        cv2.putText(frame, label_text, (label_x, label_y),
                                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), font_thickness)

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
