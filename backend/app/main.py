from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import uploads, metadata, captions, reference, editing_plan
from app.database import init_db

app = FastAPI(title="AI Video Editor API", version="0.1.0")

# Allow the frontend dev server to call this API during local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(uploads.router)
app.include_router(metadata.router)
app.include_router(captions.router)
app.include_router(reference.router)
app.include_router(editing_plan.router)

@app.get("/test_source")
def test_source():
    import inspect
    from app.routers import editing_plan
    return {"file": editing_plan.__file__, "source": inspect.getsource(editing_plan.generate_editing_plan)}

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
