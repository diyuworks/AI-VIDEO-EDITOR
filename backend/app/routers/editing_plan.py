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
    use_exact_script: Optional[bool] = False
    structured_options: Optional[dict] = None  # e.g. {"style": "fast-paced", "music": "upbeat"}
    duration_seconds: Optional[float] = None
    clip_metadata: Optional[List[dict]] = None  # [{label, duration, start_time, end_time, has_farmhouse, has_fountain}]


@router.post("/editing-plan")
def generate_editing_plan(request: EditingPlanRequest, session: Session = Depends(get_session)):
    # 1. Video record fetch karo
    video = session.exec(
        select(VideoRecord).where(VideoRecord.object_name == request.object_name)
    ).first()
    if not video:
        # Fallback for dynamic/merged videos
        video = VideoRecord(
            filename=request.object_name,
            object_name=request.object_name,
            duration_seconds=20.0,
            width=1080,
            height=1920
        )

    # 2. Reference script processing
    reference_text = ""
    if request.reference_captions:
        reference_text = "\n".join([c.get("text", "") for c in request.reference_captions])

    # 3. Context build karo Groq ke liye
    duration = request.duration_seconds if request.duration_seconds else (video.duration_seconds if video and video.duration_seconds else 20)
    word_count = int(duration * 2.5)
    word_count = int(duration * 2.5)
    context = f"""
You are an AI video editing assistant and scriptwriter. Based on the information below, generate a structured editing plan and a Voiceover Script in JSON format.

Main Video duration: {duration} seconds
Main Video Resolution: {video.width}x{video.height}
"""
    duration_str = f"The video is {duration} seconds long. CRITICAL: You MUST write a script that takes exactly {duration} seconds to read aloud. To achieve this, your script MUST contain EXACTLY {word_count} words! Expand on the property details creatively, talk about the investment benefits, the location, and the future value to naturally fill the time without sounding repetitive."

    if reference_text:
        context += f"""
Reference Video Script/Voiceover:
"{reference_text}"

Task: {duration_str}
CRITICAL TOPIC: This is a Real Estate / Land (જમીન લે-વેચ) video. 
You MUST write a voiceover script for the Main Video that perfectly conveys the meaning of the Reference Video, but in the style of a highly successful, professional Gujarati Real Estate Broker on Instagram/YouTube Reels.
Do NOT repeat words unnecessarily. Keep it realistic and natural.

CRITICAL HOOK INSTRUCTION: The very FIRST sentence MUST be an extremely impressive, realistic, and catchy Gujarati hook. 
You MUST start the script EXACTLY with: "નમસ્તે મિત્રો, કેમ છો!"
Do NOT use any other hook. Start directly with "નમસ્તે મિત્રો, કેમ છો!" and then seamlessly transition into the real estate pitch.

CRITICAL LOCATION FORMATTING: You MUST ALWAYS include the exact location in this specific sequence: "ગામ શેખપુર, તાલુકો વડનગર, જિલ્લો મહેસાણા". Do NOT use any other village, taluka, or district name.

CRITICAL PRICING & TENURE INFO: You MUST include the exact price and condition: "ભાવ પ્રતિ વીઘા ચાલીસ લાખ છે" (Price is 40 Lakh per bigha). You MUST explicitly mention the word "શરત" (Sharat / Tenure), for example "નવી શરતની જમીન" (New Tenure Land). Do not skip this!

CRITICAL CONTENT RULE (No Plus/Minus): Do NOT add extra unnecessary words (no 'plus') and do NOT skip important details from the reference video (no 'minus'). You MUST retain EVERY SINGLE technical real estate word from the reference (like શરત, વીઘા, ભાવ, etc.). Keep the script highly realistic, exact, and to the point.
DO NOT write headers like "Title:", "ટાઇટલ:", "શીર્ષક:", or "Script:" inside the generated_script. The script should ONLY contain the exact words to be spoken.
CRITICAL PUNCTUATION RULE: You MUST use proper punctuation (commas ',', full stops '.', question marks '?'). Write short, punchy sentences. This is required so the AI voice pauses naturally and breathes like a normal human in the video.

CRITICAL PURE GUJARATI RULE: Do NOT use any Hindi words (e.g. 'lekin', 'zaroor', 'dost'). Do NOT use English words or transliterated English words (e.g. do NOT write 'ટાઇટલ' for Title, 'વિડિયો' for Video, or 'લોકેશન' for Location). Use ONLY pure, authentic Gujarati words (e.g. 'શીર્ષક', 'દ્રશ્ય', 'જગ્યા'). It must sound exactly like a local Gujarati person.
CRITICAL ANTI-HALLUCINATION RULE: Under NO circumstances should you repeat a word or phrase multiple times in a row (e.g. do NOT write "જી જી જી" or "છે છે છે"). Write clean, realistic text.
DO NOT use English characters for the script.
"""
    else:
        context += f"""
Task: {duration_str}
Write a highly engaging, professional voiceover script for the Main Video. 
The voiceover script MUST be written entirely in Native Gujarati Script (e.g. નમસ્તે, કેમ છો).
CRITICAL: The very FIRST sentence MUST be a powerful, cinematic hook that instantly grabs attention and impresses the viewer!
CRITICAL: The Gujarati MUST be perfectly natural, grammatically flawless, and very simple. Do NOT use overly complex, weird, or awkward words. It must sound like a real native speaker on social media.
"""

    if request.use_exact_script:
        context += f"""
User's EXACT Script: {request.prompt or ""}
CRITICAL USER REQUIREMENT (EXACT SCRIPT MATCH): 
You MUST use the "User's EXACT Script" word-for-word exactly as it is provided above. 
DO NOT rewrite, do not summarize, do not add any extra intro or outro hooks. 
Your ONLY job is to take the EXACT words from the User's EXACT Script and split them across the video segments below.
If the script is in Hindi or English, LEAVE IT AS IS. Do not translate. Just output the EXACT words.
Structured options: {json.dumps(request.structured_options) if request.structured_options else "None"}
"""
    else:
        context += f"""
User's Request/Prompt: {request.prompt or "No specific prompt given"}
CRITICAL USER REQUIREMENT: You MUST strictly incorporate the User's Request/Prompt above into the voiceover script. (e.g. if they say "1.8 vigha, farmhouse, highway najik", you must include these details beautifully in the real estate script).
Structured options: {json.dumps(request.structured_options) if request.structured_options else "None"}
"""

    # Inject clip timeline for Segment-Based context-aware narration
    if request.clip_metadata and len(request.clip_metadata) > 0:
        timeline_lines = []
        for i, clip in enumerate(request.clip_metadata):
            start = clip.get("start_time", 0)
            end = clip.get("end_time", 0)
            dur = clip.get("duration", 0)
            label = clip.get("label", "Land")
            has_farmhouse = clip.get("has_farmhouse", False)
            has_fountain = clip.get("has_fountain", False)
            price = clip.get("price", "")
            size = clip.get("size", "")
            road_info = clip.get("road_info", "")
            
            # Target words for this segment (~3.5 words per sec to avoid any silence gaps)
            target_words = int(dur * 3.5)
            
            # Determine what's visually shown in this clip
            visual_elements = []
            if has_farmhouse:
                visual_elements.append("FARMHOUSE (ફાર્મહાઉસ)")
            if has_fountain:
                visual_elements.append("FOUNTAIN (ફાઉન્ટેન)")
            if not visual_elements:
                visual_elements.append(f"LAND/PLOT ({label})")
            
            visual_desc = " and ".join(visual_elements)
            extra_info = []
            if price: extra_info.append(f"Price: {price}")
            if size: extra_info.append(f"Size: {size}")
            if road_info: extra_info.append(f"Road: {road_info}")
            extra_str = " | ".join(extra_info) if extra_info else "No extra details"
            
            req_line = f"  - Segment {i}: {dur} seconds (Target: ~{target_words} words). Shows: {visual_desc}. Details: {extra_str}"
            timeline_lines.append(req_line)
        
        timeline_text = "\n".join(timeline_lines)
        context += f"""
CRITICAL SEGMENT-BASED NARRATION INSTRUCTIONS:
You MUST generate the voiceover as an array of strictly separated "segments", one for each clip in the video.
This is to ensure exact audio-visual syncing.

Segments Info:
{timeline_text}

RULES FOR EACH SEGMENT:
1. Segment 0 (The first clip) MUST ALWAYS start with the exact hook: "નમસ્તે મિત્રો, કેમ છો!"
2. If a segment shows "FARMHOUSE", you MUST mention "ફાર્મહાઉસ" prominently in that segment's text.
3. If a segment shows "FOUNTAIN", you MUST mention "ફાઉન્ટેન" prominently in that segment's text.
4. If a segment has Price, Size, or Road details, you MUST gracefully weave those details into that segment's Gujarati text (e.g. mention the price in lakhs/crores, size in vigha/sq.ft as provided).
5. MATCH THE VISUALS: Do NOT mention farmhouse when land is showing, and do NOT mention fountain when farmhouse is showing.
6. NO SILENCE GAPS (CRITICAL): You MUST write detailed, continuous, and long descriptions to completely fill the clip duration. DO NOT write short sentences that leave 3-4 seconds of silence! You MUST write at least the "Target words" specified for EACH segment. If a segment is long, describe the beautiful scenery, the fresh air, the investment opportunity, or the benefits to ensure continuous speaking without gaps.
7. TRANSITIONS: Make each segment flow naturally to the next, even though they are separate text blocks.

CRITICAL OUTRO INSTRUCTION:
You MUST provide the exact outro string: "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો." in the `outro_text` field.
"""

    context += f"""
Generate a JSON editing plan with this exact structure:
{{
  "trims": [{{"start": 0, "end": 5, "action": "keep/cut"}}],
  "caption_style": {{"font": "...", "position": "...", "animation": "..."}},
  "effects": ["effect1", "effect2"],
  "music_suggestion": "description of music style",
  "segments": [
    {{"clip_index": 0, "text": "Gujarati text for segment 0"}},
    {{"clip_index": 1, "text": "Gujarati text for segment 1"}}
  ],
  "outro_text": "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો.",
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

        # Apply specific Gujarati pronunciation/spelling corrections to raw text before JSON parse
        # These critical words MUST always be perfect: નમસ્તે મિત્રો, શ્રેષ્ઠ, જિલ્લો, જગ્યા, રત્નપ્રભા, હોસ્પિટલ, ચિંતા, જીવન, સંપર્ક
        corrections = {
            # --- નમસ્તે (Namaste) ---
            "નમસ્્તે": "નમસ્તે", "નમસતે": "નમસ્તે", "નમસ્તેં": "નમસ્તે", "નમસ્‍તે": "નમસ્તે", "નમસ્‌તે": "નમસ્તે", "નમસ્​તે": "નમસ્તે",
            # --- મિત્રો (Mitro) ---
            "મતિ્રો": "મિત્રો", "મિત્રોં": "મિત્રો", "મીત્રો": "મિત્રો", "મિત્રરો": "મિત્રો", "મિત્રો,": "મિત્રો,",
            # --- શ્રેષ્ઠ (Shreshth) ---
            "શ્રેષ્ટ": "શ્રેષ્ઠ", "શ્રેશ્ઠ": "શ્રેષ્ઠ", "શ્રેસ્ટ": "શ્રેષ્ઠ", "શરેષ્ઠ": "શ્રેષ્ઠ", "શરેષ્ટ": "શ્રેષ્ઠ", "શ્રેશ્ટ": "શ્રેષ્ઠ", "શ્રેષ્ટ્": "શ્રેષ્ઠ", "શ્રેસ્ઠ": "શ્રેષ્ઠ", "શ્રેષ્‍ઠ": "શ્રેષ્ઠ",
            # --- જિલ્લો (Jillo) ---
            "જીલ્લો": "જિલ્લો", "જીલ્લા": "જિલ્લો", "જિલ્લા": "જિલ્લો", "જિલો": "જિલ્લો", "જીલો": "જિલ્લો", "જીલ્લોં": "જિલ્લો",
            # --- જગ્યા (Jagya) ---
            "જગીયા": "જગ્યા", "જગીઆ": "જગ્યા", "જગયા": "જગ્યા", "જાગ્યા": "જગ્યા", "જગ્‍યા": "જગ્યા", "જગીયાં": "જગ્યા",
            # --- રત્નપ્રભા (Ratnaprabha) ---
            "રતનપ્રભા": "રત્નપ્રભા", "રત્ન પ્રભા": "રત્નપ્રભા", "રત્નપ્રભા હોસ્પીટલ": "રત્નપ્રભા હોસ્પિટલ", "રતન પ્રભા": "રત્નપ્રભા", "રત્નપ્રભાં": "રત્નપ્રભા",
            # --- હોસ્પિટલ (Hospital) ---
            "હોસ્પીટલ": "હોસ્પિટલ", "હૉસ્પિટલ": "હોસ્પિટલ", "હૉસ્પીટલ": "હોસ્પિટલ", "હોસ્પિટળ": "હોસ્પિટલ", "હોસ્પીટળ": "હોસ્પિટલ",
            # --- ચિંતા (Chinta) ---
            "ચીંતા": "ચિંતા", "ચીન્તા": "ચિંતા", "ચિન્તા": "ચિંતા", "ચિતા": "ચિંતા", "ચીંતાં": "ચિંતા",
            # --- જીવન (Jivan) ---
            "જીંદગી": "જીવન", "જિંદગી": "જીવન", "જીંવન": "જીવન", "જીવણ": "જીવન", "જિવન": "જીવન", "જીવનં": "જીવન", "જીવાન": "જીવન",
            # --- સંપર્ક (Sampark) ---
            "સંપરક": "સંપર્ક", "સમ્પર્ક": "સંપર્ક", "સમ્પરક": "સંપર્ક", "સંપર્ક્": "સંપર્ક", "સંપર્‍ક": "સંપર્ક",
            # --- Location words ---
            "શાકેપુર": "શેખપુર", "શેખપૂર": "શેખપુર", "બડાનગર": "વડનગર", "બડા નગર": "વડનગર", "બડનગર": "વડનગર", "વડાનગર": "વડનગર",
            # --- Price/Tenure words ---
            "બાઓ": "ભાવ", "ભાવો": "ભાવ", "શારદા": "શરત",
            # --- Remove English/Hindi title headers ---
            "ટાઇટલ:": "", "ટાઈટલ:": "", "ટાઇટલ": "", "ટાઈટલ": "", "Title:": "", "title:": "", "શીર્ષક:": "",
            # --- Other common Gujarati corrections ---
            "વિડીયો": "વીડિયો",
            # ZWJ/ZWNJ cleanup
            '\u200d': '', '\u200c': ''
        }

        for wrong, right in corrections.items():
            raw_text = raw_text.replace(wrong, right)

        # JSON clean karo (if wrapped in backticks)
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
        
        editing_plan = json.loads(raw_text)

        # Provide a fallback if LLM didn't return segments properly
        if "segments" not in editing_plan:
            if "generated_script" in editing_plan:
                editing_plan["segments"] = [{"clip_index": 0, "text": editing_plan["generated_script"]}]
            else:
                editing_plan["segments"] = []
                
        if "outro_text" not in editing_plan:
            editing_plan["outro_text"] = "જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો."

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI response was not valid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API error: {str(e)}")

    return {
        "object_name": request.object_name,
        "editing_plan": editing_plan,
    }
