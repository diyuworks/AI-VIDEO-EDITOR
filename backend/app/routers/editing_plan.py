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
    duration_str = f"The video is {duration} seconds long. Write a naturally paced voiceover script. Do NOT force a specific word count, and do NOT repeat phrases just to fill time. The voiceover should be spoken at a NORMAL, professional, and clear speed."

    if reference_text:
        context += f"""
Reference Video Script/Voiceover:
"{reference_text}"

Task: {duration_str}
CRITICAL TOPIC: This is a Real Estate / Land (જમીન લે-વેચ) video. 
You MUST write a voiceover script for the Main Video that perfectly conveys the meaning of the Reference Video, but in the style of a highly successful, professional Gujarati Real Estate Broker on Instagram/YouTube Reels.
Do NOT repeat words unnecessarily. Keep it realistic and natural.

CRITICAL HOOK INSTRUCTION: The very FIRST sentence MUST be an extremely impressive, realistic, and catchy Gujarati hook. 
Examples of a GOOD start: 
- "નમસ્તે મિત્રો, શું તમે પણ રોકાણ માટે એક શ્રેષ્ઠ જમીન શોધી રહ્યા છો?"
- "જો તમે ભવિષ્ય માટે જમીન લેવાનું વિચારી રહ્યા છો, તો આ વિડીયો તમારા માટે જ છે!"
- "આજે અમે તમારા માટે લાવ્યા છીએ એક એવી શાનદાર જમીન, જે તમારું મન મોહી લેશે..."
Make the start sound EXACTLY like this—natural, welcoming, and directly speaking to a buyer or investor.

CRITICAL LOCATION FORMATTING: You MUST ALWAYS include the exact location in this specific sequence: "ગામ શેખપુર, તાલુકો વડનગર, જિલ્લો મહેસાણા". Do NOT use any other village, taluka, or district name.

CRITICAL PRICING & TENURE INFO: You MUST include the exact price and condition: "ભાવ પ્રતિ વીઘા ચાલીસ લાખ છે" (Price is 40 Lakh per bigha). You MUST explicitly mention the word "શરત" (Sharat / Tenure), for example "નવી શરતની જમીન" (New Tenure Land). Do not skip this!

CRITICAL CONTENT RULE (No Plus/Minus): Do NOT add extra unnecessary words (no 'plus') and do NOT skip important details from the reference video (no 'minus'). You MUST retain EVERY SINGLE technical real estate word from the reference (like શરત, વીઘા, ભાવ, etc.). Keep the script highly realistic, exact, and to the point.
DO NOT write headers like "Title:", "ટાઇટલ:", "શીર્ષક:", or "Script:" inside the generated_script. The script should ONLY contain the exact words to be spoken.
CRITICAL PUNCTUATION RULE: You MUST use proper punctuation (commas ',', full stops '.', question marks '?'). Write short, punchy sentences. This is required so the AI voice pauses naturally and breathes like a normal human in the video.

CRITICAL PURE GUJARATI RULE: Do NOT use any Hindi words (e.g. 'lekin', 'zaroor', 'dost'). Do NOT use English words or transliterated English words (e.g. do NOT write 'ટાઇટલ' for Title, 'વિડિયો' for Video, or 'લોકેશન' for Location). Use ONLY pure, authentic Gujarati words (e.g. 'શીર્ષક', 'દ્રશ્ય', 'જગ્યા'). It must sound exactly like a local Gujarati person.
CRITICAL ANTI-HALLUCINATION RULE: Under NO circumstances should you repeat a word or phrase multiple times in a row (e.g. do NOT write "જી જી જી" or "છે છે છે"). Write clean, realistic text.
DO NOT use English characters for the script.
CRITICAL OUTRO INSTRUCTION: The script MUST ALWAYS end with this exact sentence: "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો." (Do not change this, always end the script with this phrase to match the JAMIN24 end screen branding).
"""
    else:
        context += f"""
Task: {duration_str}
Write a highly engaging, professional voiceover script for the Main Video. 
The voiceover script MUST be written entirely in Native Gujarati Script (e.g. નમસ્તે, કેમ છો).
CRITICAL: The very FIRST sentence MUST be a powerful, cinematic hook that instantly grabs attention and impresses the viewer!
CRITICAL: The Gujarati MUST be perfectly natural, grammatically flawless, and very simple. Do NOT use overly complex, weird, or awkward words. It must sound like a real native speaker on social media.
CRITICAL OUTRO INSTRUCTION: The script MUST ALWAYS end with this exact sentence: "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો." (Do not change this, always end the script with this phrase to match the JAMIN24 end screen branding).
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
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        raw_text = response.choices[0].message.content.strip()

        # JSON clean karo (if wrapped in backticks)
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
                
        # Apply specific Gujarati pronunciation/spelling corrections requested by user
        # These 9 critical words MUST always be perfect: નમસ્તે મિત્રો, શ્રેષ્ઠ, જિલ્લો, જગ્યા, રત્નપ્રભા, હોસ્પિટલ, ચિંતા, જીવન, સંપર્ક
        corrections = {
            # --- નમસ્તે (Namaste) ---
            "નમસ્્તે": "નમસ્તે",
            "નમસતે": "નમસ્તે",
            "નમસ્તેં": "નમસ્તે",
            "નમસ્‍તે": "નમસ્તે",
            "નમસ્‌તે": "નમસ્તે",
            "નમસ્​તે": "નમસ્તે",
            # --- મિત્રો (Mitro) ---
            "મતિ્રો": "મિત્રો",
            "મિત્રોં": "મિત્રો",
            "મીત્રો": "મિત્રો",
            "મિત્રરો": "મિત્રો",
            "મિત્રો,": "મિત્રો,",
            # --- શ્રેષ્ઠ (Shreshth) ---
            "શ્રેષ્ટ": "શ્રેષ્ઠ",
            "શ્રેશ્ઠ": "શ્રેષ્ઠ",
            "શ્રેસ્ટ": "શ્રેષ્ઠ",
            "શરેષ્ઠ": "શ્રેષ્ઠ",
            "શરેષ્ટ": "શ્રેષ્ઠ",
            "શ્રેશ્ટ": "શ્રેષ્ઠ",
            "શ્રેષ્ટ્": "શ્રેષ્ઠ",
            "શ્રેસ્ઠ": "શ્રેષ્ઠ",
            "શ્રેષ્‍ઠ": "શ્રેષ્ઠ",
            # --- જિલ્લો (Jillo) ---
            "જીલ્લો": "જિલ્લો",
            "જીલ્લા": "જિલ્લો",
            "જિલ્લા": "જિલ્લો",
            "જિલો": "જિલ્લો",
            "જીલો": "જિલ્લો",
            "જીલ્લોં": "જિલ્લો",
            # --- જગ્યા (Jagya) ---
            "જગીયા": "જગ્યા",
            "જગીઆ": "જગ્યા",
            "જગયા": "જગ્યા",
            "જાગ્યા": "જગ્યા",
            "જગ્‍યા": "જગ્યા",
            "જગીયાં": "જગ્યા",
            # --- રત્નપ્રભા (Ratnaprabha) ---
            "રતનપ્રભા": "રત્નપ્રભા",
            "રત્ન પ્રભા": "રત્નપ્રભા",
            "રત્નપ્રભા હોસ્પીટલ": "રત્નપ્રભા હોસ્પિટલ",
            "રતન પ્રભા": "રત્નપ્રભા",
            "રત્નપ્રભાં": "રત્નપ્રભા",
            # --- હોસ્પિટલ (Hospital) ---
            "હોસ્પીટલ": "હોસ્પિટલ",
            "હૉસ્પિટલ": "હોસ્પિટલ",
            "હૉસ્પીટલ": "હોસ્પિટલ",
            "હોસ્પિટળ": "હોસ્પિટલ",
            "હોસ્પીટળ": "હોસ્પિટલ",
            # --- ચિંતા (Chinta) ---
            "ચીંતા": "ચિંતા",
            "ચીન્તા": "ચિંતા",
            "ચિન્તા": "ચિંતા",
            "ચિતા": "ચિંતા",
            "ચીંતાં": "ચિંતા",
            # --- જીવન (Jivan) ---
            "જીંદગી": "જીવન",
            "જિંદગી": "જીવન",
            "જિવન": "જીવન",
            "જીવાન": "જીવન",
            "જીવણ": "જીવન",
            # --- સંપર્ક (Sampark) ---
            "સંપરક": "સંપર્ક",
            "સમ્પર્ક": "સંપર્ક",
            "સમ્પરક": "સંપર્ક",
            "સંપર્ક્": "સંપર્ક",
            "સંપર્‍ક": "સંપર્ક",
            # --- Location words ---
            "શાકેપુર": "શેખપુર",
            "શેખપૂર": "શેખપુર",
            "બડાનગર": "વડનગર",
            "બડા નગર": "વડનગર",
            "બડનગર": "વડનગર",
            "વડાનગર": "વડનગર",
            # --- Price/Tenure words ---
            "બાઓ": "ભાવ",
            "ભાવો": "ભાવ",
            "શારદા": "શરત",
            # --- Remove English/Hindi title headers ---
            "ટાઇટલ:": "",
            "ટાઈટલ:": "",
            "ટાઇટલ": "",
            "ટાઈટલ": "",
            "Title:": "",
            "title:": "",
            "શીર્ષક:": "",
            # --- Other common Gujarati corrections ---
            "વિડીયો": "વીડિયો",
        }
        for wrong, right in corrections.items():
            raw_text = raw_text.replace(wrong, right)

        editing_plan = json.loads(raw_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI response was not valid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API error: {str(e)}")

    return {
        "object_name": request.object_name,
        "editing_plan": editing_plan,
    }
