"""
Reference Intelligence - Module 4: Color Palette & Visual Style Extractor
Extracts dominant color palette, brightness, saturation, and visual mood from reference reels.
"""

import cv2
import numpy as np
from pathlib import Path
from typing import List
from pydantic import BaseModel


class ColorAnalysisResult(BaseModel):
    reference_file: str
    dominant_colors: List[str]  # HEX Codes e.g. ["#3B5E2B", "#FFEB3B"]
    avg_brightness: float       # 0 - 255
    avg_saturation: float       # 0 - 255
    color_mood: str             # Vibrant Agricultural Green, Golden Warm, High Contrast, Muted Earth
    saturation_level: str       # High, Medium, Muted


def analyze_video_colors(
    video_file_path: str,
    k_colors: int = 4,
    sample_interval: int = 15
) -> ColorAnalysisResult:
    """
    Extracts dominant HEX color palette and color metrics using K-Means clustering.
    
    :param video_file_path: Path to reference video.
    :param k_colors: Number of dominant colors to extract.
    :param sample_interval: Sample frame interval.
    :return: ColorAnalysisResult object.
    """
    path = Path(video_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_file_path}")

    cap = cv2.VideoCapture(str(path.resolve()))
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_file_path}")

    sampled_pixels = []
    hsv_pixels = []
    frame_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1
        if frame_count % sample_interval != 0:
            continue

        # Downscale for fast color sampling
        small = cv2.resize(frame, (100, 100), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        sampled_pixels.append(rgb.reshape(-1, 3))
        hsv_pixels.append(hsv.reshape(-1, 3))

    cap.release()

    if not sampled_pixels:
        return ColorAnalysisResult(
            reference_file=path.name,
            dominant_colors=["#000000"],
            avg_brightness=0.0,
            avg_saturation=0.0,
            color_mood="Unknown",
            saturation_level="Muted"
        )

    all_rgb = np.vstack(sampled_pixels).astype(np.float32)
    all_hsv = np.vstack(hsv_pixels).astype(np.float32)

    avg_brightness = round(float(np.mean(all_hsv[:, 2])), 1)
    avg_saturation = round(float(np.mean(all_hsv[:, 1])), 1)

    # K-Means clustering for dominant colors
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, labels, centers = cv2.kmeans(all_rgb, k_colors, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)

    # Convert RGB centers to HEX
    centers = np.uint8(centers)
    hex_colors = [_rgb_to_hex(color) for color in centers]

    # Classify Saturation Level
    if avg_saturation > 140:
        sat_level = "High"
    elif avg_saturation > 70:
        sat_level = "Medium"
    else:
        sat_level = "Muted"

    # Classify Color Mood
    avg_hue = float(np.mean(all_hsv[:, 0]))
    if 30 <= avg_hue <= 85 and avg_saturation > 60:
        color_mood = "Vibrant Agricultural Green"
    elif (10 <= avg_hue < 30) or avg_brightness > 160:
        color_mood = "Golden Hour Warm"
    elif avg_saturation > 130 and avg_brightness > 130:
        color_mood = "High Contrast Modern"
    else:
        color_mood = "Natural Earth Tones"

    return ColorAnalysisResult(
        reference_file=path.name,
        dominant_colors=hex_colors,
        avg_brightness=avg_brightness,
        avg_saturation=avg_saturation,
        color_mood=color_mood,
        saturation_level=sat_level
    )


def _rgb_to_hex(rgb: np.ndarray) -> str:
    r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    return f"#{r:02X}{g:02X}{b:02X}"
