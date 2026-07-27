import asyncio
import os
import edge_tts

async def generate():
    text = "નમસ્કાર! શું તમે ગુજરાતમાં ઉત્તમ જમીન ખરીદવાનું વિચારી રહ્યા છો? અમારી પાસે તમારા માટે શ્રેષ્ઠ અને વ્યાજબી ભાવે જમીન ઉપલબ્ધ છે. રોકાણ માટે આ સૌથી સારો વિકલ્પ છે. આજે જ અમારો સંપર્ક કરો અને તમારું ભવિષ્ય સુરક્ષિત કરો!"
    
    # We use the same parameters Jay used in the TTS endpoint (+70% rate, Niranjan)
    communicate = edge_tts.Communicate(text, "gu-IN-NiranjanNeural", rate="+70%")
    
    output_path = "gujarati_land_pitch.mp3"
    await communicate.save(output_path)
    print(f"Generated successfully: {output_path}")

if __name__ == "__main__":
    asyncio.run(generate())
