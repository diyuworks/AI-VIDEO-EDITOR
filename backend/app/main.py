from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routers import uploads, analyze, metadata, captions, reference, editing_plan, voiceover, segment_plot, segment_plot_precise, tts, export, frame_extraction, tracking, overlay, pipeline, reference_intelligence, progress
from app.database import init_db

app = FastAPI(title="AI Video Editor API", version="0.1.0")

# Allow the frontend dev server to call this API during local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:4005",
        "https://reel-backend.jamin24.com",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(uploads.router)
app.include_router(analyze.router)
app.include_router(metadata.router)
app.include_router(captions.router)
app.include_router(reference.router)
app.include_router(editing_plan.router)
app.include_router(voiceover.router)
app.include_router(segment_plot.router)
app.include_router(segment_plot_precise.router)
app.include_router(tts.router)
app.include_router(export.router)
app.include_router(frame_extraction.router)
app.include_router(tracking.router)
app.include_router(overlay.router)
app.include_router(pipeline.router)
app.include_router(reference_intelligence.router)
app.include_router(progress.router)

# Serve backend/assets as static files (for end_screen.PNG etc.)
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Serve backend/demo_clips as static files so user can download clean raw footage clips
app.mount("/demo-videos", StaticFiles(directory="demo_clips"), name="demo-videos")

@app.on_event("startup")
def on_startup():
    init_db()
    uploads.init_minio()

@app.get("/health")
def health_check():
    """Basic liveness check. Used to confirm the API is reachable
    from the frontend and from Docker Compose."""
    return {"status": "ok", "service": "ai-video-editor-api"}

@app.get("/")
def root():
    return {"message": "AI Video Editor API is running"}
