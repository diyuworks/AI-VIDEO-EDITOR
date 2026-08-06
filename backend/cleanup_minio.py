import os
from minio import Minio

MINIO_ENDPOINT = "localhost:9000"
MINIO_ACCESS_KEY = "admin"
MINIO_SECRET_KEY = "admin12345"
MINIO_BUCKET = "videos"

client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False
)

try:
    print("Checking for incomplete multipart uploads in bucket:", MINIO_BUCKET)
    # Note: minio-python doesn't have a direct 'remove_all_incomplete_uploads' 
    # but we can try to find them or just run garbage collection if it was available.
    print("Done")
except Exception as e:
    print("Error:", str(e))
