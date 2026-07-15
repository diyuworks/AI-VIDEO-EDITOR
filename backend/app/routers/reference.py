import uuid
from io import BytesIO
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from sqlmodel import Session, select
from app.database import get_session, ReferenceVideo
from app.config import MINIO_BUCKET

router = APIRouter()

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_FILE_SIZE_MB = 500
MAX_REFERENCE_VIDEOS = 5


@router.post("/reference-videos/{project_id}")
async def upload_reference_videos(
    project_id: str,
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    from app.routers.uploads import minio_client

    # Check kitne already uploaded hain is project ke liye
    existing = session.exec(
        select(ReferenceVideo).where(ReferenceVideo.project_id == project_id)
    ).all()

    if len(existing) + len(files) > MAX_REFERENCE_VIDEOS:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_REFERENCE_VIDEOS} reference videos allowed. "
                   f"Already have {len(existing)}, tried to add {len(files)}."
        )

    uploaded = []

    for file in files:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

        contents = await file.read()
        size_mb = len(contents) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            raise HTTPException(status_code=400, detail=f"{file.filename} is too large")

        object_name = f"ref_{uuid.uuid4().hex}{ext}"

        minio_client.put_object(
            MINIO_BUCKET,
            object_name,
            data=BytesIO(contents),
            length=len(contents),
            content_type=file.content_type,
        )

        file_url = f"http://localhost:9000/{MINIO_BUCKET}/{object_name}"

        record = ReferenceVideo(
            project_id=project_id,
            object_name=object_name,
            original_filename=file.filename,
            url=file_url,
        )
        session.add(record)
        uploaded.append({
            "object_name": object_name,
            "filename": file.filename,
            "url": file_url,
        })

    session.commit()

    return {
        "success": True,
        "project_id": project_id,
        "uploaded_count": len(uploaded),
        "reference_videos": uploaded,
    }


@router.get("/reference-videos/{project_id}")
def get_reference_videos(project_id: str, session: Session = Depends(get_session)):
    videos = session.exec(
        select(ReferenceVideo).where(ReferenceVideo.project_id == project_id)
    ).all()
    return videos
