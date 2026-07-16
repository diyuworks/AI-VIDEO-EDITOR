import os
import uuid
import ffmpeg
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.routers.uploads import minio_client
from app.config import MINIO_BUCKET

router = APIRouter()

class ExportRequest(BaseModel):
    object_name: str
    audio_id: str
    generated_script: str

TMP_DIR = "tmp_exports"
os.makedirs(TMP_DIR, exist_ok=True)

def generate_srt(script_text: str, duration_sec: float, filepath: str):
    # Smart chunking: respect punctuation and group 2-3 words for natural reading
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

    time_per_chunk = duration_sec / len(chunks)
    
    def format_time(seconds):
        ms = int((seconds % 1) * 1000)
        s = int(seconds)
        m = s // 60
        h = m // 60
        s = s % 60
        m = m % 60
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    with open(filepath, 'w', encoding='utf-8') as f:
        for i, chunk in enumerate(chunks):
            start_time = i * time_per_chunk
            end_time = (i + 1) * time_per_chunk
            
            f.write(f"{i+1}\n")
            f.write(f"{format_time(start_time)} --> {format_time(end_time)}\n")
            f.write(f"{chunk}\n\n")

@router.post("/export")
async def export_video(request: ExportRequest):
    export_id = str(uuid.uuid4())
    
    # Paths
    audio_path = os.path.join("tts_output", f"{request.audio_id}.mp3")
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=400, detail="Audio file not found")
        
    video_path = os.path.join(TMP_DIR, f"{export_id}_source.mp4")
    srt_path = os.path.join(TMP_DIR, f"{export_id}_subs.srt")
    output_path = os.path.join(TMP_DIR, f"{export_id}_final.mp4")
    
    try:
        # 1. Download original video
        minio_client.fget_object(MINIO_BUCKET, request.object_name, video_path)
        
        # 2. Get audio duration
        probe = ffmpeg.probe(audio_path)
        audio_duration = float(probe['format']['duration'])
        
        # 3. Generate SRT file
        generate_srt(request.generated_script, audio_duration, srt_path)
        
        # Windows path escaping for ffmpeg subtitles filter is notoriously tricky.
        # It's better to use forward slashes and escape colons if absolute, or use relative paths.
        srt_path_ffmpeg = srt_path.replace('\\', '/')
        
        # 4. Use ffmpeg to combine: video (strip original audio) + new audio + subtitles
        input_video = ffmpeg.input(video_path)
        input_audio = ffmpeg.input(audio_path)
        
        # Adding subtitles with premium Reel styling (Bold, Yellow/Gold text, heavy black outline)
        style = "FontName=Arial,FontSize=28,PrimaryColour=&H0000D7FF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=3,Shadow=2,Alignment=2,MarginV=40,Bold=-1"
        
        filtered_video = input_video.video.filter('subtitles', srt_path_ffmpeg, force_style=style)
        
        # We truncate the video if the audio is shorter, or pad it if longer.
        # shortest=None by default, we can just mix them and let it use the video length or audio length.
        (
            ffmpeg
            .output(filtered_video, input_audio.audio, output_path, vcodec='libx264', acodec='aac')
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
