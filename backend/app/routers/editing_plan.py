import json
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from groq import Groq
from app.database import get_session, VideoRecord, Caption
from app.config import GROQ_API_KEY

router = APIRouter()

groq_client = Groq(api_key=GROQ_API_KEY)


class EditingPlanRequest(BaseModel):
    object_name: str
    prompt: Optional[str] = None
    structured_options: Optional[dict] = None  # e.g. {"style": "fast-paced", "music": "upbeat"}


@router.post("/editing-plan")
def generate_editing_plan(request: EditingPlanRequest, session: Session = Depends(get_session)):
    # 1. Video record fetch karo
    video = session.exec(
        select(VideoRecord).where(VideoRecord.object_name == request.object_name)
    ).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # 2. Captions fetch karo (agar available hain)
    captions = session.exec(
        select(Caption).where(Caption.object_name == request.object_name)
    ).all()
    captions_text = "\n".join([f"[{c.start}-{c.end}] {c.text}" for c in captions]) or "No captions available"

    # 3. Context build karo Groq ke liye
    context = f"""
You are an AI video editing assistant. Based on the video information below, generate a structured editing plan in JSON format.

Video duration: {video.duration_seconds} seconds
Resolution: {video.width}x{video.height}
Captions/Transcript:
{captions_text}

User's prompt: {request.prompt or "No specific prompt given"}
Structured options: {json.dumps(request.structured_options) if request.structured_options else "None"}

Generate a JSON editing plan with this exact structure:
{{
  "trims": [{{"start": 0, "end": 5, "action": "keep/cut"}}],
  "caption_style": {{"font": "...", "position": "...", "animation": "..."}},
  "effects": ["effect1", "effect2"],
  "music_suggestion": "description of music style",
  "summary": "brief explanation of the editing approach"
}}

Return ONLY valid JSON, no extra text or markdown formatting.
"""

    # 4. Groq API call karo
    try:
        response = groq_client.chat.completions.create(
            model='llama-3.3-70b-versatile',
            messages=[{"role": "user", "content": context}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
        raw_text = response.choices[0].message.content.strip()

        # JSON clean karo (if wrapped in backticks)
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]

        editing_plan = json.loads(raw_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI response was not valid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API error: {str(e)}")

    return {
        "object_name": request.object_name,
        "editing_plan": editing_plan,
    }
