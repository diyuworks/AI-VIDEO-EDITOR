@echo off
echo Starting MinIO Server...
set MINIO_ROOT_USER=minioadmin
set MINIO_ROOT_PASSWORD=minioadmin
start "MinIO Server" cmd /c "minio.exe server minio-data"

echo Starting FastAPI Uvicorn Server...
start "Uvicorn Backend" cmd /k "venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload"

echo Both servers have been started in separate windows!
echo Please keep those windows open while using the application.
pause
