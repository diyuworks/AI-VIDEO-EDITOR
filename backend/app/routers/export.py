import os
import uuid
import tempfile
import json
import cv2
import numpy as np
import base64
import ffmpeg
import re
from typing import List, Optional, Tuple
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import MINIO_BUCKET
from app.routers.uploads import minio_client

router = APIRouter()

EXPORT_DIR = "export_output"
os.makedirs(EXPORT_DIR, exist_ok=True)
TMP_DIR = "tmp_exports"
os.makedirs(TMP_DIR, exist_ok=True)

# --- Schemas ---

class ClipSchema(BaseModel):
    id: str
    track: str
    start: float
    end: float
    label: str
    text: Optional[str] = None
    overlayKind: Optional[str] = None
    boxLeftPct: Optional[float] = None
    boxTopPct: Optional[float] = None
    boxWidthPct: Optional[float] = None
    boxHeightPct: Optional[float] = None
    imageDataUrl: Optional[str] = None
    boxPath: Optional[List[dict]] = None
    polygonPath: Optional[List[dict]] = None

class ExportRequest(BaseModel):
    object_name: str
    clips: List[ClipSchema]

class ReelExportRequest(BaseModel):
    object_name: str
    audio_id: str
    generated_script: str
    word_boundaries: Optional[list] = None

# --- Jay's Helper Functions & Endpoints ---

def generate_srt(script_text: str, duration_sec: float, filepath: str, word_boundaries: list = None, speed_ratio: float = 1.0):
    def format_time(seconds):
        ms = int((seconds % 1) * 1000)
        s = int(seconds)
        m = s // 60
        h = m // 60
        s = s % 60
        m = m % 60
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    if word_boundaries and len(word_boundaries) > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            chunk_idx = 1
            current_chunk = []
            for i, wb in enumerate(word_boundaries):
                current_chunk.append(wb)
                
                is_sentence_end = any(p in wb["text"] for p in ['.', '!', '?', '।'])
                is_comma = ',' in wb["text"]
                
                if len(current_chunk) >= 6 or is_sentence_end or (is_comma and len(current_chunk) >= 4) or i == len(word_boundaries) - 1:
                    start_time = current_chunk[0]["start"] / speed_ratio
                    end_time = current_chunk[-1]["end"] / speed_ratio
                    
                    # Prevent flickering: Bridge short silences between words
                    if i + 1 < len(word_boundaries):
                        next_word_start = word_boundaries[i+1]["start"] / speed_ratio
                        gap = next_word_start - end_time
                        if 0 < gap < 1.0:
                            end_time = next_word_start
                        elif gap >= 1.0:
                            end_time += 0.3
                    else:
                        end_time += 5.5  # final word padding + 5s for end screen
                        
                    text = " ".join([w["text"] for w in current_chunk])
                    
                    f.write(f"{chunk_idx}\n")
                    f.write(f"{format_time(start_time)} --> {format_time(end_time)}\n")
                    f.write(f"{text}\n\n")
                    
                    chunk_idx += 1
                    current_chunk = []
        return

    # Fallback Smart chunking: respect punctuation and group 2-3 words for natural reading
    clean_text = script_text.strip()
    words = clean_text.split()
    chunks = []
    
    current_chunk = []
    for i, w in enumerate(words):
        current_chunk.append(w)
        
        # Break chunk if we hit punctuation, or if chunk is 3 words, or if it's 2 words and the next word is long
        has_punctuation = any(p in w for p in [',', '.', '!', '?', '।'])
        if has_punctuation or len(current_chunk) >= 3 or (len(current_chunk) >= 2 and i + 1 < len(words) and len(words[i+1]) > 5) or i == len(words) - 1:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            
    if not chunks:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("")
        return

    actual_duration = duration_sec / speed_ratio
    time_per_chunk = actual_duration / len(chunks)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        for i, chunk in enumerate(chunks):
            start_time = i * time_per_chunk
            end_time = (i + 1) * time_per_chunk
            
            if i == len(chunks) - 1:
                end_time += 5.0
            
            f.write(f"{i+1}\n")
            f.write(f"{format_time(start_time)} --> {format_time(end_time)}\n")
            f.write(f"{chunk}\n\n")

@router.post("/export")
async def export_reel(request: ReelExportRequest):
    export_id = str(uuid.uuid4())
    TEMPORARY_DISABLE_VOICEOVER = False  # Set to False to restore AI script, voiceover & captions
    
    # Paths
    audio_path = None
    if not TEMPORARY_DISABLE_VOICEOVER:
        audio_path = os.path.join("tts_output", f"{request.audio_id}.mp3")
        if not os.path.exists(audio_path):
            raise HTTPException(status_code=400, detail="Audio file not found")
        
    video_path = os.path.join(TMP_DIR, f"{export_id}_source.mp4")
    srt_path = os.path.join(TMP_DIR, f"{export_id}_subs.srt")
    output_path = os.path.join(TMP_DIR, f"{export_id}_final.mp4")
    
    try:
        # 1. Download original video
        minio_client.fget_object(MINIO_BUCKET, request.object_name, video_path)
        
        # Get video duration
        probe_video = ffmpeg.probe(video_path)
        video_info = next(s for s in probe_video['streams'] if s['codec_type'] == 'video')
        video_duration = float(probe_video['format']['duration'])
        
        has_audio = any(s['codec_type'] == 'audio' for s in probe_video['streams'])
        
        # 2. Get audio duration
        if not TEMPORARY_DISABLE_VOICEOVER and audio_path:
            probe_audio = ffmpeg.probe(audio_path)
            audio_duration = float(probe_audio['format']['duration'])
            trim_duration = audio_duration
        else:
            trim_duration = video_duration
        
        width = int(video_info['width'])
        height = int(video_info['height'])
 
        input_video = ffmpeg.input(video_path)
        
        # Convert video to 9:16 Reels format (crop center)
        crop_w = 'min(iw,ih*9/16)'
        crop_h = 'min(ih,iw*16/9)'
        video_scaled = (
            input_video.video
            .trim(duration=trim_duration)
            .setpts('PTS-STARTPTS')
            .filter('fps', fps=25)
            .filter('crop', crop_w, crop_h)
            .filter('setsar', '1')
            .filter('format', 'yuv420p')
        )
        
        # We need to get the new width/height for the end screen based on 9:16
        reel_width = int(min(width, height * 9 / 16))
        reel_height = int(min(height, width * 16 / 9))
        
        # Setup end screen image stream
        image_stream = ffmpeg.input("assets/end_screen_animated.mp4")
        image_scaled = (
            image_stream
            .filter('fps', fps=25)
            .filter('scale', reel_width, reel_height, force_original_aspect_ratio='decrease')
            .filter('pad', reel_width, reel_height, '(ow-iw)/2', '(oh-ih)/2')
            .filter('setsar', '1')
            .filter('format', 'yuv420p')
        )
        
        # Concat video and image
        concat_video = ffmpeg.concat(video_scaled, image_scaled, v=1, a=0)
 
        # Overlay logo watermark if jamin24_logo.png exists in assets/ folder
        logo_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets", "jamin24_logo.png")
        if os.path.exists(logo_path):
            logo_input = ffmpeg.input(logo_path)
            logo_scaled = logo_input.filter('scale', 120, -1)
            concat_video = ffmpeg.overlay(concat_video, logo_scaled, x='main_w-overlay_w-20', y='20')
        
        if not TEMPORARY_DISABLE_VOICEOVER:
            # 3. Generate SRT file
            generate_srt(request.generated_script, trim_duration, srt_path, request.word_boundaries, 1.0)
            srt_path_ffmpeg = srt_path.replace('\\', '/')
            
            style = "FontName=Nirmala UI,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=80,Bold=-1"
            filtered_video = concat_video.filter('subtitles', srt_path_ffmpeg, force_style=style)
            
            input_audio = ffmpeg.input(audio_path)
            
            if has_audio:
                total_dur = video_duration + 5.0
                bg_audio = ffmpeg.input(video_path, stream_loop=-1).audio.filter('volume', '0.15').filter('atrim', duration=total_dur)
                mixed_audio = ffmpeg.filter([input_audio.audio, bg_audio], 'amix', inputs=2, duration='longest')
                final_audio = mixed_audio
            else:
                final_audio = input_audio.audio
                
            ffmpeg_out = ffmpeg.output(filtered_video, final_audio, output_path, vcodec='libx264', acodec='aac')
        else:
            filtered_video = concat_video
            if has_audio:
                audio_stream = input_video.audio
                ffmpeg_out = ffmpeg.output(filtered_video, audio_stream, output_path, vcodec='libx264', acodec='aac')
            else:
                ffmpeg_out = ffmpeg.output(filtered_video, output_path, vcodec='libx264')
        
        (
            ffmpeg_out
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        
    except ffmpeg.Error as e:
        error_message = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {error_message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
    
    # We return the file directly so the browser can download it.
    return FileResponse(
        output_path, 
        media_type='video/mp4', 
        filename="AI_Edited_Video.mp4",
        headers={"Content-Disposition": "attachment; filename=AI_Edited_Video.mp4"}
    )

# --- Diya's Helper Functions & Endpoints ---

def interpolate_polygon(path: List[dict], t: float, frame_w: int, frame_h: int) -> np.ndarray:
    def get_pts(p):
        return p.get("pointsPct") or p.get("points_pct")

    if t <= path[0]["time"]:
        pts_pct = get_pts(path[0])
    elif t >= path[-1]["time"]:
        pts_pct = get_pts(path[-1])
    else:
        pts_pct = None
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            if a["time"] <= t <= b["time"]:
                ratio = (t - a["time"]) / (b["time"] - a["time"]) if b["time"] != a["time"] else 0
                a_pts = get_pts(a)
                b_pts = get_pts(b)
                pts_pct = [
                    [
                        a_pts[j][0] + (b_pts[j][0] - a_pts[j][0]) * ratio,
                        a_pts[j][1] + (b_pts[j][1] - a_pts[j][1]) * ratio,
                    ]
                    for j in range(len(a_pts))
                ]
                break
        if pts_pct is None:
            pts_pct = get_pts(path[-1])
    
    return np.array([
        [int(x * frame_w / 100), int(y * frame_h / 100)]
        for x, y in pts_pct
    ], dtype=np.int32)

def interpolate_box(path: List[dict], t: float) -> dict:
    def get_val(p, key_camel, key_snake):
        val = p.get(key_camel)
        if val is None:
            val = p.get(key_snake)
        return float(val) if val is not None else 0.0

    if t <= path[0]["time"]:
        a = path[0]
    elif t >= path[-1]["time"]:
        a = path[-1]
    else:
        a = None
        for i in range(len(path) - 1):
            p1 = path[i]
            p2 = path[i + 1]
            if p1["time"] <= t <= p2["time"]:
                ratio = (t - p1["time"]) / (p2["time"] - p1["time"]) if p2["time"] != p1["time"] else 0
                return {
                    "x_pct": get_val(p1, "xPct", "x_pct") + (get_val(p2, "xPct", "x_pct") - get_val(p1, "xPct", "x_pct")) * ratio,
                    "y_pct": get_val(p1, "yPct", "y_pct") + (get_val(p2, "yPct", "y_pct") - get_val(p1, "yPct", "y_pct")) * ratio,
                    "width_pct": get_val(p1, "widthPct", "width_pct") + (get_val(p2, "widthPct", "width_pct") - get_val(p1, "widthPct", "width_pct")) * ratio,
                    "height_pct": get_val(p1, "heightPct", "height_pct") + (get_val(p2, "heightPct", "height_pct") - get_val(p1, "heightPct", "height_pct")) * ratio,
                }
        if a is None:
            a = path[-1]

    return {
        "x_pct": get_val(a, "xPct", "x_pct"),
        "y_pct": get_val(a, "yPct", "y_pct"),
        "width_pct": get_val(a, "widthPct", "width_pct"),
        "height_pct": get_val(a, "heightPct", "height_pct"),
    }

def draw_text_with_stroke(img: np.ndarray, text: str, org: Tuple[int, int], font_face: int, font_scale: float, color: Tuple[int, int, int], thickness: int, stroke_thickness: int):
    # Draw outline (black)
    cv2.putText(img, text, org, font_face, font_scale, (0, 0, 0), stroke_thickness, cv2.LINE_AA)
    # Draw inner text
    cv2.putText(img, text, org, font_face, font_scale, color, thickness, cv2.LINE_AA)

@router.post("/export-video")
async def export_video(req: ExportRequest):
    if not req.object_name:
        raise HTTPException(status_code=400, detail="Missing object_name")

    # Download raw video to temp path
    tmp_input_path = os.path.join(tempfile.gettempdir(), f"export_in_{uuid.uuid4().hex}.mp4")
    try:
        minio_client.fget_object(MINIO_BUCKET, req.object_name, tmp_input_path)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Source video not found in MinIO: {str(e)}")

    output_filename = f"export_{uuid.uuid4().hex}.mp4"
    output_filepath = os.path.join(EXPORT_DIR, output_filename)

    cap = cv2.VideoCapture(tmp_input_path)
    if not cap.isOpened():
        raise HTTPException(status_code=500, detail="Failed to open video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if fps <= 0 or frame_w <= 0 or frame_h <= 0:
        cap.release()
        raise HTTPException(status_code=500, detail="Invalid video metadata")

    video_clips = [c for c in req.clips if c.track == "video"]
    if video_clips:
        timeline_duration = max(c.end for c in video_clips)
    else:
        timeline_duration = total_frames / fps

    total_render_frames = int(timeline_duration * fps)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_filepath, fourcc, fps, (frame_w, frame_h))

    try:
        for f_idx in range(total_render_frames):
            t = f_idx / fps
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(f_idx, total_frames - 1))
            ok, frame = cap.read()
            if not ok:
                break

            overlays = [c for c in req.clips if c.track == "overlay" and c.start <= t < c.end]

            for overlay in overlays:
                if overlay.overlayKind == "autoBoundaryPrecise" and overlay.polygonPath:
                    poly_pts = interpolate_polygon(overlay.polygonPath, t, frame_w, frame_h)
                    overlay_layer = frame.copy()
                    cv2.fillPoly(overlay_layer, [poly_pts], (0, 255, 255))
                    frame = cv2.addWeighted(overlay_layer, 0.35, frame, 0.65, 0)
                    cv2.polylines(frame, [poly_pts], isClosed=True, color=(0, 0, 255), thickness=3)

                    min_y_idx = np.argmin(poly_pts[:, 1])
                    label_x = poly_pts[min_y_idx][0]
                    label_y = poly_pts[min_y_idx][1] - 15
                    
                    label_text = overlay.label or "Plot"
                    (text_w, text_h), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                    cv2.rectangle(frame, 
                                  (label_x - 5, label_y - text_h - 8),
                                  (label_x + text_w + 5, label_y + 5),
                                  (0, 255, 255), -1)
                    cv2.putText(frame, label_text, (label_x, label_y),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                elif overlay.overlayKind == "caption" and overlay.text:
                    font_scale = 0.8
                    font_thickness = 2
                    stroke_thickness = 5
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    
                    (text_w, text_h), _ = cv2.getTextSize(overlay.text, font, font_scale, font_thickness)
                    text_x = int((frame_w - text_w) / 2)
                    text_y = int(frame_h - 40)
                    
                    draw_text_with_stroke(frame, overlay.text, (text_x, text_y), font, font_scale, (255, 255, 255), font_thickness, stroke_thickness)

                elif overlay.overlayKind == "boundary":
                    left = int((overlay.boxLeftPct or 25) * frame_w / 100)
                    top = int((overlay.boxTopPct or 25) * frame_h / 100)
                    width = int((overlay.boxWidthPct or 40) * frame_w / 100)
                    height = int((overlay.boxHeightPct or 30) * frame_h / 100)

                    cv2.rectangle(frame, (left, top), (left + width, top + height), (0, 255, 255), 3)
                    
                    label_text = overlay.label or "Plot"
                    cv2.putText(frame, label_text, (left + 5, top + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                elif overlay.overlayKind == "logo" and overlay.imageDataUrl:
                    try:
                        head, data_b64 = overlay.imageDataUrl.split(',', 1)
                        logo_data = base64.b64decode(data_b64)
                        logo_np = np.frombuffer(logo_data, dtype=np.uint8)
                        logo_img = cv2.imdecode(logo_np, cv2.IMREAD_UNCHANGED)
                        
                        if logo_img is not None:
                            logo_w = int((overlay.boxWidthPct or 20) * frame_w / 100)
                            logo_h = int((overlay.boxHeightPct or 15) * frame_h / 100)
                            logo_resized = cv2.resize(logo_img, (logo_w, logo_h))
                            
                            left = int((overlay.boxLeftPct or 70) * frame_w / 100)
                            top = int((overlay.boxTopPct or 5) * frame_h / 100)
                            
                            left = max(0, min(left, frame_w - logo_w))
                            top = max(0, min(top, frame_h - logo_h))
                            
                            if logo_resized.shape[2] == 4:
                                alpha = logo_resized[:, :, 3] / 255.0
                                for c in range(3):
                                    frame[top:top+logo_h, left:left+logo_w, c] = (
                                        alpha * logo_resized[:, :, c] + (1 - alpha) * frame[top:top+logo_h, left:left+logo_w, c]
                                    )
                            else:
                                frame[top:top+logo_h, left:left+logo_w] = logo_resized[:, :, :3]
                    except Exception as logo_err:
                        print(f"Failed to overlay logo: {logo_err}")

            out.write(frame)

    finally:
        cap.release()
        out.release()
        try:
            os.unlink(tmp_input_path)
        except:
            pass

    return {
        "success": True,
        "filename": output_filename,
        "download_url": f"/export-file/{output_filename}"
    }

@router.get("/export-file/{filename}")
async def get_export_file(filename: str):
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Exported video file not found")
    return FileResponse(filepath, media_type="video/mp4")
