import requests, base64

r = requests.post(
    "https://api.sarvam.ai/text-to-speech",
    headers={
        "api-subscription-key": "sk_p3ywv38u_htu7yMIwbHnTUH3QaIQBDmYj",
        "Content-Type": "application/json"
    },
    json={
        "text": "આ એક પરીક્ષણ છે",
        "target_language_code": "gu-IN",
        "model": "bulbul:v3",
        "speaker": "pooja"
    }
)

print(r.status_code, r.text[:500])

data = r.json()
audio = base64.b64decode(data["audios"][0])
open("test_sarvam.wav", "wb").write(audio)
print("Saved test_sarvam.wav")
