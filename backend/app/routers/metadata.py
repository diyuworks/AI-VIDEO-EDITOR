import ffmpeg
from datetime import timedelta
from sqlmodel import Session, select
from fastapi import APIRouter, HTTPException, Depends
from app.database import get_session, VideoRecord
from app.config import MINIO_BUCKET

router = APIRouter()


@router.get("/metadata/{object_name}")
def get_video_metadata(object_name: str, session: Session = Depends(get_session)):
    """
    Given the object_name of an uploaded video (returned by /upload),
    fetch its metadata: duration, resolution, fps, format.
    """
    from app.routers.uploads import minio_client  # reuse existing client

    # Generate a temporary authenticated URL (valid for 10 minutes)
    try:
        video_url = minio_client.presigned_get_object(
            MINIO_BUCKET, object_name, expires=timedelta(minutes=10)
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    try:
        probe = ffmpeg.probe(video_url)
    except ffmpeg.Error as e:
        raise HTTPException(status_code=400, detail=f"Could not read video: {str(e)}")

    video_stream = next(
        (s for s in probe["streams"] if s["codec_type"] == "video"), None
    )
    if video_stream is None:
        raise HTTPException(status_code=400, detail="No video stream found")

    duration = float(probe["format"].get("duration", 0))
    width = video_stream.get("width")
    height = video_stream.get("height")

    # fps often comes as a fraction string like "30/1"
    fps_str = video_stream.get("r_frame_rate", "0/1")
    num, den = fps_str.split("/")
    fps = round(float(num) / float(den), 2) if float(den) != 0 else 0

    # Naya: database record ko update karo
    record = session.exec(
        select(VideoRecord).where(VideoRecord.object_name == object_name)
    ).first()
    if record:
        record.duration_seconds = round(duration, 2)
        record.width = width
        record.height = height
        record.fps = fps
        record.aspect_ratio = f"{width}:{height}" if width and height else None
        session.add(record)
        session.commit()

    return {
        "object_name": object_name,
        "duration_seconds": round(duration, 2),
        "width": width,
        "height": height,
        "fps": fps,
        "aspect_ratio": f"{width}:{height}" if width and height else None,
        "format": probe["format"].get("format_name"),
    }
