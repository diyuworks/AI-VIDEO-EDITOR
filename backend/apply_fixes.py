import os

# Update tts.py to REMOVE phonetic map (since user wants Pure Gujarati from LLM)
tts_content = '''import io
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
    voice: str = 'gu-IN-NiranjanNeural'

TMP_AUDIO_DIR = 'tts_output'
os.makedirs(TMP_AUDIO_DIR, exist_ok=True)

@router.post('/generate-tts')
async def generate_tts(request: TTSRequest):
    file_id = str(uuid.uuid4())
    filename = f'{file_id}.mp3'
    filepath = os.path.join(TMP_AUDIO_DIR, filename)

    try:
        communicate = edge_tts.Communicate(request.text, request.voice, rate='+70%')
        
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
            'audio_url': f'https://reel-backend.jamin24.com/tts-file/{filename}',
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
'''

with open('app/routers/tts.py', 'w', encoding='utf-8') as f:
    f.write(tts_content)

# Update editing_plan.py with ALL requested Gujarati dictionary corrections
with open('app/routers/editing_plan.py', 'r', encoding='utf-8') as f:
    plan_content = f.read()

import re
old_corrections = r'''        corrections = {
            "શાકેપુર": "શેખપુર",
            "શારદા": "શરત",
            "બડાનગર": "વડનગર",
            "બડા નગર": "વડનગર",
            "બડનગર": "વડનગર",
            "બાઓ": "ભાવ",
            "ભાવો": "ભાવ",
            "ટાઇટલ:": "",
            "ટાઈટલ:": "",
            "ટાઇટલ": "",
            "ટાઈટલ": "",
            "Title:": "",
            "title:": "",
            "શીર્ષક:": ""
        }'''

new_corrections = r'''        corrections = {
            "શ્રેષ્ટ": "શ્રેષ્ઠ",
            "શ્રેશ્ઠ": "શ્રેષ્ઠ",
            "શ્રેસ્ટ": "શ્રેષ્ઠ",
            "શરેષ્ઠ": "શ્રેષ્ઠ",
            "શરેષ્ટ": "શ્રેષ્ઠ",
            "મતિ્રો": "મિત્રો",
            "મિત્રોં": "મિત્રો",
            "નમસ્્તે": "નમસ્તે",
            "જીલ્લો": "જિલ્લો",
            "જીલ્લા": "જિલ્લો",
            "જિલ્લા": "જિલ્લો",
            "રતનપ્રભા": "રત્નપ્રભા",
            "રત્ન પ્રભા": "રત્નપ્રભા",
            "રત્નપ્રભા હોસ્પીટલ": "રત્નપ્રભા હોસ્પિટલ",
            "હોસ્પીટલ": "હોસ્પિટલ",
            "ચીંતા": "ચિંતા",
            "ચીન્તા": "ચિંતા",
            "જીંદગી": "જીવન",
            "જિંદગી": "જીવન",
            "સંપરક": "સંપર્ક",
            "સમ્પર્ક": "સંપર્ક",
            "જગીયા": "જગ્યા",
            "જગીઆ": "જગ્યા",
            "વિડીયો": "વીડિયો",
            "શાકેપુર": "શેખપુર",
            "શારદા": "શરત",
            "બડાનગર": "વડનગર",
            "બડા નગર": "વડનગર",
            "બડનગર": "વડનગર",
            "બાઓ": "ભાવ",
            "ભાવો": "ભાવ",
            "ટાઇટલ:": "",
            "ટાઈટલ:": "",
            "ટાઇટલ": "",
            "ટાઈટલ": "",
            "Title:": "",
            "title:": "",
            "શીર્ષક:": ""
        }'''

plan_content = plan_content.replace(old_corrections, new_corrections)

with open('app/routers/editing_plan.py', 'w', encoding='utf-8') as f:
    f.write(plan_content)
