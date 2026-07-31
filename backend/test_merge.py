import urllib.request
import json
data = json.dumps({"clip_object_names": ["02-compressed.mp4", "01-compressed.mp4"]}).encode('utf-8')
req = urllib.request.Request("http://localhost:8000/merge-clips", data=data, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as res:
        print(res.status)
        print(res.read().decode())
except urllib.error.HTTPError as e:
    print(e.code)
    print(e.read().decode())
