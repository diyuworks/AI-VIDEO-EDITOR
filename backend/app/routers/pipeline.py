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
from app.routers.export import generate_srt

router = APIRouter()


class GenerateReelRequest(BaseModel):
    raw_video_object_name: str        # Original upload
    highlighted_video_object_name: str  # Step 4 ka output (visual-only, no audio)
    reference_object_name: Optional[str] = None  # Style-reference video (agar hai)
    prompt: Optional[str] = None
    structured_options: Optional[dict] = None


@router.post("/generate-reel")
async def generate_reel(request: GenerateReelRequest, session: Session = Depends(get_session)):
    """
    Master pipeline: Highlighted video + AI Script + AI Voiceover + Captions = Final Reel
    NOTE: This is a backend-only pipeline. For live-preview, use the TimelineEditor logic.
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT

    temp_dir = tempfile.mkdtemp()

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
        plan_res = generate_editing_plan(plan_req, session)
        generated_script = plan_res["editing_plan"]["generated_script"]
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
    # This reuses the proven export flow that gives the "real feel" captions and voice.
    import uuid as _uuid
    import ffmpeg
    from app.routers.export import generate_srt, TMP_DIR

    export_id = str(_uuid.uuid4())
    
    # Download highlighted video to tmp_exports (same folder export.py uses)
    video_path = os.path.join(TMP_DIR, f"{export_id}_source.mp4")
    srt_path = os.path.join(TMP_DIR, f"{export_id}_subs.srt")
    output_path = os.path.join(TMP_DIR, f"{export_id}_final.mp4")
    
    try:
        highlighted_url = minio_client.presigned_get_object(
            MINIO_BUCKET, request.highlighted_video_object_name, expires=timedelta(minutes=20)
        )
        subprocess.run(["ffmpeg", "-y", "-i", highlighted_url, "-c", "copy", video_path],
                       check=True, capture_output=True)

        # Get audio duration
        probe_audio = ffmpeg.probe(audio_path)
        audio_duration = float(probe_audio['format']['duration'])
        
        # Get video duration
        probe_video = ffmpeg.probe(video_path)
        video_info = next(s for s in probe_video['streams'] if s['codec_type'] == 'video')
        video_duration = float(probe_video['format']['duration'])
        
        # ALWAYS keep natural voice speed. Do not stretch/slow audio to fit video.
        speed_ratio = 1.0
        
        # Generate SRT file (exact same function as old export)
        generate_srt(generated_script, audio_duration, srt_path, word_boundaries, speed_ratio)
        
        # Windows path escaping — same approach as export.py (tmp_exports is a relative folder)
        srt_path_ffmpeg = srt_path.replace('\\', '/')
        
        width = int(video_info['width'])
        height = int(video_info['height'])

        input_video = ffmpeg.input(video_path)
        input_audio = ffmpeg.input(audio_path)
        
        # Convert video to 9:16 Reels format (crop center)
        # Trim video to exactly the audio length so we don't have awkward silence.
        crop_w = 'min(iw,ih*9/16)'
        crop_h = 'min(ih,iw*16/9)'
        video_scaled = (
            input_video.video
            .trim(duration=audio_duration)
            .setpts('PTS-STARTPTS')
            .filter('fps', fps=25)
            .filter('crop', crop_w, crop_h)
            .filter('setsar', '1')
            .filter('format', 'yuv420p')
        )
        
        # We need to get the new width/height for the end screen based on 9:16
        reel_width = int(min(width, height * 9 / 16))
        reel_height = int(min(height, width * 16 / 9))
        
        # Setup end screen image stream (5 seconds) — EXACT same as export.py
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
            # Fallback: agar end_screen na mile toh bina end screen ke
            video_for_subs = video_scaled
        
        # Adding subtitles with premium Reel styling (Bold, White text, heavy black outline)
        # Reduced FontSize to 18 and increased MarginV to 80 for a more professional, smaller look in 9:16 format.
        style = "FontName=Nirmala UI,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=80,Bold=-1"
        filtered_video = video_for_subs.filter('subtitles', srt_path_ffmpeg, force_style=style)
        
        # Keep original natural audio stream
        audio_stream = input_audio.audio
        
        (
            ffmpeg
            .output(filtered_video, audio_stream, output_path, vcodec='libx264', acodec='aac')
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

    # Get presigned URL so frontend can download it without AccessDenied error
    final_url = minio_client.presigned_get_object(
        MINIO_BUCKET, final_object_name, expires=timedelta(days=7)
    )

    return {
        "success": True,
        "final_object_name": final_object_name,
        "url": final_url,
        "script_used": generated_script,
    }
