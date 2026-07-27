import os

with open('app/routers/editing_plan.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
'''CRITICAL HOOK INSTRUCTION: The very FIRST sentence MUST be an extremely impressive, realistic, and catchy Gujarati hook. 
Examples of a GOOD start: 
- "નમસ્તે મિત્રો, શું તમે પણ રોકાણ માટે એક શ્રેષ્ઠ જમીન શોધી રહ્યા છો?"
- "જો તમે ભવિષ્ય માટે જમીન લેવાનું વિચારી રહ્યા છો, તો આ વિડીયો તમારા માટે જ છે!"
- "આજે અમે તમારા માટે લાવ્યા છીએ એક એવી શાનદાર જમીન, જે તમારું મન મોહી લેશે..."
Make the start sound EXACTLY like this—natural, welcoming, and directly speaking to a buyer or investor.''',
'''CRITICAL HOOK INSTRUCTION: The very FIRST sentence of the script MUST be EXACTLY one of the following three options. Do NOT change a single word, just copy and paste one of these three options as your first sentence:
Option 1: "નમસ્તે મિત્રો, શું તમે પણ રોકાણ માટે એક શ્રેષ્ઠ જમીન શોધી રહ્યા છો?"
Option 2: "જો તમે ભવિષ્ય માટે જમીન લેવાનું વિચારી રહ્યા છો, તો આ વિડીયો તમારા માટે જ છે!"
Option 3: "આજે અમે તમારા માટે લાવ્યા છીએ એક એવી શાનદાર જમીન, જે તમારું મન મોહી લેશે..."
You MUST select one of these and use it EXACTLY as written for the start.'''
)

text = text.replace(
'''CRITICAL LOCATION FORMATTING: You MUST ALWAYS include the exact location in this specific sequence: "ગામ શેખપુર, તાલુકો વડનગર, જિલ્લો મહેસાણા". Do NOT use any other village, taluka, or district name.''',
'''CRITICAL LOCATION FORMATTING: You MUST ALWAYS include the exact location in this specific sequence EXACTLY as written: "ગામ શેખપુર, તાલુકો વડનગર, જિલ્લો મહેસાણા". Do NOT use any other village, taluka, or district name.'''
)

with open('app/routers/editing_plan.py', 'w', encoding='utf-8') as f:
    f.write(text)
