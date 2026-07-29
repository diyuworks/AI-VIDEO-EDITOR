# API (FastAPI backend)

## Local dev (without Docker)
```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```
Visit https://reel-backend.jamin24.com/health to confirm it is running.

## Local dev (with Docker Compose)
See ../../infra/docker/docker-compose.yml — run from repo root:
```bash
docker compose -f infra/docker/docker-compose.yml up
```
