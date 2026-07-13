# ============================================================
# AI Video Editor — Phase 1 Scaffold Script
# Run this FROM INSIDE your cloned repo folder, e.g.:
#   cd "C:\Users\Diya Malvia\Desktop\AI-VIDEO-EDITOR\AI-VIDEO-EDITOR"
#   .\scaffold.ps1
# It creates all folders/files, does NOT touch .git or push anything.
# You'll git add/commit/push yourself after reviewing.
# ============================================================

Write-Host "Creating folder structure..." -ForegroundColor Cyan

$dirs = @(
    "apps\api\app",
    "apps\web\src",
    "infra\docker",
    "docs",
    "packages\video-schema"
)
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ---------------- apps/api ----------------

Set-Content -Path "apps\api\app\__init__.py" -Value ""

@'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Video Editor API", version="0.1.0")

# Allow the frontend dev server to call this API during local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    """Basic liveness check. Used to confirm the API is reachable
    from the frontend and from Docker Compose."""
    return {"status": "ok", "service": "ai-video-editor-api"}


@app.get("/")
def root():
    return {"message": "AI Video Editor API is running"}
'@ | Set-Content -Path "apps\api\app\main.py"

@'
fastapi==0.115.0
uvicorn[standard]==0.32.0
python-dotenv==1.0.1
sqlalchemy==2.0.35
psycopg2-binary==2.9.9
pydantic==2.9.2
'@ | Set-Content -Path "apps\api\requirements.txt"

@'
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
'@ | Set-Content -Path "apps\api\Dockerfile"

@'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_video_editor
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
'@ | Set-Content -Path "apps\api\.env.example"

@'
# API (FastAPI backend)

## Local dev (without Docker)
```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```
Visit http://localhost:8000/health to confirm it is running.

## Local dev (with Docker Compose)
See ../../infra/docker/docker-compose.yml — run from repo root:
```bash
docker compose -f infra/docker/docker-compose.yml up
```
'@ | Set-Content -Path "apps\api\README.md"

# ---------------- apps/web ----------------

@'
{
  "name": "ai-video-editor-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.45",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2"
  }
}
'@ | Set-Content -Path "apps\web\package.json"

@'
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
})
'@ | Set-Content -Path "apps\web\vite.config.ts"

@'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
'@ | Set-Content -Path "apps\web\tsconfig.json"

@'
/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
}
'@ | Set-Content -Path "apps\web\tailwind.config.js"

@'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
'@ | Set-Content -Path "apps\web\postcss.config.js"

@'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Video Editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'@ | Set-Content -Path "apps\web\index.html"

@'
@tailwind base;
@tailwind components;
@tailwind utilities;
'@ | Set-Content -Path "apps\web\src\index.css"

@'
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
'@ | Set-Content -Path "apps\web\src\main.tsx"

@'
import { useEffect, useState } from "react"

function App() {
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "unreachable">("checking")

  useEffect(() => {
    fetch("http://localhost:8000/health")
      .then((res) => res.json())
      .then(() => setApiStatus("connected"))
      .catch(() => setApiStatus("unreachable"))
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">AI Video Editor</h1>
      <p className="text-slate-400">Frontend scaffold — Phase 1 setup</p>
      <div className="text-sm">
        Backend status:{" "}
        <span
          className={
            apiStatus === "connected"
              ? "text-green-400"
              : apiStatus === "unreachable"
                ? "text-red-400"
                : "text-yellow-400"
          }
        >
          {apiStatus}
        </span>
      </div>
    </div>
  )
}

export default App
'@ | Set-Content -Path "apps\web\src\App.tsx"

@'
# Web (React + TypeScript + Tailwind)

## Local dev
```bash
npm install
npm run dev
```
Visit http://localhost:5173 — it should show "Backend status: connected" if the API is running on port 8000.
'@ | Set-Content -Path "apps\web\README.md"

# ---------------- infra/docker ----------------

@'
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ai_video_editor
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio:
    image: minio/minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  api:
    build: ../../apps/api
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/ai_video_editor
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
    depends_on:
      - postgres
      - minio
    volumes:
      - ../../apps/api:/app

volumes:
  postgres_data:
  minio_data:
'@ | Set-Content -Path "infra\docker\docker-compose.yml"

@'
# Local dev environment

From the repo root:
```bash
docker compose -f infra/docker/docker-compose.yml up
```

This starts:
- Postgres on :5432
- MinIO on :9000 (API) and :9001 (web console — login minioadmin/minioadmin)
- FastAPI backend on :8000

Run the frontend separately (not containerized yet, for fast dev reload):
```bash
cd apps/web
npm install
npm run dev
```
Then visit http://localhost:5173
'@ | Set-Content -Path "infra\docker\README.md"

# ---------------- .gitignore (append if not already covering these) ----------------

if (Test-Path ".gitignore") {
    $gitignoreContent = Get-Content ".gitignore" -Raw
} else {
    $gitignoreContent = ""
}

if ($gitignoreContent -notmatch "node_modules") {
@'

# Node
node_modules/
dist/
build/
.env
.env.local

# Python
__pycache__/
*.pyc
.venv/
venv/
*.egg-info/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Media
*.mp4
*.mov
*.avi
uploads/
'@ | Add-Content -Path ".gitignore"
}

Write-Host ""
Write-Host "Done. Files created." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  git add -A"
Write-Host "  git commit -m `"Add Phase 1 scaffold: FastAPI backend, React+Vite+Tailwind frontend, Docker Compose`""
Write-Host "  git push origin diya"
Write-Host ""
Write-Host "Then test:" -ForegroundColor Yellow
Write-Host "  docker compose -f infra/docker/docker-compose.yml up"
Write-Host "  (in a new terminal) cd apps/web; npm install; npm run dev"
Write-Host "  Visit http://localhost:5173"
