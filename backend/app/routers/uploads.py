import uuid
import os
import tempfile
from io import BytesIO
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
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
    """Initialize MinIO bucket with a timeout so app startup never hangs."""
    import threading

    def _try_init():
        try:
            if not minio_client.bucket_exists(MINIO_BUCKET):
                minio_client.make_bucket(MINIO_BUCKET)
            print("MinIO bucket initialized successfully.")
        except Exception as e:
            print(f"Warning: Could not connect to MinIO during startup. {e}")

    t = threading.Thread(target=_try_init, daemon=True)
    t.start()
    t.join(timeout=5)  # Wait max 5 seconds, then proceed regardless
    if t.is_alive():
        print("Warning: MinIO connection timed out (5s). App will continue without MinIO — using local demo_clips/ storage.")


ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".m4a", ".aac"}
MAX_FILE_SIZE_MB = 500


@router.post("/upload")
def upload_video(file: UploadFile = File(...), session: Session = Depends(get_session)):
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    object_name = f"{uuid.uuid4().hex}{ext}"
    # Stream directly to disk to prevent RAM overload and blocking
    import shutil
    
    if getattr(file, "size", 0) and file.size > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large")

    demo_dir = "demo_clips"
    os.makedirs(demo_dir, exist_ok=True)
    local_path = os.path.join(demo_dir, object_name)
    
    file.file.seek(0)
    with open(local_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    size_mb = os.path.getsize(local_path) / (1024 * 1024)

    # Try MinIO upload in background thread with 3s timeout (local copy is already safe)
    import threading
    def _minio_upload():
        try:
            minio_client.fput_object(
                MINIO_BUCKET,
                object_name,
                local_path,
                content_type=file.content_type or "video/mp4",
            )
        except Exception as e:
            print(f"[upload warning] MinIO upload threw {e}, using local storage copy...")

    t = threading.Thread(target=_minio_upload, daemon=True)
    t.start()

    file_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{object_name}"

    record = VideoRecord(
        object_name=object_name,
        original_filename=file.filename,
        url=file_url,
    )
    session.add(record)
    session.commit()
    session.refresh(record)

    from app.services.email_service import notify_video_upload
    notify_video_upload(file.filename, object_name, size_mb)

    return {
        "success": True,
        "id": record.id,
        "filename": file.filename,
        "object_name": object_name,
        "url": file_url,
    }


@router.post("/upload-reference")
def upload_reference_video(file: UploadFile = File(...)):
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    object_name = f"ref_{uuid.uuid4().hex}{ext}"
    contents = file.file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail="File too large")

    # Always save a local copy in demo_clips for guaranteed offline processing
    demo_dir = "demo_clips"
    os.makedirs(demo_dir, exist_ok=True)
    local_ref_path = os.path.join(demo_dir, object_name)
    with open(local_ref_path, "wb") as f:
        f.write(contents)

    try:
        # Calculate optimal part_size to avoid S3 multipart upload timeouts
        part_size = max(10 * 1024 * 1024, len(contents) // 100) if len(contents) > 10 * 1024 * 1024 else 0
        minio_client.put_object(
            MINIO_BUCKET,
            object_name,
            data=BytesIO(contents),
            length=len(contents),
            content_type=file.content_type,
            part_size=part_size
        )
    except Exception as e:
        print(f"[upload-reference warning] MinIO upload threw {e}, using local storage copy...")

    file_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{object_name}"

    return {
        "success": True,
        "filename": file.filename,
        "object_name": object_name,
        "url": file_url,
    }


@router.get("/videos")
def list_videos(session: Session = Depends(get_session)):
    videos = session.exec(select(VideoRecord)).all()
    return videos


@router.get("/past-reels")
def list_past_reels(request: Request):
    """Returns a list of all previously generated AI real estate reels."""
    demo_dir = "demo_clips"
    if not os.path.exists(demo_dir):
        return []

    reels = []
    import glob
    from datetime import datetime

    files = glob.glob(os.path.join(demo_dir, "*"))
    reel_files = [f for f in files if os.path.basename(f).startswith(("reel_", "final_", "highlighted_")) and f.endswith(".mp4")]
    
    reel_files.sort(key=os.path.getmtime, reverse=True)
    base_url = str(request.base_url).rstrip("/")

    for idx, filepath in enumerate(reel_files):
        fname = os.path.basename(filepath)
        size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 2)
        mtime = os.path.getmtime(filepath)
        formatted_date = datetime.fromtimestamp(mtime).strftime("%d %b %Y, %I:%M %p")
        
        clean_name = fname.replace("reel_", "").replace("final_", "").replace("highlighted_", "")
        title = f"Jamin24 Real Estate Reel #{len(reel_files) - idx}"

        reels.append({
            "id": fname,
            "filename": fname,
            "title": title,
            "clean_name": clean_name,
            "url": f"{base_url}/demo-videos/{fname}",
            "size_mb": size_mb,
            "created_at": formatted_date,
        })

    return reels


@router.get("/available-clips")
def list_available_clips(request: Request):
    """Returns a list of raw footage clips available on the server for instant testing."""
    demo_dir = "demo_clips"
    if not os.path.exists(demo_dir):
        return []

    import glob
    files = glob.glob(os.path.join(demo_dir, "*.mp4"))
    raw_clips = [f for f in files if not os.path.basename(f).startswith(("reel_", "final_", "highlighted_"))]

    base_url = str(request.base_url).rstrip("/")
    clips = []
    for idx, filepath in enumerate(raw_clips):
        fname = os.path.basename(filepath)
        clips.append({
            "id": idx + 1,
            "filename": f"Sample Plot Clip #{idx + 1} ({fname[:8]}.mp4)",
            "object_name": fname,
            "url": f"{base_url}/demo-videos/{fname}",
        })

    return clips


@router.delete("/past-reels/{filename}")
def delete_past_reel(filename: str):
    """Deletes a past generated reel file from local storage."""
    safe_filename = os.path.basename(filename)
    demo_dir = "demo_clips"
    filepath = os.path.join(demo_dir, safe_filename)

    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            return {"success": True, "message": f"Deleted {safe_filename}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Could not delete file: {str(e)}")
    else:
        raise HTTPException(status_code=404, detail="Reel file not found")


@router.post("/visit")
async def track_visit(request: Request):
    client_ip = request.client.host if request.client else "Unknown"
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    user_agent = request.headers.get("user-agent", "Unknown")

    from app.services.email_service import notify_website_visit
    notify_website_visit(client_ip=client_ip, user_agent=user_agent)
    return {"status": "ok"}


