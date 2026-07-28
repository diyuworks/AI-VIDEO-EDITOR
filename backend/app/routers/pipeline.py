import os
import tempfile
import subprocess
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlmodel import Session
from app.database import get_session

# Real functions from our existing routers
from app.routers.editing_plan import generate_editing_plan, EditingPlanRequest
from app.routers.tts import generate_tts, TTSRequest

TMP_DIR = "tmp_exports"
os.makedirs(TMP_DIR, exist_ok=True)

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
                    
                    if i + 1 < len(word_boundaries):
                        next_word_start = word_boundaries[i+1]["start"] / speed_ratio
                        gap = next_word_start - end_time
                        if 0 < gap < 1.0:
                            end_time = next_word_start
                        elif gap >= 1.0:
                            end_time += 0.3
                    else:
                        end_time += 5.5
                        
                    text = " ".join([w["text"] for w in current_chunk])
                    
                    f.write(f"{chunk_idx}\n")
                    f.write(f"{format_time(start_time)} --> {format_time(end_time)}\n")
                    f.write(f"{text}\n\n")
                    
                    chunk_idx += 1
                    current_chunk = []
        return

    clean_text = script_text.strip()
    words = clean_text.split()
    chunks = []
    
    current_chunk = []
    for i, w in enumerate(words):
        current_chunk.append(w)
        
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

router = APIRouter()


class GenerateReelRequest(BaseModel):
    raw_video_object_name: str        # Original upload
    highlighted_video_object_name: str  # Step 4 ka output (visual-only, no audio)
    reference_object_name: Optional[str] = None  # Style-reference video (agar hai)
    prompt: Optional[str] = None
    structured_options: Optional[dict] = None


class MergeClipsRequest(BaseModel):
    clip_object_names: list  # e.g. ["clip_1.mp4", "clip_2.mp4", ...]


@router.post("/merge-clips")
async def merge_clips(request: MergeClipsRequest):
    """
    Merges multiple video/image motion clips into a single continuous video file
    and uploads to MinIO.
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET
    import uuid
    import ffmpeg
    from io import BytesIO

    if not request.clip_object_names:
        raise HTTPException(status_code=400, detail="No clips provided for merging")

    merged_id = f"merged_{uuid.uuid4().hex[:8]}.mp4"
    temp_dir = tempfile.mkdtemp()
    local_clip_paths = []

    try:
        # Download clips or copy local demo/uploaded clips
        for idx, name in enumerate(request.clip_object_names):
            local_p = os.path.join(temp_dir, f"clip_{idx}.mp4")
            upload_p = os.path.join("uploads", name)
            demo_p = os.path.join("demo_clips", name)
            if os.path.exists(upload_p):
                import shutil
                shutil.copy(upload_p, local_p)
            elif os.path.exists(demo_p):
                import shutil
                shutil.copy(demo_p, local_p)
            else:
                try:
                    minio_client.fget_object(MINIO_BUCKET, name, local_p)
                except Exception as e:
                    raise HTTPException(status_code=404, detail=f"Clip {name} not found on disk or MinIO: {str(e)}")
            local_clip_paths.append(local_p)

        # Create FFmpeg concat list
        concat_txt = os.path.join(temp_dir, "concat.txt")
        with open(concat_txt, "w") as f:
            for p in local_clip_paths:
                clean_p = p.replace('\\', '/')
                f.write(f"file '{clean_p}'\n")

        output_path = os.path.join(temp_dir, "output_merged.mp4")
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_txt,
            "-c", "copy",
            output_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg concat failed: {res.stderr}")

        # Upload merged output to MinIO
        with open(output_path, "rb") as f:
            data = f.read()

        minio_client.put_object(
            MINIO_BUCKET, merged_id,
            data=BytesIO(data), length=len(data), content_type="video/mp4"
        )

        presigned_url = minio_client.presigned_get_object(
            MINIO_BUCKET, merged_id, expires=timedelta(days=7)
        )

        return {
            "success": True,
            "merged_object_name": merged_id,
            "url": presigned_url,
            "clips_count": len(request.clip_object_names)
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")


@router.post("/generate-reel")
async def generate_reel(request: GenerateReelRequest, session: Session = Depends(get_session)):
    """
    Master pipeline: Highlighted video + AI Script + AI Voiceover + Captions = Final Reel
    NOTE: This is a backend-only pipeline. For live-preview, use the TimelineEditor logic.
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT

    TEMPORARY_DISABLE_VOICEOVER = False  # Voiceover ON, captions will NOT be shown on screen

    temp_dir = tempfile.mkdtemp()
    generated_script = ""
    word_boundaries = []
    audio_path = None

    if not TEMPORARY_DISABLE_VOICEOVER:
        # ---- SUB-STEP A: AI Script Generate Karo ----
        try:
            from app.routers.captions import generate_captions
            
            reference_captions = None
            if request.reference_object_name:
                try:
                    cap_res = generate_captions(request.reference_object_name, session)
                    reference_captions = cap_res.get("captions")
                except Exception as e:
                    with open("debug.log", "a", encoding="utf-8") as f: f.write(f"Warning: Failed to fetch reference captions: {str(e)}\n")

            # Call our actual editing_plan endpoint logic
            plan_req = EditingPlanRequest(
                object_name=request.raw_video_object_name,
                reference_object_name=request.reference_object_name,
                reference_captions=reference_captions,
                prompt=request.prompt,
                structured_options=request.structured_options
            )
            plan_req = generate_editing_plan(plan_req, session)
            generated_script = plan_req["editing_plan"]["generated_script"]
        except Exception as e:
            with open("debug.log", "a") as f: f.write(f"Script Error: {str(e)}\n")
            raise HTTPException(status_code=500, detail=f"Script generation failed: {str(e)}")

        # ---- SUB-STEP B: TTS + Word Timestamps Generate Karo ----
        try:
            # Call our actual TTS endpoint logic
            tts_req = TTSRequest(text=generated_script)
            tts_res = await generate_tts(tts_req)
            
            # Copy TTS audio from local tts_output to temp dir
            import shutil
            source_audio_path = os.path.join("tts_output", f"{tts_res['audio_id']}.mp3")
            audio_path = os.path.join(temp_dir, f"{tts_res['audio_id']}.mp3")
            shutil.copy(source_audio_path, audio_path)
            word_boundaries = tts_res["word_boundaries"]
        except Exception as e:
            with open("debug.log", "a", encoding="utf-8") as f: f.write(f"TTS Error: {str(e)} | Script: {generated_script}\n")
            raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

    # ---- SUB-STEP C+D: Use EXACT same export.py logic for captions + voice ----
    import uuid as _uuid
    import ffmpeg

    export_id = str(_uuid.uuid4())
    
    # Download highlighted video to tmp_exports
    video_path = os.path.join(TMP_DIR, f"{export_id}_source.mp4")
    srt_path = os.path.join(TMP_DIR, f"{export_id}_subs.srt")
    output_path = os.path.join(TMP_DIR, f"{export_id}_final.mp4")
    
    try:
        highlighted_url = minio_client.presigned_get_object(
            MINIO_BUCKET, request.highlighted_video_object_name, expires=timedelta(minutes=20)
        )
        subprocess.run(["ffmpeg", "-y", "-i", highlighted_url, "-c", "copy", video_path],
                       check=True, capture_output=True)

        # Get video duration
        probe_video = ffmpeg.probe(video_path)
        video_info = next(s for s in probe_video['streams'] if s['codec_type'] == 'video')
        video_duration = float(probe_video['format']['duration'])
        
        has_audio = any(s['codec_type'] == 'audio' for s in probe_video['streams'])
        
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
        
        # Setup end screen image stream (5 seconds)
        end_screen_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets", "end_screen.PNG")
        if os.path.exists(end_screen_path):
            image_stream = ffmpeg.input(end_screen_path, loop=1, t=5)
            image_scaled = (
                image_stream
                .filter('fps', fps=25)
                .filter('scale', reel_width, reel_height, force_original_aspect_ratio='decrease')
                .filter('pad', reel_width, reel_height, '(ow-iw)/2', '(oh-ih)/2')
                .filter('setsar', '1')
                .filter('format', 'yuv420p')
            )
            video_for_subs = ffmpeg.concat(video_scaled, image_scaled, v=1, a=0)
        else:
            video_for_subs = video_scaled

        # Overlay logo watermark if jamin24_logo.png exists in assets/ folder
        logo_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets", "jamin24_logo.png")
        if os.path.exists(logo_path):
            logo_input = ffmpeg.input(logo_path)
            logo_scaled = logo_input.filter('scale', 120, -1)
            video_for_subs = ffmpeg.overlay(video_for_subs, logo_scaled, x='main_w-overlay_w-20', y='20')

        # Voiceover audio ON but subtitles/captions NOT burned onto video (text stays off screen)
        if audio_path:
            input_audio = ffmpeg.input(audio_path)
            audio_stream = input_audio.audio
            ffmpeg_out = ffmpeg.output(video_for_subs, audio_stream, output_path, vcodec='libx264', acodec='aac')
        elif has_audio:
            audio_stream = input_video.audio
            ffmpeg_out = ffmpeg.output(video_for_subs, audio_stream, output_path, vcodec='libx264', acodec='aac')
        else:
            ffmpeg_out = ffmpeg.output(video_for_subs, output_path, vcodec='libx264')
        
        (
            ffmpeg_out
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        
        final_output_path = output_path
        
    except ffmpeg.Error as e:
        error_message = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {error_message}")
    except Exception as e:
        with open("debug.log", "a") as f: f.write(f"Export Error: {str(e)}\n")
        raise HTTPException(status_code=500, detail=f"Export pipeline failed: {str(e)}")

    # ---- SUB-STEP E: Final Video Upload Karo ----
    final_object_name = f"reel_{request.raw_video_object_name}"
    with open(final_output_path, "rb") as f:
        file_data = f.read()

    from io import BytesIO
    minio_client.put_object(
        MINIO_BUCKET, final_object_name,
        data=BytesIO(file_data), length=len(file_data), content_type="video/mp4",
    )

    final_url = minio_client.presigned_get_object(
        MINIO_BUCKET, final_object_name, expires=timedelta(days=7)
    )

    try:
        from app.services.email_service import notify_reel_generated
        notify_reel_generated(
            reel_type="Real Estate Promo Reel",
            clip_count=1,
            prompt_text=request.prompt or "Default Real Estate Prompt"
        )
    except Exception as ex:
        print(f"Warning: Failed to send email alert for reel generation: {ex}")

    return {
        "success": True,
        "final_object_name": final_object_name,
        "url": final_url,
        "script_used": generated_script,
    }
