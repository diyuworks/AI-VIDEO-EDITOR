import os

with open('app/routers/editing_plan.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    '''CRITICAL PURE GUJARATI RULE: Do NOT use any Hindi words (e.g. 'lekin', 'zaroor', 'dost'). Do NOT use English words or transliterated English words (e.g. do NOT write 'ટાઇટલ' for Title, 'વિડિયો' for Video, or 'લોકેશન' for Location). Use ONLY pure, authentic Gujarati words (e.g. 'શીર્ષક', 'દ્રશ્ય', 'જગ્યા'). It must sound exactly like a local Gujarati person.
CRITICAL ANTI-HALLUCINATION RULE: Under NO circumstances should you repeat a word or phrase multiple times in a row (e.g. do NOT write "જી જી જી" or "છે છે છે"). Write clean, realistic text.
DO NOT use English characters for the script.''',
    '''CRITICAL LANGUAGE RULE: The script MUST be written entirely in ENGLISH PHONETIC GUJARATI (e.g. 'namste mitro', 'kem cho'). This is required so the AI voice reads it with the correct accent.
DO NOT use actual Gujarati characters (e.g. do NOT use નમસ્તે, use namste). Use English alphabets only. Write short, punchy sentences.'''
)

content = content.replace(
    '''Examples of a GOOD start: 
- "નમસ્તે મિત્રો, શું તમે પણ રોકાણ માટે એક શ્રેષ્ઠ જમીન શોધી રહ્યા છો?"
- "જો તમે ભવિષ્ય માટે જમીન લેવાનું વિચારી રહ્યા છો, તો આ વિડીયો તમારા માટે જ છે!"
- "આજે અમે તમારા માટે લાવ્યા છીએ એક એવી શાનદાર જમીન, જે તમારું મન મોહી લેશે..."''',
    '''Examples of a GOOD start: 
- "namste mitro, shu tame pan rokan mate ek shresth jamin shodhi rahya cho?"
- "jo tame bhavishya mate jamin levanu vichari rahya cho, to aa video tamara mate j che!"'''
)

content = content.replace(
    '"ગામ શેખપુર, તાલુકો વડનગર, જિલ્લો મહેસાણા"',
    '"gaam shekhpur, taluka vadnagar, jilla mehsana"'
)

content = content.replace(
    '"ભાવ પ્રતિ વીઘા ચાલીસ લાખ છે" (Price is 40 Lakh per bigha)',
    '"bhav prati vigha chalis lakh che" (Price is 40 Lakh per bigha)'
)

content = content.replace(
    '"શરત" (Sharat / Tenure), for example "નવી શરતની જમીન" (New Tenure Land)',
    '"sharat" (Sharat / Tenure), for example "navi sharat ni jamin" (New Tenure Land)'
)

content = content.replace(
    '"જમીન અંગે વધુ માહિતી માટે અમને સંપર્ક કરો." (Do not change this, always end the script with this phrase to match the JAMIN24 end screen branding).',
    '"jamin ange vadhu mahiti mate amne sampark karo." (Do not change this, always end the script with this phrase).'
)

content = content.replace(
    'The voiceover script MUST be written entirely in Native Gujarati Script (e.g. નમસ્તે, કેમ છો).',
    'The voiceover script MUST be written entirely in ENGLISH PHONETIC GUJARATI (e.g. \\\'namste mitro\\\', \\\'kem cho\\\'). DO NOT use actual Gujarati characters.'
)

with open('app/routers/editing_plan.py', 'w', encoding='utf-8') as f:
    f.write(content)
