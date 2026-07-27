import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")

url = "https://api.sarvam.ai/text-to-speech"
headers = {
    "api-subscription-key": SARVAM_API_KEY,
    "Content-Type": "application/json"
}

payload = {
    "inputs": ["यह 9.75 बीघा का प्राइम प्लॉट हाईवे के पास उपलब्ध है। उत्कृष्ट कनेक्टिविटी और बेहतरीन लोकेशन।"],
    "target_language_code": "hi-IN",
    "speaker": "pooja",
    "pitch": 0,
    "pace": 1.0,
    "loudness": 1.5,
    "speech_sample_rate": 22050,
    "enable_preprocessing": True,
    "model": "bulbul:v3"
}

print(f"Testing Sarvam API with key {SARVAM_API_KEY[:8]}...")
res = requests.post(url, headers=headers, json=payload)
print("Status Code:", res.status_code)
if res.status_code == 200:
    print("Sarvam API Response Successful!")
    data = res.json()
    print("Audios count:", len(data.get("audios", [])))
else:
    print("Error:", res.text)
