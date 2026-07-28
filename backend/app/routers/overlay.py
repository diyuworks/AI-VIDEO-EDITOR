import cv2
import numpy as np
import tempfile
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont
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
    enable_farmhouse_overlay: bool = False
    enable_fountain_overlay: bool = False
    text_position: str = "middle"  # "middle" or "outro"


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
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Normalize resolution to max 1080x1920 to prevent RAM exhaustion on 4K/60fps video clips
    MAX_W, MAX_H = 1080, 1920
    scale_factor = min(MAX_W / float(orig_w), MAX_H / float(orig_h), 1.0)
    width = int(orig_w * scale_factor)
    height = int(orig_h * scale_factor)

    # Step B: Temporary output file banao (bina audio ke, sirf video)
    temp_video_path = os.path.join(temp_dir, "overlay_temp.mp4")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))
    if not out.isOpened():
        print("Warning: VideoWriter failed with mp4v, trying XVID fallback...")
        fourcc = cv2.VideoWriter_fourcc(*"XVID")
        out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))
    if not out.isOpened():
        print("Warning: VideoWriter failed with MJPG fallback...")
        fourcc = cv2.VideoWriter_fourcc(*"MJPG")
        out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))
    if not out.isOpened():
        raise Exception("VideoWriter failed to open with all codecs!")

    color_bgr = hex_to_bgr(request.highlight_color)
    total_polygon_frames = len(request.polygon_per_frame)

    # Load 3D assets if enabled
    assets_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets")
    farmhouse_img = None
    if request.enable_farmhouse_overlay:
        fh_path = os.path.join(assets_dir, "farmhouse_render.png")
        if os.path.exists(fh_path):
            farmhouse_img = cv2.imread(fh_path, cv2.IMREAD_UNCHANGED)

    fountain_img = None
    if request.enable_fountain_overlay:
        ft_path = os.path.join(assets_dir, "fountain.png")
        if os.path.exists(ft_path):
            fountain_img = cv2.imread(ft_path, cv2.IMREAD_UNCHANGED)

    frame_idx = 0
    while True:
        success, frame = cap.read()
        if not success:
            break

        if scale_factor < 1.0:
            frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)

        # Agar is frame ke liye polygon data available hai
        if frame_idx < total_polygon_frames:
            raw_points = np.array(request.polygon_per_frame[frame_idx], dtype=np.float32)
            if scale_factor < 1.0:
                raw_points = raw_points * scale_factor
            polygon_points = raw_points.astype(np.int32)

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
                        cv2.line(frame, p_start, p_end, (0, 0, 0), thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                        cv2.line(frame, p_start, p_end, color_bgr, thickness=request.border_thickness, lineType=cv2.LINE_AA)
                        
                    # Draw current partial tracing segment
                    if K < M:
                        p_start = polygon_points[K]
                        p_next = polygon_points[(K + 1) % M]
                        p_end_x = int(p_start[0] + fr * (p_next[0] - p_start[0]))
                        p_end_y = int(p_start[1] + fr * (p_next[1] - p_start[1]))
                        p_end = (p_end_x, p_end_y)
                        p_start_tuple = tuple(p_start)
                        
                        cv2.line(frame, p_start_tuple, p_end, (0, 0, 0), thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                        cv2.line(frame, p_start_tuple, p_end, color_bgr, thickness=request.border_thickness, lineType=cv2.LINE_AA)
                else:
                    # Border is complete, draw closed polygon outline with anti-aliasing
                    pts = polygon_points.reshape((-1, 1, 2))
                    overlay = frame.copy()
                    
                    # Fill land polygon area
                    cv2.fillPoly(overlay, [polygon_points], color_bgr)
                    
                    # Apply transparency
                    if frame_idx < ANIM_FRAMES + FADE_FRAMES:
                        alpha = 0.2 * ((frame_idx - ANIM_FRAMES) / FADE_FRAMES)
                    else:
                        alpha = 0.2
                    
                    frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

                    # --- 3D FARMHOUSE PERSPECTIVE WARP OVERLAY ---
                    if farmhouse_img is not None and M >= 4:
                        try:
                            fh_h, fh_w = farmhouse_img.shape[:2]
                            src_pts = np.float32([[0, 0], [fh_w, 0], [fh_w, fh_h], [0, fh_h]])
                            dst_pts = polygon_points[:4].astype(np.float32)
                            M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                            warped_fh = cv2.warpPerspective(farmhouse_img, M_persp, (width, height))
                            
                            # Alpha blend warped farmhouse onto frame
                            if warped_fh.shape[2] == 4:
                                alpha_mask = (warped_fh[:, :, 3] / 255.0)[:, :, np.newaxis]
                                frame = (warped_fh[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                            else:
                                frame = cv2.addWeighted(warped_fh, 0.8, frame, 0.2, 0)
                        except Exception as ex_fh:
                            print(f"[overlay] Farmhouse warp error: {ex_fh}")

                    # --- 3D FOUNTAIN PERSPECTIVE WARP OVERLAY ---
                    if fountain_img is not None and M >= 4:
                        try:
                            ft_h, ft_w = fountain_img.shape[:2]
                            src_pts = np.float32([[0, 0], [ft_w, 0], [ft_w, ft_h], [0, ft_h]])
                            dst_pts = polygon_points[:4].astype(np.float32)
                            M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                            warped_ft = cv2.warpPerspective(fountain_img, M_persp, (width, height))
                            
                            # Alpha blend warped fountain onto frame
                            if warped_ft.shape[2] == 4:
                                alpha_mask = (warped_ft[:, :, 3] / 255.0)[:, :, np.newaxis]
                                frame = (warped_ft[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                            else:
                                frame = cv2.addWeighted(warped_ft, 0.8, frame, 0.2, 0)
                        except Exception as ex_ft:
                            print(f"[overlay] Fountain warp error: {ex_ft}")

                    # Draw sleek solid vibrant yellow border with black contrast outline
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=(0, 0, 0), thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=color_bgr, thickness=request.border_thickness + 1, lineType=cv2.LINE_AA)
                    
                    # Draw plot label / large bold typography with 3D drop shadow (matching reference video font)
                    if request.label:
                        min_y_idx = np.argmin(polygon_points[:, 1])
                        top_pt = polygon_points[min_y_idx]
                        
                        # Convert OpenCV BGR frame to PIL RGB image
                        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(img_rgb)
                        draw = ImageDraw.Draw(pil_img)
                        
                        # Ultra-bold font size matching reference video scale
                        font_size = max(42, int(width / 13))
                        font = None
                        for font_path in [r'C:\Windows\Fonts\ariblk.ttf', r'C:\Windows\Fonts\impact.ttf', r'C:\Windows\Fonts\segoeuib.ttf', r'C:\Windows\Fonts\arialbd.ttf']:
                            if os.path.exists(font_path):
                                try:
                                    font = ImageFont.truetype(font_path, font_size)
                                    break
                                except Exception:
                                    pass
                        if font is None:
                            font = ImageFont.load_default()
                            
                        raw_label = request.label.strip().upper()
                        words = raw_label.split()
                        if len(words) == 2 and len(raw_label) >= 8:
                            lines = words
                        else:
                            lines = [raw_label]
                            
                        line_bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
                        line_widths = [b[2] - b[0] for b in line_bboxes]
                        line_heights = [b[3] - b[1] for b in line_bboxes]
                        
                        total_h = sum(line_heights) + (len(lines) - 1) * 10
                        
                        if request.text_position == "outro":
                            start_y = int(height * 0.72)
                        else:
                            start_y = int(top_pt[1] - total_h - 35)
                            start_y = max(30, min(start_y, height - total_h - 30))
                            
                        # Color logic: Neon Yellow (#FFEB3B) for LOCATION/BEST/Outro, else Crisp White (#FFFFFF)
                        if "LOCATION" in raw_label or "BEST" in raw_label or request.text_position == "outro":
                            text_rgb = (255, 235, 59)  # Neon Yellow
                        else:
                            text_rgb = (255, 255, 255)  # Crisp White
                            
                        current_y = start_y
                        for idx_l, line in enumerate(lines):
                            lw = line_widths[idx_l]
                            lh = line_heights[idx_l]
                            if request.text_position == "outro":
                                lx = int((width - lw) / 2)
                            else:
                                lx = int(top_pt[0] - lw / 2)
                            lx = max(20, min(lx, width - lw - 20))
                            
                            # Soft 3D floating drop shadow (layered offsets)
                            for offset in range(1, 5):
                                draw.text((lx + offset, current_y + offset), line, font=font, fill=(0, 0, 0, 180))
                            
                            # Main bold text with clean black outline
                            draw.text((lx, current_y), line, font=font, fill=text_rgb, stroke_width=3, stroke_fill=(0, 0, 0))
                            current_y += lh + 10
                        
                        # Convert back to BGR OpenCV frame
                        frame = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        out.write(frame)
        frame_idx += 1

    cap.release()
    out.release()

    # Step C: FFmpeg se re-encode karo (OpenCV ka codec browser-friendly nahi hota hamesha)
    final_output_path = os.path.join(temp_dir, "overlay_final.mp4")
    try:
        subprocess.run([
            "ffmpeg", "-y", "-i", temp_video_path,
            "-c:v", "libx264", "-preset", "superfast", "-crf", "23", "-pix_fmt", "yuv420p",
            final_output_path
        ], check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print("FFmpeg failed stdout:", e.stdout.decode() if e.stdout else "")
        print("FFmpeg failed stderr:", e.stderr.decode() if e.stderr else "")
        raise e

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
