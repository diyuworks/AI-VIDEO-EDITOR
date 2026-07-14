import uuid
from io import BytesIO
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
from sqlmodel import Session, select
from app.database import get_session, VideoRecord
from minio import Minio
from minio.error import S3Error
from app.config import (
    MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
    MINIO_BUCKET, MINIO_SECURE
)

router = APIRouter()

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=MINIO_SECURE
)

def init_minio():
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            minio_client.make_bucket(MINIO_BUCKET)
        print("MinIO bucket initialized successfully.")
    except Exception as e:
        print(f"Warning: Could not connect to MinIO during startup. {e}")


ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_FILE_SIZE_MB = 500


@router.post("/upload")
async def upload_video(file: UploadFile = File(...), session: Session = Depends(get_session)):
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    object_name = f"{uuid.uuid4().hex}{ext}"
    contents = await file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail="File too large")

    try:
        minio_client.put_object(
            MINIO_BUCKET,
            object_name,
            data=BytesIO(contents),
            length=len(contents),
            content_type=file.content_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed (MinIO might be down): {str(e)}")

    file_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{object_name}"

    record = VideoRecord(
        object_name=object_name,
        original_filename=file.filename,
        url=file_url,
    )
    session.add(record)
    session.commit()
    session.refresh(record)

    return {
        "success": True,
        "id": record.id,
        "filename": file.filename,
        "object_name": object_name,
        "url": file_url,
    }


@router.get("/videos")
def list_videos(session: Session = Depends(get_session)):
    videos = session.exec(select(VideoRecord)).all()
    return videos


@router.get("/videos/{object_name}")
def get_video(object_name: str, session: Session = Depends(get_session)):
    video = session.exec(
        select(VideoRecord).where(VideoRecord.object_name == object_name)
    ).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video
