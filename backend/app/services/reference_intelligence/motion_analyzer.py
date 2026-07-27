"""
Reference Intelligence - Module 3: Motion & Camera Speed Analyzer
Calculates optical flow vectors, camera pacing, and motion type (Zoom/Pan/Static).
"""

import cv2
import numpy as np
from pathlib import Path
from pydantic import BaseModel


class Vector2D(BaseModel):
    x: float
    y: float


class MotionAnalysisResult(BaseModel):
    reference_file: str
    motion_type: str  # Zoom-In, Zoom-Out, Pan Right, Pan Left, Tilt Up, Tilt Down, Static
    avg_motion_speed: float  # pixels per frame
    camera_pacing: str  # Fast, Moderate, Slow, Static
    pan_vector: Vector2D
    zoom_ratio: float


def analyze_video_motion(
    video_file_path: str,
    sample_interval: int = 5
) -> MotionAnalysisResult:
    """
    Analyzes camera motion vectors and speed using OpenCV Farneback Optical Flow.
    
    :param video_file_path: Path to reference video.
    :param sample_interval: Process every N-th frame for high performance.
    :return: MotionAnalysisResult object.
    """
    path = Path(video_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_file_path}")

    cap = cv2.VideoCapture(str(path.resolve()))
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_file_path}")

    prev_gray = None
    dx_list = []
    dy_list = []
    zoom_list = []
    magnitudes = []

    frame_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1
        if frame_count % sample_interval != 0:
            continue

        # Downscale for fast flow computation
        small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        if prev_gray is not None:
            # Dense Optical Flow
            flow = cv2.calcOpticalFlowFarneback(
                prev_gray, gray, None,
                pyr_scale=0.5, levels=3, winsize=15,
                iterations=3, poly_n=5, poly_sigma=1.2, flags=0
            )

            fx, fy = flow[..., 0], flow[..., 1]
            mag, _ = cv2.cartToPolar(fx, fy)

            mean_dx = float(np.mean(fx))
            mean_dy = float(np.mean(fy))
            mean_mag = float(np.mean(mag))

            # Radial divergence for zoom estimation
            h, w = gray.shape
            grid_x, grid_y = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
            radial_flow = fx * grid_x + fy * grid_y
            mean_zoom = float(np.mean(radial_flow))

            dx_list.append(mean_dx)
            dy_list.append(mean_dy)
            magnitudes.append(mean_mag)
            zoom_list.append(mean_zoom)

        prev_gray = gray

    cap.release()

    if not magnitudes:
        return MotionAnalysisResult(
            reference_file=path.name,
            motion_type="Static",
            avg_motion_speed=0.0,
            camera_pacing="Static",
            pan_vector=Vector2D(x=0.0, y=0.0),
            zoom_ratio=1.0
        )

    avg_dx = round(float(np.mean(dx_list)), 3)
    avg_dy = round(float(np.mean(dy_list)), 3)
    avg_speed = round(float(np.mean(magnitudes)), 2)
    avg_zoom = round(float(np.mean(zoom_list)), 3)

    # Classify Pacing
    if avg_speed < 0.3:
        pacing = "Static"
    elif avg_speed < 1.2:
        pacing = "Slow"
    elif avg_speed < 2.5:
        pacing = "Moderate"
    else:
        pacing = "Fast"

    # Classify Motion Type
    if abs(avg_zoom) > 0.15 and abs(avg_zoom) > max(abs(avg_dx), abs(avg_dy)):
        motion_type = "Zoom-In" if avg_zoom > 0 else "Zoom-Out"
    elif abs(avg_dx) > abs(avg_dy) and abs(avg_dx) > 0.1:
        motion_type = "Pan Right" if avg_dx > 0 else "Pan Left"
    elif abs(avg_dy) > 0.1:
        motion_type = "Tilt Down" if avg_dy > 0 else "Tilt Up"
    else:
        motion_type = "Static"

    zoom_ratio = round(1.0 + (avg_zoom * 0.1), 2)

    return MotionAnalysisResult(
        reference_file=path.name,
        motion_type=motion_type,
        avg_motion_speed=avg_speed,
        camera_pacing=pacing,
        pan_vector=Vector2D(x=avg_dx, y=avg_dy),
        zoom_ratio=zoom_ratio
    )
