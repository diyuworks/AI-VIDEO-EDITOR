"""
Render a pre-baked video with the precise polygon overlay drawn on every frame.
Uses the polygon tracking data from /segment-plot-precise and draws it onto
the raw drone footage, producing a new video file with the overlay baked in.
"""
import json
import cv2
import numpy as np
import os
import tempfile
from app.routers.uploads import minio_client
from app.config import MINIO_BUCKET

# --- Config ---
VIDEO_OBJECT = "eaecf762c1104868b89847d970b484a9.mp4"  # 45s raw clip (848x478, 60fps)
POLYGON_JSON = "test_precise_response.json"
OUTPUT_FILE = "rendered_segmented_video.mp4"
START_TIME = 5.0   # Polygon tracking starts here
END_TIME = 20.0    # Polygon tracking ends here

# Overlay colors (BGR for OpenCV)
FILL_COLOR = (0, 255, 255)    # Yellow fill (like the reference image)
BORDER_COLOR = (0, 0, 255)    # Red border
FILL_ALPHA = 0.35
BORDER_THICKNESS = 3
LABEL_TEXT = "Vadnagar"

# --- Load polygon data ---
with open(POLYGON_JSON, "r") as f:
    data = json.load(f)

frame_w = data["frame_width"]
frame_h = data["frame_height"]
polygon_path = data["path"]

print(f"Video resolution: {frame_w}x{frame_h}")
print(f"Polygon frames: {len(polygon_path)}")
print(f"Points per polygon: {len(polygon_path[0]['points_pct'])}")

# --- Interpolation function ---
def interpolate_polygon(t):
    """Get interpolated polygon points (in pixels) at time t."""
    path = polygon_path
    
    if t <= path[0]["time"]:
        pts_pct = path[0]["points_pct"]
    elif t >= path[-1]["time"]:
        pts_pct = path[-1]["points_pct"]
    else:
        pts_pct = None
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            if a["time"] <= t <= b["time"]:
                ratio = (t - a["time"]) / (b["time"] - a["time"]) if b["time"] != a["time"] else 0
                pts_pct = [
                    [
                        a["points_pct"][j][0] + (b["points_pct"][j][0] - a["points_pct"][j][0]) * ratio,
                        a["points_pct"][j][1] + (b["points_pct"][j][1] - a["points_pct"][j][1]) * ratio,
                    ]
                    for j in range(len(a["points_pct"]))
                ]
                break
        if pts_pct is None:
            pts_pct = path[-1]["points_pct"]
    
    # Convert percentage to pixel coordinates
    points_px = np.array([
        [int(x * frame_w / 100), int(y * frame_h / 100)]
        for x, y in pts_pct
    ], dtype=np.int32)
    
    return points_px

# --- Download video ---
print(f"\nDownloading video from MinIO: {VIDEO_OBJECT}")
tmp_path = os.path.join(tempfile.gettempdir(), f"render_{VIDEO_OBJECT}")
minio_client.fget_object(MINIO_BUCKET, VIDEO_OBJECT, tmp_path)

cap = cv2.VideoCapture(tmp_path)
fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

print(f"Video: {w}x{h}, {fps:.0f}fps, {total_frames} frames, {total_frames/fps:.1f}s")

# --- Setup output video ---
# Only render from START_TIME to END_TIME
start_frame = int(START_TIME * fps)
end_frame = int(END_TIME * fps)
render_frames = end_frame - start_frame

fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(OUTPUT_FILE, fourcc, fps, (w, h))

print(f"\nRendering frames {start_frame} to {end_frame} ({render_frames} frames, {render_frames/fps:.1f}s)")
print(f"Output: {OUTPUT_FILE}")
print()

# Seek to start frame
cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

rendered = 0
for frame_idx in range(start_frame, end_frame):
    ok, frame = cap.read()
    if not ok:
        print(f"  Failed to read frame {frame_idx}")
        break
    
    t = frame_idx / fps
    
    # Get interpolated polygon for this exact frame time
    polygon_pts = interpolate_polygon(t)
    
    # Draw semi-transparent fill
    overlay = frame.copy()
    cv2.fillPoly(overlay, [polygon_pts], FILL_COLOR)
    frame_drawn = cv2.addWeighted(overlay, FILL_ALPHA, frame, 1 - FILL_ALPHA, 0)
    
    # Draw border
    cv2.polylines(frame_drawn, [polygon_pts], isClosed=True, color=BORDER_COLOR, thickness=BORDER_THICKNESS)
    
    # Draw label at the top of the polygon
    min_y_idx = np.argmin(polygon_pts[:, 1])
    label_x = polygon_pts[min_y_idx][0]
    label_y = polygon_pts[min_y_idx][1] - 15
    
    # Label background
    (text_w, text_h), _ = cv2.getTextSize(LABEL_TEXT, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    cv2.rectangle(frame_drawn, 
                  (label_x - 5, label_y - text_h - 8),
                  (label_x + text_w + 5, label_y + 5),
                  FILL_COLOR, -1)
    cv2.putText(frame_drawn, LABEL_TEXT, (label_x, label_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    
    out.write(frame_drawn)
    rendered += 1
    
    # Progress every 2 seconds of video
    if rendered % int(fps * 2) == 0:
        progress = rendered / render_frames * 100
        print(f"  Progress: {progress:.0f}% ({rendered}/{render_frames} frames, t={t:.1f}s)")

cap.release()
out.release()

# Cleanup
try:
    os.unlink(tmp_path)
except:
    pass

file_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
print(f"\n✅ Done! Rendered {rendered} frames")
print(f"Output: {OUTPUT_FILE} ({file_size:.1f} MB)")
print(f"Duration: {rendered/fps:.1f}s at {fps:.0f}fps")
