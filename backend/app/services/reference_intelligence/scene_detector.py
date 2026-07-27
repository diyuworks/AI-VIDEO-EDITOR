"""
Reference Intelligence - Module 2: Scene Detection & Keyframe Extractor
Detects scene transitions in reference reels and extracts median keyframe images.
"""

import os
import cv2
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel


class SceneInfo(BaseModel):
    scene_index: int
    start_frame: int
    end_frame: int
    start_time_sec: float
    end_time_sec: float
    duration_sec: float
    keyframe_path: str


class SceneDetectionResult(BaseModel):
    reference_file: str
    total_scenes: int
    avg_scene_duration_sec: float
    scenes: List[SceneInfo]


def detect_scenes_and_keyframes(
    video_file_path: str,
    output_dir: Optional[str] = None,
    threshold: float = 30.0,
    min_scene_len_sec: float = 0.8
) -> SceneDetectionResult:
    """
    Detects scene cuts using OpenCV color/histogram difference and extracts keyframes.
    
    :param video_file_path: Path to reference video.
    :param output_dir: Directory to store keyframe images. Defaults to backend/keyframes.
    :param threshold: Cut sensitivity threshold (lower = more sensitive to cuts).
    :param min_scene_len_sec: Minimum scene duration in seconds to avoid micro-cuts.
    :return: SceneDetectionResult object.
    """
    path = Path(video_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_file_path}")

    if not output_dir:
        output_dir = str(path.parent.parent / "keyframes")
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(str(path.resolve()))
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_file_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    min_scene_frames = int(fps * min_scene_len_sec)

    scene_cuts = [0]
    prev_hist = None
    frame_idx = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Downscale frame for fast histogram calculation
        small_frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_NEAREST)
        hsv = cv2.cvtColor(small_frame, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)

        if prev_hist is not None:
            # Chi-Square / Correlation distance
            diff = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CHISQR)
            if diff > threshold and (frame_idx - scene_cuts[-1]) >= min_scene_frames:
                scene_cuts.append(frame_idx)

        prev_hist = hist
        frame_idx += 1

    if scene_cuts[-1] != total_frames and total_frames > 0:
        scene_cuts.append(total_frames)

    cap.release()

    # Extract scenes and keyframes
    scenes: List[SceneInfo] = []
    base_name = path.stem

    for idx in range(len(scene_cuts) - 1):
        start_f = scene_cuts[idx]
        end_f = scene_cuts[idx + 1]
        start_sec = round(start_f / fps, 2)
        end_sec = round(end_f / fps, 2)
        duration_sec = round(end_sec - start_sec, 2)

        # Median frame for keyframe extraction
        mid_f = (start_f + end_f) // 2

        # Extract frame using VideoCapture
        cap_temp = cv2.VideoCapture(str(path.resolve()))
        cap_temp.set(cv2.CAP_PROP_POS_FRAMES, mid_f)
        ret_k, key_frame = cap_temp.read()
        cap_temp.release()

        keyframe_path = os.path.join(output_dir, f"{base_name}_scene_{idx + 1}.png")
        if ret_k and key_frame is not None:
            cv2.imwrite(keyframe_path, key_frame)
        else:
            keyframe_path = "failed_to_extract"

        scenes.append(
            SceneInfo(
                scene_index=idx + 1,
                start_frame=start_f,
                end_frame=end_f,
                start_time_sec=start_sec,
                end_time_sec=end_sec,
                duration_sec=duration_sec,
                keyframe_path=str(Path(keyframe_path).resolve())
            )
        )

    avg_duration = round(sum(s.duration_sec for s in scenes) / len(scenes), 2) if scenes else 0.0

    return SceneDetectionResult(
        reference_file=path.name,
        total_scenes=len(scenes),
        avg_scene_duration_sec=avg_duration,
        scenes=scenes
    )
