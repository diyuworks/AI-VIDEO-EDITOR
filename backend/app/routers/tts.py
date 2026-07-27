import io
import json
import uuid
import asyncio
import tempfile
import os
import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()

class TTSRequest(BaseModel):
    text: str
    voice: str = "gu-IN-NiranjanNeural"  # Original Male Voice

TMP_AUDIO_DIR = 'tts_output'
os.makedirs(TMP_AUDIO_DIR, exist_ok=True)

@router.post('/generate-tts')
async def generate_tts(request: TTSRequest):
    file_id = str(uuid.uuid4())
    filename = f'{file_id}.mp3'
    filepath = os.path.join(TMP_AUDIO_DIR, filename)

    try:
        # Original Male Voice (gu-IN-NiranjanNeural)
        selected_voice = request.voice if request.voice and "Neural" in request.voice else "gu-IN-NiranjanNeural"
        # Adjust rate and pitch for a more natural, professional real-estate voice
        communicate = edge_tts.Communicate(request.text, selected_voice, rate="+10%", pitch="+5Hz")
        
        last_offset = 0
        last_duration = 0
        original_boundaries = []
        
        with open(filepath, 'wb') as f:
            async for chunk in communicate.stream():
                if chunk['type'] == 'audio':
                    f.write(chunk['data'])
                elif chunk['type'] == 'WordBoundary':
                    start_sec = chunk['offset'] / 10000000.0
                    duration_sec = chunk['duration'] / 10000000.0
                    original_boundaries.append({
                        'text': chunk['text'],
                        'start': round(start_sec, 3),
                        'end': round(start_sec + duration_sec, 3)
                    })
                    last_offset = chunk['offset']
                    last_duration = chunk['duration']
                elif chunk['type'] == 'SentenceBoundary':
                    last_offset = chunk['offset']
                    last_duration = chunk['duration']

        total_duration = (last_offset + last_duration) / 10000000.0
        
        # Proportional mapping for Gujarati words because edge_tts doesn't give WordBoundaries for it
        actual_words = request.text.split()
        final_boundaries = []

        if len(actual_words) > 0 and total_duration > 0:
            stripped_text = ''.join(actual_words)
            total_chars = len(stripped_text)
            
            if total_chars > 0:
                char_time = total_duration / total_chars
                current_time = 0.0
                
                for w in actual_words:
                    word_duration = len(w) * char_time
                    final_boundaries.append({
                        'text': w,
                        'start': round(current_time, 3),
                        'end': round(current_time + word_duration, 3)
                    })
                    current_time += word_duration
            else:
                final_boundaries = original_boundaries
        else:
            final_boundaries = original_boundaries

        return {
            'success': True,
            'audio_id': file_id,
            'audio_url': f'http://localhost:8000/tts-file/{filename}',
            'word_boundaries': final_boundaries
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/tts-file/{filename}')
async def get_tts_file(filename: str):
    filepath = os.path.join(TMP_AUDIO_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail='Audio file not found')
    return FileResponse(filepath, media_type='audio/mpeg')
