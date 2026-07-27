import os
import uuid

import tempfile
import json
import cv2
import numpy as np
import base64
from typing import List, Optional, Tuple
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import MINIO_BUCKET
from app.routers.uploads import minio_client

router = APIRouter()

EXPORT_DIR = "export_output"
os.makedirs(EXPORT_DIR, exist_ok=True)

class ClipSchema(BaseModel):
    id: str
    track: str
    start: float
    end: float
    label: str
    text: Optional[str] = None
    overlayKind: Optional[str] = None
    boxLeftPct: Optional[float] = None
    boxTopPct: Optional[float] = None
    boxWidthPct: Optional[float] = None
    boxHeightPct: Optional[float] = None
    imageDataUrl: Optional[str] = None
    boxPath: Optional[List[dict]] = None
    polygonPath: Optional[List[dict]] = None

class ExportRequest(BaseModel):
    object_name: str
    clips: List[ClipSchema]

def interpolate_polygon(path: List[dict], t: float, frame_w: int, frame_h: int) -> np.ndarray:
    def get_pts(p):
        return p.get("pointsPct") or p.get("points_pct")

    if t <= path[0]["time"]:
        pts_pct = get_pts(path[0])
    elif t >= path[-1]["time"]:
        pts_pct = get_pts(path[-1])
    else:
        pts_pct = None
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            if a["time"] <= t <= b["time"]:
                ratio = (t - a["time"]) / (b["time"] - a["time"]) if b["time"] != a["time"] else 0
                a_pts = get_pts(a)
                b_pts = get_pts(b)
                pts_pct = [
                    [
                        a_pts[j][0] + (b_pts[j][0] - a_pts[j][0]) * ratio,
                        a_pts[j][1] + (b_pts[j][1] - a_pts[j][1]) * ratio,
                    ]
                    for j in range(len(a_pts))
                ]
                break
        if pts_pct is None:
            pts_pct = get_pts(path[-1])
    
    return np.array([
        [int(x * frame_w / 100), int(y * frame_h / 100)]
        for x, y in pts_pct
    ], dtype=np.int32)

def interpolate_box(path: List[dict], t: float) -> dict:
    def get_val(p, key_camel, key_snake):
        # Support both casing formats
        val = p.get(key_camel)
        if val is None:
            val = p.get(key_snake)
        return float(val) if val is not None else 0.0

    if t <= path[0]["time"]:
        a = path[0]
    elif t >= path[-1]["time"]:
        a = path[-1]
    else:
        a = None
        for i in range(len(path) - 1):
            p1 = path[i]
            p2 = path[i + 1]
            if p1["time"] <= t <= p2["time"]:
                ratio = (t - p1["time"]) / (p2["time"] - p1["time"]) if p2["time"] != p1["time"] else 0
                return {
                    "x_pct": get_val(p1, "xPct", "x_pct") + (get_val(p2, "xPct", "x_pct") - get_val(p1, "xPct", "x_pct")) * ratio,
                    "y_pct": get_val(p1, "yPct", "y_pct") + (get_val(p2, "yPct", "y_pct") - get_val(p1, "yPct", "y_pct")) * ratio,
                    "width_pct": get_val(p1, "widthPct", "width_pct") + (get_val(p2, "widthPct", "width_pct") - get_val(p1, "widthPct", "width_pct")) * ratio,
                    "height_pct": get_val(p1, "heightPct", "height_pct") + (get_val(p2, "heightPct", "height_pct") - get_val(p1, "heightPct", "height_pct")) * ratio,
                }
        if a is None:
            a = path[-1]

    return {
        "x_pct": get_val(a, "xPct", "x_pct"),
        "y_pct": get_val(a, "yPct", "y_pct"),
        "width_pct": get_val(a, "widthPct", "width_pct"),
        "height_pct": get_val(a, "heightPct", "height_pct"),
    }

def draw_text_with_stroke(img: np.ndarray, text: str, org: Tuple[int, int], font_face: int, font_scale: float, color: Tuple[int, int, int], thickness: int, stroke_thickness: int):
    # Draw outline (black)
    cv2.putText(img, text, org, font_face, font_scale, (0, 0, 0), stroke_thickness, cv2.LINE_AA)
    # Draw inner text
    cv2.putText(img, text, org, font_face, font_scale, color, thickness, cv2.LINE_AA)

@router.post("/export-video")
async def export_video(req: ExportRequest):
    if not req.object_name:
        raise HTTPException(status_code=400, detail="Missing object_name")

    # Download raw video to temp path
    tmp_input_path = os.path.join(tempfile.gettempdir(), f"export_in_{uuid.uuid4().hex}.mp4")
    try:
        minio_client.fget_object(MINIO_BUCKET, req.object_name, tmp_input_path)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Source video not found in MinIO: {str(e)}")

    output_filename = f"export_{uuid.uuid4().hex}.mp4"
    output_filepath = os.path.join(EXPORT_DIR, output_filename)

    cap = cv2.VideoCapture(tmp_input_path)
    if not cap.isOpened():
        raise HTTPException(status_code=500, detail="Failed to open video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if fps <= 0 or frame_w <= 0 or frame_h <= 0:
        cap.release()
        raise HTTPException(status_code=500, detail="Invalid video metadata")

    # Determine timeline duration
    # By default, use the maximum end time of any video clip, or falls back to video length
    video_clips = [c for c in req.clips if c.track == "video"]
    if video_clips:
        timeline_duration = max(c.end for c in video_clips)
    else:
        timeline_duration = total_frames / fps

    total_render_frames = int(timeline_duration * fps)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_filepath, fourcc, fps, (frame_w, frame_h))

    try:
        for f_idx in range(total_render_frames):
            t = f_idx / fps
            
            # Map timeline time `t` to source frame
            # For simplicity, we assume a direct 1-to-1 mapping with the raw video frames
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(f_idx, total_frames - 1))
            ok, frame = cap.read()
            if not ok:
                break

            # Find active overlays at time `t`
            overlays = [c for c in req.clips if c.track == "overlay" and c.start <= t < c.end]

            for overlay in overlays:
                if overlay.overlayKind == "autoBoundaryPrecise" and overlay.polygonPath:
                    poly_pts = interpolate_polygon(overlay.polygonPath, t, frame_w, frame_h)
                    
                    # Yellow semi-transparent fill
                    overlay_layer = frame.copy()
                    cv2.fillPoly(overlay_layer, [poly_pts], (0, 255, 255))
                    frame = cv2.addWeighted(overlay_layer, 0.35, frame, 0.65, 0)
                    
                    # Red border
                    cv2.polylines(frame, [poly_pts], isClosed=True, color=(0, 0, 255), thickness=3)

                    # Label above the polygon
                    min_y_idx = np.argmin(poly_pts[:, 1])
                    label_x = poly_pts[min_y_idx][0]
                    label_y = poly_pts[min_y_idx][1] - 15
                    
                    label_text = overlay.label or "Plot"
                    (text_w, text_h), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                    cv2.rectangle(frame, 
                                  (label_x - 5, label_y - text_h - 8),
                                  (label_x + text_w + 5, label_y + 5),
                                  (0, 255, 255), -1)
                    cv2.putText(frame, label_text, (label_x, label_y),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                elif overlay.overlayKind == "caption" and overlay.text:
                    # Draw caption text centered at the bottom
                    font_scale = 0.8
                    font_thickness = 2
                    stroke_thickness = 5
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    
                    (text_w, text_h), _ = cv2.getTextSize(overlay.text, font, font_scale, font_thickness)
                    text_x = int((frame_w - text_w) / 2)
                    text_y = int(frame_h - 40)
                    
                    draw_text_with_stroke(frame, overlay.text, (text_x, text_y), font, font_scale, (255, 255, 255), font_thickness, stroke_thickness)

                elif overlay.overlayKind == "boundary":
                    # Static bounding box
                    left = int((overlay.boxLeftPct or 25) * frame_w / 100)
                    top = int((overlay.boxTopPct or 25) * frame_h / 100)
                    width = int((overlay.boxWidthPct or 40) * frame_w / 100)
                    height = int((overlay.boxHeightPct or 30) * frame_h / 100)

                    cv2.rectangle(frame, (left, top), (left + width, top + height), (0, 255, 255), 3)
                    
                    label_text = overlay.label or "Plot"
                    cv2.putText(frame, label_text, (left + 5, top + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                elif overlay.overlayKind == "logo" and overlay.imageDataUrl:
                    # Logo watermarking
                    try:
                        # Decode base64 image
                        head, data_b64 = overlay.imageDataUrl.split(',', 1)
                        logo_data = base64.b64decode(data_b64)
                        logo_np = np.frombuffer(logo_data, dtype=np.uint8)
                        logo_img = cv2.imdecode(logo_np, cv2.IMREAD_UNCHANGED)
                        
                        if logo_img is not None:
                            logo_w = int((overlay.boxWidthPct or 20) * frame_w / 100)
                            logo_h = int((overlay.boxHeightPct or 15) * frame_h / 100)
                            logo_resized = cv2.resize(logo_img, (logo_w, logo_h))
                            
                            left = int((overlay.boxLeftPct or 70) * frame_w / 100)
                            top = int((overlay.boxTopPct or 5) * frame_h / 100)
                            
                            # Boundary checking
                            left = max(0, min(left, frame_w - logo_w))
                            top = max(0, min(top, frame_h - logo_h))
                            
                            # Overlay handling alpha channel
                            if logo_resized.shape[2] == 4:
                                alpha = logo_resized[:, :, 3] / 255.0
                                for c in range(3):
                                    frame[top:top+logo_h, left:left+logo_w, c] = (
                                        alpha * logo_resized[:, :, c] + (1 - alpha) * frame[top:top+logo_h, left:left+logo_w, c]
                                    )
                            else:
                                frame[top:top+logo_h, left:left+logo_w] = logo_resized[:, :, :3]
                    except Exception as logo_err:
                        print(f"Failed to overlay logo: {logo_err}")

            out.write(frame)

    finally:
        cap.release()
        out.release()
        try:
            os.unlink(tmp_input_path)
        except:
            pass

    return {
        "success": True,
        "filename": output_filename,
        "download_url": f"http://localhost:8000/export-file/{output_filename}"
    }

@router.get("/export-file/{filename}")
async def get_export_file(filename: str):
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Exported video file not found")
    return FileResponse(filepath, media_type="video/mp4")
