import requests

r = requests.post(
    "http://localhost:8000/generate-voiceover",
    json={
        "captions": [
            {"id": "cap1", "text": "આ એક પરીક્ષણ છે", "start": 0.0, "end": 2.5},
            {"id": "cap2", "text": "", "start": 2.5, "end": 3.0}
        ],
        "language": "gu"
    }
)

print(r.status_code)
print(r.json())
