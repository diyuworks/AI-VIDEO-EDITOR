"""
Reference Intelligence Package
Contains standalone modules for extracting style intelligence from reference video reels.
"""

from .metadata_extractor import extract_reference_metadata, ReferenceMetadata
from .scene_detector import detect_scenes_and_keyframes, SceneDetectionResult, SceneInfo
from .motion_analyzer import analyze_video_motion, MotionAnalysisResult, Vector2D
from .color_analyzer import analyze_video_colors, ColorAnalysisResult
from .style_profile_generator import generate_style_profile, StyleProfile, StyleSignature

__all__ = [
    "extract_reference_metadata", 
    "ReferenceMetadata",
    "detect_scenes_and_keyframes",
    "SceneDetectionResult",
    "SceneInfo",
    "analyze_video_motion",
    "MotionAnalysisResult",
    "Vector2D",
    "analyze_video_colors",
    "ColorAnalysisResult",
    "generate_style_profile",
    "StyleProfile",
    "StyleSignature"
]
