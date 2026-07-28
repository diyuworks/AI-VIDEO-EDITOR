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
    import traceback
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT
    from typing import Optional

    # Step A: Video ko local temp file me download karo
    # (presigned URLs ke saath cv2.VideoCapture Windows pe fail hota hai)
    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "source_video.mp4")
    try:
        minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
    except Exception as e:
        print(f"[overlay] MinIO download failed for {request.object_name}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        print(f"[overlay] cv2.VideoCapture failed to open: {source_local_path}")
        raise HTTPException(status_code=400, detail=f"Could not open video: {request.object_name}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Step B: Temporary output file banao (bina audio ke, sirf video)
    temp_video_path = os.path.join(temp_dir, "overlay_temp.mp4")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))

    color_bgr = hex_to_bgr(request.highlight_color)
    total_polygon_frames = len(request.polygon_per_frame)

    pil_font = None
    if request.label:
        from PIL import Image, ImageDraw, ImageFont
        try:
            pil_font = ImageFont.truetype("arialbd.ttf", int(max(40, width / 20.0)))
        except IOError:
            try:
                pil_font = ImageFont.truetype("arial.ttf", int(max(40, width / 20.0)))
            except IOError:
                pil_font = ImageFont.load_default()

    success, first_frame = cap.read()
    if success and len(request.polygon_per_frame) > 0:
        polygon_points = np.array(request.polygon_per_frame[0], dtype=np.int32)
        M = len(polygon_points)
        
        # We will freeze for 7.5 seconds (so it becomes exactly 5.0s after the 1.5x speedup in merge_clips)
        freeze_frames_count = int(fps * 7.5)
        ANIM_FRAMES = int(fps * 1.5) # Scale animation time up too
        FADE_FRAMES = int(fps * 0.75)
        
        for frame_idx in range(freeze_frames_count):
            frame = first_frame.copy()
            
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
                else:
                    # Border is complete, draw closed polygon outline with anti-aliasing
                    
                    # Smooth fade progress
                    fade_progress = min(1.0, (frame_idx - ANIM_FRAMES) / float(FADE_FRAMES))
                    
                    # 1. Dim the background smoothly (outside the plot)
                    dim_factor = 1.0 - (0.5 * fade_progress) # Dims up to 50%
                    dimmed_frame = cv2.convertScaleAbs(frame, alpha=dim_factor, beta=0)
                    
                    # 2. Polygon Mask
                    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
                    cv2.fillPoly(mask, [polygon_points], 255)
                    mask_3ch = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
                    
                    # 3. Pulsing alpha for the plot fill
                    import math
                    if fade_progress < 1.0:
                        alpha = 0.35 * fade_progress
                    else:
                        # Gentle pulse between 0.20 and 0.40 for professional feel
                        alpha = 0.30 + 0.10 * math.sin((frame_idx - ANIM_FRAMES - FADE_FRAMES) * 0.1)
                    
                    # 4. Highlighted area (Original frame + Color tint)
                    highlighted_area = frame.copy()
                    color_overlay = np.zeros_like(frame)
                    cv2.fillPoly(color_overlay, [polygon_points], color_bgr)
                    highlighted_area = cv2.addWeighted(highlighted_area, 1.0, color_overlay, alpha, 0)
                    
                    # 5. Combine using mask
                    frame = np.where(mask_3ch == 255, highlighted_area, dimmed_frame)

                    # 6. Draw glowing borders
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=color_bgr, thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=(255, 255, 255), thickness=request.border_thickness + 1, lineType=cv2.LINE_AA)
                    
                    # Draw plot name label
                    if request.label and pil_font:
                        min_y_idx = np.argmin(polygon_points[:, 1])
                        
                        label_text = request.label
                        bbox = pil_font.getbbox(label_text)
                        text_w = bbox[2] - bbox[0]
                        text_h = bbox[3] - bbox[1]
                        
                        label_x = polygon_points[min_y_idx][0] - text_w // 2
                        label_y = polygon_points[min_y_idx][1] - text_h - 40
                        
                        label_x = max(15, min(label_x, width - text_w - 20))
                        label_y = max(text_h + 20, min(label_y, height - 20))

                        TEXT_ANIM_FRAMES = 15
                        frames_since_anim = frame_idx - ANIM_FRAMES
                        
                        if frames_since_anim >= 0:
                            if frames_since_anim < TEXT_ANIM_FRAMES:
                                t = frames_since_anim / TEXT_ANIM_FRAMES
                                y_offset = int((1.0 - t) * 50)
                                opacity = int(t * 255)
                            else:
                                y_offset = 0
                                opacity = 255
                                
                            label_y += y_offset
                            
                            img_pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                            txt_layer = Image.new('RGBA', img_pil.size, (255, 255, 255, 0))
                            d = ImageDraw.Draw(txt_layer)
                            
                            shadow_offset = max(2, int(width / 350.0))
                            d.text((label_x + shadow_offset, label_y + shadow_offset), label_text, font=pil_font, fill=(0, 0, 0, int(opacity * 0.7)))
                            d.text((label_x, label_y), label_text, font=pil_font, fill=(255, 250, 240, opacity))
                            
                            img_pil = Image.alpha_composite(img_pil.convert('RGBA'), txt_layer).convert('RGB')
                            frame = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
            out.write(frame)

        # Write first frame unhighlighted for smooth transition
        out.write(first_frame)

    # Now write the rest of the video
    while True:
        success, frame = cap.read()
        if not success:
            break
        out.write(frame)

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
    for path in [temp_video_path, final_output_path, source_local_path]:
        if os.path.exists(path):
            os.remove(path)

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

    # Step A+B: Dono videos ko directly MinIO se local temp files mein download karo
    # (presigned URLs + FFmpeg copy bhi Windows pe fail hota hai sometimes)
    highlighted_local = os.path.join(temp_dir, "highlighted.mp4")
    original_local = os.path.join(temp_dir, "original.mp4")

    try:
        minio_client.fget_object(MINIO_BUCKET, highlighted_object_name, highlighted_local)
        minio_client.fget_object(MINIO_BUCKET, original_object_name, original_local)
    except Exception as e:
        print(f"[merge-audio] MinIO download failed: {e}")
        raise HTTPException(status_code=404, detail=f"File not found in MinIO: {str(e)}")

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
