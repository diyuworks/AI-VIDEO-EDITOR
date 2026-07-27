"""
Reference Intelligence Router (v2)
Isolated REST API endpoint for extracting style profiles from reference video reels.
Does NOT modify or break any existing API endpoints.
"""

import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.reference_intelligence import generate_style_profile, StyleProfile

router = APIRouter(prefix="/api/v2/reference", tags=["Reference Intelligence"])


class AnalyzeReferenceRequest(BaseModel):
    file_name_or_path: str  # e.g. "clip_1.mp4" or full local file path


class AnalyzeReferenceResponse(BaseModel):
    success: bool
    style_profile: StyleProfile


@router.post("/analyze", response_model=AnalyzeReferenceResponse)
async def analyze_reference_reel(request: AnalyzeReferenceRequest):
    """
    Analyzes a reference video reel and returns its unified StyleProfile.
    """
    input_path = request.file_name_or_path
    resolved_path = None

    # Check direct path
    if os.path.exists(input_path):
        resolved_path = input_path
    else:
        # Check inside backend/demo_clips
        backend_dir = Path(__file__).parent.parent.parent
        demo_clip_path = backend_dir / "demo_clips" / input_path
        if demo_clip_path.exists():
            resolved_path = str(demo_clip_path)

    if not resolved_path:
        raise HTTPException(
            status_code=404, 
            detail=f"Reference video file '{input_path}' not found on server"
        )

    try:
        profile = generate_style_profile(resolved_path)
        return AnalyzeReferenceResponse(
            success=True,
            style_profile=profile
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Reference intelligence analysis failed: {str(e)}"
        )
