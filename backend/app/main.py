from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import uploads, metadata, captions
from app.database import init_db

app = FastAPI(title="AI Video Editor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(uploads.router)
app.include_router(metadata.router)
app.include_router(captions.router)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/")
def root():
    return {"status": "AI Video Editor backend is running"}


@app.get("/health")
def health():
    return {"status": "ok"}
