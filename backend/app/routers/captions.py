from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select, delete

from app.database import get_session, VideoRecord, Caption
from app.config import MINIO_BUCKET

router = APIRouter()

_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel  # lazy import: avoids CUDA/cuDNN conflict with torch/SAM if this loads first
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
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
        segments, info = get_whisper_model().transcribe(video_url, beam_size=5)
    except Exception as e:
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
