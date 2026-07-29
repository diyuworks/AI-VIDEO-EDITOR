from fastapi import APIRouter
from typing import Dict, Any

router = APIRouter()

# Global in-memory dictionary to track real-time job progress
job_progress_store: Dict[str, Dict[str, Any]] = {}

def update_progress(job_id: str, progress: int, stage: str, message: str):
    """Utility function to update job progress percentage and message."""
    if not job_id:
        return
    job_progress_store[job_id] = {
        "job_id": job_id,
        "progress": max(0, min(100, progress)),
        "stage": stage,
        "message": message
    }

@router.get("/progress/{job_id}")
def get_job_progress(job_id: str):
    """Returns the current real-time percentage progress for a given job_id."""
    progress_info = job_progress_store.get(
        job_id,
        {"job_id": job_id, "progress": 0, "stage": "starting", "message": "Initializing job..."}
    )
    return progress_info
