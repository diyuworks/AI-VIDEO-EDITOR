import os
import subprocess
import glob
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
OUTPUT_DIR = BACKEND_DIR / "demo_clips"
OUTPUT_DIR.mkdir(exist_ok=True)

def create_clip(input_image: str, output_mp4: str, effect_type: str = "zoom_in", duration: int = 4, fps: int = 30):
    """
    Converts a static image into a high-quality vertical (9:16 - 1080x1920) or landscape (16:9 - 1920x1080)
    motion video clip with Ken Burns effects (Zoom-in, Zoom-out, Pan-left, Pan-right).
    """
    total_frames = duration * fps
    
    # 9:16 Vertical Reel format (1080x1920) or 16:9 (1920x1080)
    # We will use 1080x1920 for vertical reels matching the reference video!
    target_w, target_h = 1080, 1920
    
    if effect_type == "zoom_in":
        vf_filter = (
            f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase,"
            f"crop={target_w*1.5}:{target_h*1.5},"
            f"zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={total_frames}:s={target_w}x{target_h}:fps={fps}"
        )
    elif effect_type == "zoom_out":
        vf_filter = (
            f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase,"
            f"crop={target_w*1.5}:{target_h*1.5},"
            f"zoompan=z='max(1.25-0.0015,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={total_frames}:s={target_w}x{target_h}:fps={fps}"
        )
    elif effect_type == "pan_left_to_right":
        vf_filter = (
            f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase,"
            f"crop={target_w*1.5}:{target_h*1.5},"
            f"zoompan=z='1.15':x='(on/{total_frames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d={total_frames}:s={target_w}x{target_h}:fps={fps}"
        )
    else:  # pan_right_to_left
        vf_filter = (
            f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase,"
            f"crop={target_w*1.5}:{target_h*1.5},"
            f"zoompan=z='1.15':x='(1-on/{total_frames})*(iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d={total_frames}:s={target_w}x{target_h}:fps={fps}"
        )

    cmd = [
        "ffmpeg", "-y", "-loop", "1",
        "-i", str(input_image),
        "-vf", vf_filter,
        "-c:v", "libx264",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        str(output_mp4)
    ]
    
    print(f"Generating clip ({effect_type}): {output_mp4} ...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error generating clip: {res.stderr}")
        return False
    print(f"Successfully generated: {output_mp4}")
    return True

def generate_4_demo_clips(image_paths):
    effects = ["zoom_in", "zoom_out", "pan_left_to_right", "pan_right_to_left"]
    generated_files = []
    
    for idx, effect in enumerate(effects):
        img = image_paths[idx % len(image_paths)]
        out_path = OUTPUT_DIR / f"demo_clip_{idx+1}.mp4"
        success = create_clip(img, out_path, effect_type=effect, duration=4)
        if success:
            generated_files.append(out_path)
            
    print(f"\n🎉 Finished generating {len(generated_files)} demo video clips in {OUTPUT_DIR}")
    return generated_files

if __name__ == "__main__":
    # Test with available backend images if any
    available = list(BACKEND_DIR.glob("*.jpg")) + list(BACKEND_DIR.glob("*.png"))
    if available:
        generate_4_demo_clips([str(p) for p in available[:4]])
