# Ensure MinIO and Postgres storage services are running
docker compose -f infra/docker/docker-compose.yml up -d minio postgres

# Start FastAPI backend in a new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; & .\venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 4005"

# Start Vite frontend in a new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host "🚀 Backend and Frontend are starting up in separate windows..." -ForegroundColor Green
Write-Host "Backend API: http://localhost:4005" -ForegroundColor Cyan
Write-Host "Frontend Web: http://localhost:5173" -ForegroundColor Cyan
