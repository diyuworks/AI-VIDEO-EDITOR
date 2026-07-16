import os
import uuid
import edge_tts
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse

router = APIRouter()

class TTSRequest(BaseModel):
    text: str
    voice: str = "gu-IN-DhwaniNeural"  # Default voice changed to Gujarati Female (Dhwani) for maximum clarity

# Create a directory to store TTS outputs locally (for simplicity during dev)
TTS_DIR = "tts_output"
os.makedirs(TTS_DIR, exist_ok=True)

@router.post("/generate-tts")
async def generate_tts(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    file_id = str(uuid.uuid4())
    filename = f"{file_id}.mp3"
    filepath = os.path.join(TTS_DIR, filename)
    
    try:
        # User explicitly requested the Male Voice which was Edge-TTS Niranjan
        # Restored to completely normal speed to guarantee exact original tone
        communicate = edge_tts.Communicate(request.text, "gu-IN-NiranjanNeural")
        await communicate.save(filepath)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS Generation failed: {str(e)}")

    return {
        "success": True,
        "audio_id": file_id,
        "audio_url": f"http://localhost:8000/tts-file/{filename}"
    }

@router.get("/tts-file/{filename}")
async def get_tts_file(filename: str):
    filepath = os.path.join(TTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(filepath, media_type="audio/mpeg")
