"""
Real TTS voiceover generation â€” replaces the hardcoded pre-recorded mp3
approach with genuine per-caption text-to-speech, generated on demand from
whatever caption text actually exists for a given video.

Primary engine: Sarvam AI (Bulbul v3) â€” specialized for Indian languages,
should sound meaningfully more natural for Gujarati than generic TTS.
Falls back to gTTS automatically if SARVAM_API_KEY isn't set, so this keeps
working even before you've configured a key.

Add this router to main.py:
    from app.routers import voiceover
    app.include_router(voiceover.router)

Add to requirements.txt:
    gTTS
    requests

Add to .env:
    SARVAM_API_KEY=your_key_here
"""

import base64
import os
import uuid
from io import BytesIO
from typing import List, Optional

import requests
from fastapi import APIRouter, HTTPException
from gtts import gTTS
from gtts.lang import tts_langs
from pydantic import BaseModel

from app.config import MINIO_BUCKET, MINIO_ENDPOINT
from app.routers.uploads import minio_client

router = APIRouter()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

# Sarvam expects BCP-47-style codes with region (e.g. 'gu-IN'), gTTS wants
# plain ISO 639-1 ('gu'). Map the languages this project actually uses.
SARVAM_LANGUAGE_CODES = {
    "gu": "gu-IN",
    "hi": "hi-IN",
    "en": "en-IN",
}

GTTS_SUPPORTED_LANGS = tts_langs()  # e.g. {'gu': 'Gujarati', 'en': 'English', ...}


class CaptionInput(BaseModel):
    id: str
    text: str
    start: float
    end: float


class VoiceoverRequest(BaseModel):
    captions: List[CaptionInput]
    language: str = "gu"  # ISO 639-1 code â€” 'gu' for Gujarati, 'en' for English, etc.


class CaptionAudioResult(BaseModel):
    caption_id: str
    audio_url: Optional[str]
    engine_used: Optional[str] = None
    error: Optional[str] = None


class VoiceoverResponse(BaseModel):
    results: List[CaptionAudioResult]


def synthesize_with_sarvam(text: str, language: str) -> bytes:
    """Real Sarvam AI Bulbul v3 call. Returns raw WAV bytes.
    Raises on any failure so the caller can fall back to gTTS."""
    lang_code = SARVAM_LANGUAGE_CODES.get(language, f"{language}-IN")

    response = requests.post(
        SARVAM_TTS_URL,
        headers={
            "api-subscription-key": SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "target_language_code": lang_code,
            "model": "bulbul:v3",
            "speaker": "pooja",  # confirmed working with bulbul:v3, tested end-to-end
        },
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    # Sarvam returns {"audios": ["<base64 wav>", ...]} â€” one string per input chunk.
    audios = data.get("audios")
    if not audios:
        raise ValueError(f"Sarvam response had no audio: {data}")

    return base64.b64decode(audios[0])


def synthesize_with_gtts(text: str, language: str) -> bytes:
    """Fallback engine â€” free, no key required, lower quality."""
    if language not in GTTS_SUPPORTED_LANGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{language}' for gTTS fallback. Supported: {sorted(GTTS_SUPPORTED_LANGS.keys())}",
        )
    buf = BytesIO()
    gTTS(text=text, lang=language).write_to_fp(buf)
    buf.seek(0)
    return buf.read()


def synthesize_speech(text: str, language: str) -> tuple[bytes, str, str]:
    """Returns (audio_bytes, content_type, engine_used). Tries Sarvam first
    if configured, falls back to gTTS on any failure so a bad/missing key
    or a transient Sarvam error doesn't break voiceover generation entirely."""
    if SARVAM_API_KEY:
        try:
            audio = synthesize_with_sarvam(text, language)
            return audio, "audio/wav", "sarvam"
        except Exception as e:
            print(f"Sarvam TTS failed, falling back to gTTS: {e}")

    audio = synthesize_with_gtts(text, language)
    return audio, "audio/mpeg", "gtts"


@router.post("/generate-voiceover", response_model=VoiceoverResponse)
def generate_voiceover(req: VoiceoverRequest):
    results: List[CaptionAudioResult] = []

    for caption in req.captions:
        if not caption.text.strip():
            results.append(CaptionAudioResult(caption_id=caption.id, audio_url=None, error="Empty caption text"))
            continue

        try:
            audio_bytes, content_type, engine_used = synthesize_speech(caption.text, req.language)
            ext = "wav" if content_type == "audio/wav" else "mp3"
            object_name = f"voiceover_{caption.id}_{uuid.uuid4().hex[:8]}.{ext}"

            minio_client.put_object(
                MINIO_BUCKET,
                object_name,
                data=BytesIO(audio_bytes),
                length=len(audio_bytes),
                content_type=content_type,
            )

            audio_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{object_name}"
            results.append(CaptionAudioResult(caption_id=caption.id, audio_url=audio_url, engine_used=engine_used))

        except Exception as e:
            results.append(CaptionAudioResult(caption_id=caption.id, audio_url=None, error=str(e)))

    return VoiceoverResponse(results=results)
