"""
Reference Intelligence - Module 5: Unified Style Profile Generator
Combines Metadata, Scene Detection, Motion Analysis, and Color Analysis into a single master StyleProfile.
"""

from pathlib import Path
from pydantic import BaseModel

from .metadata_extractor import extract_reference_metadata, ReferenceMetadata
from .scene_detector import detect_scenes_and_keyframes, SceneDetectionResult
from .motion_analyzer import analyze_video_motion, MotionAnalysisResult
from .color_analyzer import analyze_video_colors, ColorAnalysisResult


class StyleSignature(BaseModel):
    editing_pace: str         # Fast Cuts, Moderate Pace, Slow Cinematic
    motion_style: str         # Zoom-In, Zoom-Out, Pan Right, Pan Left, Static
    primary_color_hex: str    # Main dominant HEX color
    color_mood: str           # Vibrant Agricultural Green, Golden Hour Warm, etc.
    target_aspect_ratio: str  # 9:16, 16:9, etc.
    total_scenes: int
    avg_scene_duration_sec: float


class StyleProfile(BaseModel):
    reference_file: str
    style_signature: StyleSignature
    metadata: ReferenceMetadata
    scene_analysis: SceneDetectionResult
    motion_analysis: MotionAnalysisResult
    color_analysis: ColorAnalysisResult


def generate_style_profile(video_file_path: str) -> StyleProfile:
    """
    Runs all Reference Intelligence extractors and merges them into a unified StyleProfile.
    
    :param video_file_path: Path to the reference video file.
    :return: StyleProfile Pydantic object.
    """
    path = Path(video_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Reference video file not found: {video_file_path}")

    # Step 1: Extract Metadata
    metadata = extract_reference_metadata(str(path.resolve()))

    # Step 2: Detect Scenes & Keyframes
    scene_analysis = detect_scenes_and_keyframes(str(path.resolve()))

    # Step 3: Analyze Camera Motion & Speed
    motion_analysis = analyze_video_motion(str(path.resolve()))

    # Step 4: Extract Color Palette & Mood
    color_analysis = analyze_video_colors(str(path.resolve()))

    # Calculate High-Level Editing Pace
    avg_duration = scene_analysis.avg_scene_duration_sec
    if avg_duration > 0 and avg_duration <= 2.5:
        editing_pace = "Fast Cuts"
    elif avg_duration <= 4.5:
        editing_pace = "Moderate Pace"
    else:
        editing_pace = "Slow Cinematic"

    primary_color = color_analysis.dominant_colors[0] if color_analysis.dominant_colors else "#000000"

    style_signature = StyleSignature(
        editing_pace=editing_pace,
        motion_style=motion_analysis.motion_type,
        primary_color_hex=primary_color,
        color_mood=color_analysis.color_mood,
        target_aspect_ratio=metadata.aspect_ratio,
        total_scenes=scene_analysis.total_scenes,
        avg_scene_duration_sec=scene_analysis.avg_scene_duration_sec
    )

    return StyleProfile(
        reference_file=path.name,
        style_signature=style_signature,
        metadata=metadata,
        scene_analysis=scene_analysis,
        motion_analysis=motion_analysis,
        color_analysis=color_analysis
    )
