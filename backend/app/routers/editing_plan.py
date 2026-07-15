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
    reference_object_name: Optional[str] = None
    reference_captions: Optional[List[dict]] = None
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

    # 2. Reference script processing
    reference_text = ""
    if request.reference_captions:
        reference_text = "\n".join([c.get("text", "") for c in request.reference_captions])

    # 3. Context build karo Groq ke liye
    duration = video.duration_seconds if video.duration_seconds else 45
    word_count = int(duration * 2.5)
    context = f"""
You are an AI video editing assistant and scriptwriter. Based on the information below, generate a structured editing plan and a Voiceover Script in JSON format.

Main Video duration: {duration} seconds
Main Video Resolution: {video.width}x{video.height}
"""
    duration_str = f"CRITICAL REQUIREMENT: The video is EXACTLY {duration} seconds long. You MUST write a script that is EXACTLY 160 to 175 words long. Count the words carefully. This is CRITICAL because the voiceover MUST be spoken very FAST and energetically like a modern social media reel. If you write a short script, it will play in slow-motion and ruin the video. Write a long, continuous, detailed voiceover paragraph consisting of at least 14 to 16 full sentences. Do NOT fail this."

    if reference_text:
        context += f"""
Reference Video Script/Voiceover:
"{reference_text}"

Task: {duration_str}
You MUST write a NEW voiceover script for the Main Video that perfectly matches the STYLE, TONE, and ENERGY of the Reference Video.
The voiceover script MUST be written entirely in Native Gujarati Script (e.g. નમસ્તે, કેમ છો). 
CRITICAL: The very FIRST sentence MUST be a powerful, cinematic hook that instantly grabs attention and impresses the viewer!
CRITICAL: The Gujarati MUST be perfectly natural, grammatically flawless, and very simple. Do NOT use overly complex, weird, or awkward words. It must sound like a real native speaker on social media. 
DO NOT use English characters for the script.
DO NOT translate word-for-word. Adapt the message to fit the silent drone/scenic footage of the Main Video.
"""
    else:
        context += f"""
Task: {duration_str}
Write a highly engaging, professional voiceover script for the Main Video. 
The voiceover script MUST be written entirely in Native Gujarati Script (e.g. નમસ્તે, કેમ છો).
CRITICAL: The very FIRST sentence MUST be a powerful, cinematic hook that instantly grabs attention and impresses the viewer!
CRITICAL: The Gujarati MUST be perfectly natural, grammatically flawless, and very simple. Do NOT use overly complex, weird, or awkward words. It must sound like a real native speaker on social media.
"""

    context += f"""
User's prompt: {request.prompt or "No specific prompt given"}
Structured options: {json.dumps(request.structured_options) if request.structured_options else "None"}

Generate a JSON editing plan with this exact structure:
{{
  "trims": [{{"start": 0, "end": 5, "action": "keep/cut"}}],
  "caption_style": {{"font": "...", "position": "...", "animation": "..."}},
  "effects": ["effect1", "effect2"],
  "music_suggestion": "description of music style",
  "generated_script": "The full voiceover script text that will be converted to TTS",
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
