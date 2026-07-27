@echo off
echo Starting MinIO & Postgres containers...
docker compose -f infra/docker/docker-compose.yml up -d minio postgres

echo Starting FastAPI Backend...
start cmd /k "cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo Starting Vite Frontend...
start cmd /k "cd frontend && npm run dev"

echo 🚀 Both servers started in separate windows!
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
pause
