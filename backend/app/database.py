from sqlmodel import SQLModel, Field, create_engine, Session
from typing import Optional
from datetime import datetime

DATABASE_URL = "sqlite:///./video_editor.db"
engine = create_engine(DATABASE_URL, echo=False)


class VideoRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    object_name: str = Field(index=True, unique=True)
    original_filename: str
    url: str
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    aspect_ratio: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Caption(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    object_name: str = Field(index=True)   # links back to VideoRecord
    start: float
    end: float
    text: str
    language: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReferenceVideo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: str = Field(index=True)   # groups reference videos together
    object_name: str
    original_filename: str
    url: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


def init_db():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
