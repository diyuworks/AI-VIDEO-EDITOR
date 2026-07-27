import os
import tempfile
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import ffmpeg

from app.routers.uploads import minio_client, MINIO_BUCKET

router = APIRouter()

class AnalyzeRequest(BaseModel):
    object_name: str

class ReferenceProfile(BaseModel):
    duration: float
    scene_cuts: List[float]
    avg_cut_seconds: float
    cut_count: int
    note: Optional[str] = None

class GeneratePlanRequest(BaseModel):
    raw_duration: float
    reference_profile: ReferenceProfile
    style: Optional[str] = None
    transcript: Optional[str] = None
    match_reference: bool = True

class Clip(BaseModel):
    id: str
    track: str
    start: float
    end: float
    label: str
    text: Optional[str] = None

class GeneratePlanResponse(BaseModel):
    clips: List[Clip]
    rationale: List[str]


@router.post("/analyze-reference", response_model=ReferenceProfile)
def analyze_reference(req: AnalyzeRequest):
    # 1. Download file from minio to a temp file
    try:
        response = minio_client.get_object(MINIO_BUCKET, req.object_name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_file:
        tmp_file.write(response.read())
        tmp_path = tmp_file.name
    
    response.close()
    response.release_conn()

    try:
        # Run ffprobe to get duration
        probe = ffmpeg.probe(tmp_path)
        duration = float(probe['format']['duration'])
        
        # Run ffmpeg to detect scenes
        # We look for scene changes > 0.3
        out, err = (
            ffmpeg
            .input(tmp_path)
            .filter('select', 'gt(scene,0.3)')
            .output('null', f='null')
            .run(capture_stdout=True, capture_stderr=True)
        )
        
        # Parse stderr for scene times
        # ffmpeg outputs lines like: frame=... pkt_pts_time=1.234
        scene_cuts = []
        for line in err.decode('utf-8').splitlines():
            if 'pkt_pts_time=' in line:
                parts = line.split()
                for part in parts:
                    if part.startswith('pkt_pts_time='):
                        try:
                            time_val = float(part.split('=')[1])
                            scene_cuts.append(time_val)
                        except ValueError:
                            pass
        
        # Sort and remove duplicates or very close cuts (< 0.5s)
        scene_cuts = sorted(list(set(scene_cuts)))
        filtered_cuts = []
        last_cut = 0
        for cut in scene_cuts:
            if cut - last_cut > 0.5:
                filtered_cuts.append(cut)
                last_cut = cut
        
        scene_cuts = filtered_cuts
        cut_count = len(scene_cuts)
        avg_cut = duration / (cut_count + 1) if cut_count > 0 else duration

        return ReferenceProfile(
            duration=duration,
            scene_cuts=scene_cuts,
            avg_cut_seconds=round(avg_cut, 2),
            cut_count=cut_count,
            note=f"Analyzed pacing with {cut_count} cuts."
        )
    except ffmpeg.Error as e:
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {e.stderr.decode('utf8')}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@router.post("/generate-plan", response_model=GeneratePlanResponse)
def generate_plan(req: GeneratePlanRequest):
    video_clips = []
    rationale = []
    
    raw_dur = req.raw_duration
    
    if req.match_reference:
        segment_length = req.reference_profile.avg_cut_seconds
        rationale.append(f"Applied a ~{segment_length}s average cut length matching your reference video.")
    else:
        # fallback mapping
        style_segment = 4.0
        if req.style == 'Fast cuts' or req.style == 'High energy':
            style_segment = 2.5
        elif req.style == 'Cinematic' or req.style == 'Moody color grade':
            style_segment = 5.5
        elif req.style == 'Clean & minimal':
            style_segment = 6.0
            
        segment_length = style_segment
        rationale.append(f"Applied a ~{segment_length}s average cut length for {req.style} style.")

    cursor = 0.0
    index = 1
    while cursor < raw_dur:
        end = min(cursor + segment_length, raw_dur)
        video_clips.append(Clip(
            id=f"ai-clip-{index}-{uuid.uuid4().hex[:8]}",
            track="video",
            start=cursor,
            end=end,
            label=f"Clip {index}"
        ))
        cursor = end
        index += 1
        
    rationale.append(f"Split raw footage into {len(video_clips)} clips.")
    
    caption_clips = []
    if req.transcript and req.transcript.strip():
        import re
        sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', req.transcript) if s.strip()]
        if sentences:
            total_chars = sum(len(s) for s in sentences)
            char_cursor = 0
            for sentence in sentences:
                start = (char_cursor / total_chars) * raw_dur
                char_cursor += len(sentence)
                end = (char_cursor / total_chars) * raw_dur
                
                # Minimum caption duration of 1s
                if end - start < 1.0:
                    end = start + 1.0
                    
                caption_clips.append(Clip(
                    id=f"ai-caption-{len(caption_clips)}-{uuid.uuid4().hex[:8]}",
                    track="overlay",
                    start=round(start, 1),
                    end=round(min(end, raw_dur), 1),
                    label=sentence,
                    text=sentence
                ))
            rationale.append(f"Synced {len(caption_clips)} caption segments from your transcript (yellow lines style).")
            
    return GeneratePlanResponse(
        clips=video_clips + caption_clips,
        rationale=rationale
    )
