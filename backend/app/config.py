import os
from dotenv import load_dotenv

load_dotenv()

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin12345")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "videos")
MINIO_SECURE = os.getenv("MINIO_SECURE", "False") == "True"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Email Notification Settings
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
NOTIFICATION_EMAIL_TO = os.getenv("NOTIFICATION_EMAIL_TO", "")
ENABLE_EMAIL_NOTIFICATIONS = os.getenv("ENABLE_EMAIL_NOTIFICATIONS", "True").lower() == "true"

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "https://reel-backend.jamin24.com").rstrip("/")

def get_backend_base_url(request=None) -> str:
    env_url = os.getenv("BACKEND_BASE_URL", "").rstrip("/")
    if env_url:
        return env_url
    if request:
        try:
            return str(request.base_url).rstrip("/")
        except Exception:
            pass
    return "http://localhost:4005"

