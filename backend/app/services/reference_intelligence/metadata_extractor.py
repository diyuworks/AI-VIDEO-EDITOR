"""
Reference Intelligence - Module 1: Reference Metadata Extractor
Extracts deterministic technical metadata from reference video files using ffprobe.
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class ReferenceMetadata(BaseModel):
    file_name: str
    file_path: str
    file_size_bytes: int
    duration_seconds: float
    width: int
    height: int
    aspect_ratio: str
    fps: float
    video_codec: str
    bitrate_kbps: int
    has_audio: bool
    audio_codec: Optional[str] = None
    audio_sample_rate: Optional[int] = None


def extract_reference_metadata(video_file_path: str) -> ReferenceMetadata:
    """
    Extracts deterministic video and audio metadata from a video file using ffprobe.
    
    :param video_file_path: Absolute or relative path to the video file.
    :return: ReferenceMetadata object.
    """
    path = Path(video_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_file_path}")

    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path.resolve())
    ]

    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        probe_data = json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffprobe failed for {video_file_path}: {e.stderr}")
    except json.JSONDecodeError:
        raise ValueError(f"Failed to parse ffprobe output for {video_file_path}")

    streams = probe_data.get("streams", [])
    format_info = probe_data.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if not video_stream:
        raise ValueError(f"No video stream found in {video_file_path}")

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))

    # Calculate Aspect Ratio
    if width > 0 and height > 0:
        gcd_val = _gcd(width, height)
        aspect_ratio = f"{width // gcd_val}:{height // gcd_val}"
        if aspect_ratio not in ["9:16", "16:9", "1:1", "4:5"]:
            aspect_ratio = f"{round(width / height, 2)}:1"
    else:
        aspect_ratio = "unknown"

    # Calculate FPS
    r_frame_rate = video_stream.get("r_frame_rate", "30/1")
    if "/" in r_frame_rate:
        num, den = map(float, r_frame_rate.split("/"))
        fps = round(num / den, 2) if den > 0 else 30.0
    else:
        fps = float(r_frame_rate)

    duration = float(format_info.get("duration", 0.0))
    bitrate = int(format_info.get("bit_rate", 0)) // 1000  # in kbps

    has_audio = audio_stream is not None
    audio_codec = audio_stream.get("codec_name") if audio_stream else None
    audio_sample_rate = int(audio_stream.get("sample_rate", 0)) if audio_stream and audio_stream.get("sample_rate") else None

    return ReferenceMetadata(
        file_name=path.name,
        file_path=str(path.resolve()),
        file_size_bytes=path.stat().st_size,
        duration_seconds=round(duration, 2),
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
        fps=fps,
        video_codec=video_stream.get("codec_name", "unknown"),
        bitrate_kbps=bitrate,
        has_audio=has_audio,
        audio_codec=audio_codec,
        audio_sample_rate=audio_sample_rate
    )


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a
