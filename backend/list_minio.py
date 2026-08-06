import os
from minio import Minio

MINIO_ENDPOINT = "localhost:9000"
MINIO_ACCESS_KEY = "minioadmin"
MINIO_SECRET_KEY = "minioadmin"
MINIO_BUCKET = "videos"

client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False
)

try:
    objects = client.list_objects(MINIO_BUCKET)
    print("Objects in bucket:")
    for obj in objects:
        print(" -", obj.object_name)
except Exception as e:
    print("Error listing objects:", str(e))
