import os
import tempfile
import subprocess
from datetime import timedelta
from typing import Optional, List
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


class ClipInfo(BaseModel):
    object_name: str
    label: Optional[str] = None          # e.g. "Plot 1", "Farmhouse Area"
    has_farmhouse: bool = False
    has_fountain: bool = False
    price: Optional[str] = None
    size: Optional[str] = None
    road_info: Optional[str] = None
    duration: Optional[float] = None     # clip duration in seconds (filled by backend)


class GenerateReelRequest(BaseModel):
    raw_video_object_name: str        # Original upload
    highlighted_video_object_name: str  # Step 4 ka output (visual-only, no audio)
    reference_object_name: Optional[str] = None  # Style-reference video (agar hai)
    prompt: Optional[str] = None
    structured_options: Optional[dict] = None
    clip_metadata: Optional[List[dict]] = None  # [{label, duration, has_farmhouse, has_fountain}]


class MergeClipsRequest(BaseModel):
    clip_object_names: list  # e.g. ["clip_1.mp4", "clip_2.mp4", ...]
    clip_info: Optional[List[dict]] = None  # [{object_name, label, has_farmhouse, has_fountain}]


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

    print(f"\n{'='*60}")
    print(f"[MERGE] Received {len(request.clip_object_names)} clips to merge")
    for i, name in enumerate(request.clip_object_names):
        print(f"[MERGE]   Clip {i}: {name}")
    print(f"{'='*60}")

    if not request.clip_object_names:
        raise HTTPException(status_code=400, detail="No clips provided for merging")

    merged_id = f"merged_{uuid.uuid4().hex[:8]}.mp4"
    temp_dir = tempfile.mkdtemp()
    local_clip_paths = []

    try:
        # Download clips or copy local demo clips
        for idx, name in enumerate(request.clip_object_names):
            local_p = os.path.join(temp_dir, f"clip_{idx}.mp4")
            demo_p = os.path.join("demo_clips", name)
            if os.path.exists(demo_p):
                import shutil
                shutil.copy(demo_p, local_p)
                print(f"[MERGE] Clip {idx} ({name}): copied from demo_clips")
            else:
                try:
                    minio_client.fget_object(MINIO_BUCKET, name, local_p)
                    print(f"[MERGE] Clip {idx} ({name}): downloaded from MinIO")
                except Exception as e:
                    print(f"[MERGE] ERROR: Clip {idx} ({name}) not found: {e}")
                    raise HTTPException(status_code=404, detail=f"Clip {name} not found: {str(e)}")
            
            # Verify file exists and has content
            file_size = os.path.getsize(local_p)
            print(f"[MERGE] Clip {idx} file size: {file_size} bytes")
            local_clip_paths.append(local_p)

        print(f"[MERGE] Total clips downloaded: {len(local_clip_paths)}")

        # Build FFmpeg filter pipeline to normalize and concatenate all clips in one go
        streams = []
        clip_durations = []  # Track each clip's duration for voiceover sync
        for clip_idx, p in enumerate(local_clip_paths):
            probe = ffmpeg.probe(p)
            has_audio = any(s['codec_type'] == 'audio' for s in probe['streams'])
            duration = float(probe['format']['duration'])
            clip_durations.append(duration)
            print(f"[MERGE] Clip {clip_idx}: duration={duration:.2f}s, has_audio={has_audio}")
            
            # Normalize video to 9:16 (720x1280), 25fps, yuv420p
            vid = (
                ffmpeg.input(p).video
                .filter('fps', fps=25)
                .filter('scale', 720, 1280, force_original_aspect_ratio='decrease')
                .filter('pad', 720, 1280, '(ow-iw)/2', '(oh-ih)/2')
                .filter('setsar', '1')
                .filter('format', 'yuv420p')
            )
            
            # Normalize audio to 44.1kHz stereo, or generate silence if missing
            if has_audio:
                aud = ffmpeg.input(p).audio.filter('aformat', sample_rates='44100', channel_layouts='stereo')
            else:
                aud = ffmpeg.input('anullsrc', f='lavfi', t=duration).audio
                
            streams.append(vid)
            streams.append(aud)

        print(f"[MERGE] Total streams built: {len(streams)} (should be {len(local_clip_paths)*2})")
        print(f"[MERGE] n parameter for concat: {len(local_clip_paths)}")

        # Concatenate all normalized streams
        output_path = os.path.join(temp_dir, "output_merged.mp4")
        joined = ffmpeg.concat(*streams, v=1, a=1, n=len(local_clip_paths)).node
        out = ffmpeg.output(joined[0], joined[1], output_path, vcodec='libx264', acodec='aac', video_bitrate='2M', strict='experimental')
        
        # Print the actual ffmpeg command for debugging
        try:
            cmd_args = ffmpeg.get_args(out)
            print(f"[MERGE] FFmpeg command args: ffmpeg {' '.join(cmd_args)}")
        except Exception:
            pass

        try:
            out.overwrite_output().run(capture_stdout=True, capture_stderr=True)
            merged_size = os.path.getsize(output_path)
            print(f"[MERGE] SUCCESS! Merged file size: {merged_size} bytes")
        except ffmpeg.Error as e:
            error_msg = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
            print(f"[MERGE] FFMPEG ERROR: {error_msg}")
            raise HTTPException(status_code=500, detail=f"FFmpeg concat filter failed: {error_msg}")

        # Upload merged output to MinIO
        with open(output_path, "rb") as f:
            data = f.read()

        minio_client.put_object(
            MINIO_BUCKET, merged_id,
            data=BytesIO(data), length=len(data), content_type="video/mp4"
        )

        presigned_url = minio_client.presigned_get_object(
            MINIO_BUCKET, merged_id, expires=timedelta(days=7),
            response_headers={'response-content-disposition': 'attachment; filename="AI_Reel.mp4"'}
        )

        # Build clip_metadata for voiceover sync
        clip_metadata = []
        cumulative_time = 0.0
        for idx, dur in enumerate(clip_durations):
            info = {}
            if request.clip_info and idx < len(request.clip_info):
                info = request.clip_info[idx]
            clip_metadata.append({
                "index": idx,
                "label": info.get("label", f"Clip {idx+1}"),
                "has_farmhouse": info.get("has_farmhouse", False),
                "has_fountain": info.get("has_fountain", False),
                "price": info.get("price", ""),
                "size": info.get("size", ""),
                "road_info": info.get("road_info", ""),
                "duration": round(dur, 2),
                "start_time": round(cumulative_time, 2),
                "end_time": round(cumulative_time + dur, 2),
            })
            cumulative_time += dur

        return {
            "success": True,
            "merged_object_name": merged_id,
            "url": presigned_url,
            "clips_count": len(request.clip_object_names),
            "clip_durations": clip_durations,
            "clip_metadata": clip_metadata,
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

    TEMPORARY_DISABLE_VOICEOVER = False  # Set to False to restore AI script, voiceover & captions

    temp_dir = tempfile.mkdtemp()
    generated_script = ""
    word_boundaries = []
    audio_path = None
    outro_audio_path = None
    
    import uuid as _uuid
    import ffmpeg
    export_id = str(_uuid.uuid4())
    
    # Download highlighted video to tmp_exports EARLY so we can get its exact duration
    from app.routers.export import TMP_DIR
    video_path = os.path.join(TMP_DIR, f"{export_id}_source.mp4")
    srt_path = os.path.join(TMP_DIR, f"{export_id}_subs.srt")
    output_path = os.path.join(TMP_DIR, f"{export_id}_final.mp4")
    
    try:
        minio_client.fget_object(MINIO_BUCKET, request.highlighted_video_object_name, video_path)
        probe_video = ffmpeg.probe(video_path)
        video_info = next(s for s in probe_video['streams'] if s['codec_type'] == 'video')
        video_duration = float(probe_video['format']['duration'])
        has_audio = any(s['codec_type'] == 'audio' for s in probe_video['streams'])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch or probe source video: {str(e)}")

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

            # 1. Target script duration to main video clips duration + 5s logo screen
            plan_req = EditingPlanRequest(
                object_name=request.raw_video_object_name,
                reference_object_name=request.reference_object_name,
                reference_captions=reference_captions,
                prompt=request.prompt,
                structured_options=request.structured_options,
                duration_seconds=video_duration + 5.0,  # Now includes 5s end screen for seamless outro
                clip_metadata=request.clip_metadata  # Timeline info for context-aware narration
            )
            plan_req = generate_editing_plan(plan_req, session)
            # 'generated_script' is removed, we directly use segments below
        except Exception as e:
            with open("debug.log", "a") as f: f.write(f"Script Error: {str(e)}\n")
            raise HTTPException(status_code=500, detail=f"Script generation failed: {str(e)}")

        # ---- SUB-STEP B: Segment-wise TTS & Word Timestamps Generate Karo ----
        try:
            import shutil
            segments = plan_req["editing_plan"].get("segments", [])
            outro_text = plan_req["editing_plan"].get("outro_text", "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો.")
            
            segment_audio_streams = []
            word_boundaries = []
            clip_metadata_list = request.clip_metadata or []
            
            # Process each video clip segment
            for idx, seg in enumerate(segments):
                seg_text = seg.get("text", "").strip()
                if not seg_text: continue
                
                # Fetch target duration and start time for this segment
                if idx < len(clip_metadata_list):
                    target_dur = clip_metadata_list[idx].get("duration", 0)
                    clip_start = clip_metadata_list[idx].get("start_time", 0)
                else:
                    target_dur = 5.0 # fallback
                    clip_start = 0.0
                
                # Generate TTS for segment
                tts_req = TTSRequest(text=seg_text)
                tts_res = await generate_tts(tts_req)
                
                seg_source_path = os.path.join("tts_output", f"{tts_res['audio_id']}.mp3")
                seg_audio_path = os.path.join(temp_dir, f"seg_{idx}_{tts_res['audio_id']}.mp3")
                shutil.copy(seg_source_path, seg_audio_path)
                
                # Shift word boundaries so subtitles appear at the right time
                for wb in tts_res["word_boundaries"]:
                    wb["start"] = round(wb["start"] + clip_start, 3)
                    wb["end"] = round(wb["end"] + clip_start, 3)
                    word_boundaries.append(wb)
                
                # Pad/Trim to exact target_dur to guarantee perfect clip sync!
                audio_padded = ffmpeg.input(seg_audio_path).audio.filter('apad').filter('atrim', duration=target_dur)
                segment_audio_streams.append(audio_padded)

            # Generate Outro TTS
            if outro_text:
                outro_req = TTSRequest(text=outro_text)
                outro_res = await generate_tts(outro_req)
                outro_source = os.path.join("tts_output", f"{outro_res['audio_id']}.mp3")
                outro_audio_path = os.path.join(temp_dir, f"outro_{outro_res['audio_id']}.mp3")
                shutil.copy(outro_source, outro_audio_path)
                
                outro_start = video_duration
                for wb in outro_res["word_boundaries"]:
                    wb["start"] = round(wb["start"] + outro_start, 3)
                    wb["end"] = round(wb["end"] + outro_start, 3)
                    word_boundaries.append(wb)
                    
                # Pad outro to 5 seconds (end screen duration)
                outro_audio_stream = ffmpeg.input(outro_audio_path).audio.filter('apad').filter('atrim', duration=5.0)
                segment_audio_streams.append(outro_audio_stream)

            # Concat all audio streams into a single perfect timeline
            if len(segment_audio_streams) > 1:
                final_audio_stream = ffmpeg.concat(*segment_audio_streams, v=0, a=1)
            elif len(segment_audio_streams) == 1:
                final_audio_stream = segment_audio_streams[0]
            else:
                # Fallback empty audio
                final_audio_stream = ffmpeg.input('anullsrc', f='lavfi', t=total_final_duration).audio

        except Exception as e:
            with open("debug.log", "a", encoding="utf-8") as f: f.write(f"Segment TTS Error: {str(e)}\n")
            raise HTTPException(status_code=500, detail=f"Segment TTS generation failed: {str(e)}")

    # ---- SUB-STEP C+D: Use EXACT same export.py logic for captions + voice ----
    
    try:
        # Video is already downloaded and probed!
        trim_duration = video_duration
        end_screen_duration = 5.0  # Fixed 5s logo end screen
        total_final_duration = video_duration + end_screen_duration
        outro_start_time = video_duration
        
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
        
        # Width/height for end screen
        reel_width = int(min(width, height * 9 / 16))
        reel_height = int(min(height, width * 16 / 9))
        
        # Setup end screen image stream (5 seconds logo card)
        end_screen_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets", "end_screen.PNG")
        if os.path.exists(end_screen_path):
            image_stream = ffmpeg.input(end_screen_path, loop=1, t=end_screen_duration)
            
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

        # Overlay logo watermark if logo.png exists in assets/ folder
        logo_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets", "logo.png")
        if os.path.exists(logo_path):
            logo_input = ffmpeg.input(logo_path)
            # Apply 95% opacity for better visibility
            logo_alpha = logo_input.filter('colorchannelmixer', aa=0.95)
            
            # LOGO (Bottom-Center) - 30% of reel width (increased size)
            logo_w = int(reel_width * 0.30)
            scaled_logo = logo_alpha.filter('scale', logo_w, -1)
            video_for_subs = ffmpeg.overlay(video_for_subs, scaled_logo, x='(main_w-overlay_w)/2', y='main_h-overlay_h-40')
        
        if not TEMPORARY_DISABLE_VOICEOVER:
            filtered_video = video_for_subs
            
            # Use the already concatenated and precisely synced segment audio stream
            ffmpeg_out = ffmpeg.output(filtered_video, final_audio_stream, output_path, vcodec='libx264', acodec='aac', strict='experimental', **{'b:v': '5000k', 'preset': 'ultrafast'})
        else:
            filtered_video = video_for_subs
            if has_audio:
                audio_stream = input_video.audio
                ffmpeg_out = ffmpeg.output(filtered_video, audio_stream, output_path, vcodec='libx264', acodec='aac', **{'preset': 'ultrafast'})
            else:
                ffmpeg_out = ffmpeg.output(filtered_video, output_path, vcodec='libx264', **{'preset': 'ultrafast'})
        
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
        MINIO_BUCKET, final_object_name, expires=timedelta(days=7),
        response_headers={'response-content-disposition': 'attachment; filename="AI_Reel.mp4"'}
    )

    return {
        "success": True,
        "final_object_name": final_object_name,
        "url": final_url,
        "script_used": generated_script,
    }
