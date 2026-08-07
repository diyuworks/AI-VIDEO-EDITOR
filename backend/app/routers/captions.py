from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from sqlmodel import Session, select, delete
from app.database import get_session, VideoRecord, Caption
from app.config import MINIO_BUCKET

router = APIRouter()

_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel  # lazy import: avoids CUDA/cuDNN conflict with torch/SAM if this loads first
        # Use 'small' model for proper Gujarati (ગુજરાતી) script output — 'base' outputs English/Arabic instead
        _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    return _whisper_model

@router.post("/captions/{object_name}")
def generate_captions(object_name: str, session: Session = Depends(get_session)):
    from app.routers.uploads import minio_client
    record = session.exec(
        select(VideoRecord).where(VideoRecord.object_name == object_name)
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Video not found in database")
    try:
        video_url = minio_client.presigned_get_object(
            MINIO_BUCKET, object_name, expires=timedelta(minutes=15)
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")
    try:
        segments, info = get_whisper_model().transcribe(video_url, beam_size=5, condition_on_previous_text=False)
    except Exception as e:
        if "tuple index out of range" in str(e):
            # This happens when the video has no audio track
            return {
                "object_name": object_name,
                "language": "en",
                "captions": [],
                "note": "No audio track found in video."
            }
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    # Purane captions (agar pehle se hain) hata do, taaki duplicate na ho
    session.exec(delete(Caption).where(Caption.object_name == object_name))
    session.commit()
    captions_list = []
    for segment in segments:
        caption = Caption(
            object_name=object_name,
            start=round(segment.start, 2),
            end=round(segment.end, 2),
            text=segment.text.strip(),
            language=info.language,
        )
        session.add(caption)
        captions_list.append({
            "start": caption.start,
            "end": caption.end,
            "text": caption.text,
        })
    session.commit()
    return {
        "object_name": object_name,
        "language": info.language,
        "captions": captions_list,
    }

@router.get("/captions/{object_name}")
def get_captions(object_name: str, session: Session = Depends(get_session)):
    """Database se saved captions fetch karo (Whisper dobara chalaye bina)"""
    captions = session.exec(
        select(Caption).where(Caption.object_name == object_name)
    ).all()
    if not captions:
        raise HTTPException(
            status_code=404,
            detail="No captions found. Generate first using POST /captions/{object_name}"
        )
    return {
        "object_name": object_name,
        "language": captions[0].language,
        "captions": [
            {"start": c.start, "end": c.end, "text": c.text} for c in captions
        ],
    }

@router.post("/transcribe-audio")
async def transcribe_audio(file: UploadFile = File(...)):
    """Standalone utility endpoint to transcribe uploaded audio directly."""
    import tempfile
    import os
    import shutil

    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ".mp3"
    temp_dir = tempfile.mkdtemp()
    temp_audio_path = os.path.join(temp_dir, f"upload{ext}")

    try:
        # Save uploaded file
        with open(temp_audio_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Transcribe with explicit Gujarati initial_prompt to enforce clean Gujarati (ગુજરાતી) script
        segments, info = get_whisper_model().transcribe(
            temp_audio_path, 
            beam_size=5, 
            best_of=5,
            language="gu", 
            task="transcribe",
            initial_prompt="આ જમીન પ્લોટ ખૂબ સરસ છે. ગામ, તાલુકો, જીલ્લો, ભાવ, વેચવાનો છે, હાઇવે રોડ touch.",
            condition_on_previous_text=False
        )

        import re
        def clean_gujarati_text(raw_text: str) -> str:
            # Remove Arabic/Persian/Urdu script Unicode ranges hallucinated by Whisper
            cleaned = re.sub(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]', '', raw_text)
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()
            return cleaned

        segments_list = []
        full_transcript = []
        
        for segment in segments:
            text = clean_gujarati_text(segment.text)
            if text:
                segments_list.append({
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text
                })
                full_transcript.append(text)

        return {
            "success": True,
            "detected_language": info.language,
            "full_transcript": " ".join(full_transcript),
            "segments": segments_list
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        # Cleanup
        try:
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)
            os.rmdir(temp_dir)
        except Exception:
            pass
