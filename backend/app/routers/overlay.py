import cv2
import numpy as np
import tempfile
import os
import subprocess
from datetime import timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class RegionOverlayRequest(BaseModel):
    polygon_per_frame: Optional[List[List[List[float]]]] = None
    highlight_color: str = "#FFEB3B"
    border_thickness: int = 8
    label: Optional[str] = None
    enable_farmhouse_overlay: bool = False
    enable_fountain_overlay: bool = False
    enable_petrol_pump_overlay: bool = False
    text_position: str = "middle"
    price: Optional[str] = None
    size: Optional[str] = None
    road_info: Optional[str] = None

class OverlayRequest(BaseModel):
    object_name: str
    regions: Optional[List[RegionOverlayRequest]] = None
    # Keep old fields for fallback/single-highlight usage
    polygon_per_frame: Optional[List[List[List[float]]]] = None
    highlight_color: str = "#FFEB3B"
    border_thickness: int = 8
    label: Optional[str] = None
    enable_farmhouse_overlay: bool = False
    enable_fountain_overlay: bool = False
    enable_petrol_pump_overlay: bool = False
    text_position: str = "middle"
    price: Optional[str] = None
    size: Optional[str] = None
    road_info: Optional[str] = None


def hex_to_bgr(hex_color: str):
    """#FFEB3B -> (BGR tuple for OpenCV)"""
    hex_color = hex_color.lstrip("#")
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    return (b, g, r)  # OpenCV BGR order use karta hai


@router.post("/render-overlay")
def render_overlay(request: OverlayRequest):
    import traceback
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT
    from typing import Optional
    from PIL import Image, ImageDraw, ImageFont

    font_size = 60
    try:
        pil_font = ImageFont.truetype(r"C:\Windows\Fonts\ariblk.ttf", font_size)
    except:
        pil_font = ImageFont.load_default()


    base_assets_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "backend", "assets")
    if not os.path.exists(base_assets_dir):
        base_assets_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets")
    if not os.path.exists(base_assets_dir):
        base_assets_dir = "assets"

    def load_asset_img(filename):
        p = os.path.join(base_assets_dir, filename)
        if not os.path.exists(p):
            p = os.path.join("assets", filename)
        if not os.path.exists(p):
            p = os.path.join("backend", "assets", filename)
        img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if img is None:
            return None

        if len(img.shape) == 3 and img.shape[2] == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, alpha = cv2.threshold(gray, 230, 255, cv2.THRESH_BINARY_INV)
            b, g, r = cv2.split(img)
            img = cv2.merge([b, g, r, alpha])
        elif len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            if alpha.min() == 255:
                gray = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
                _, new_alpha = cv2.threshold(gray, 230, 255, cv2.THRESH_BINARY_INV)
                img[:, :, 3] = new_alpha

        if len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            coords = cv2.findNonZero(alpha)
            if coords is not None:
                x, y, w, h = cv2.boundingRect(coords)
                pad_w = int(w * 0.05)
                pad_h = int(h * 0.05)
                x1 = max(0, x - pad_w)
                y1 = max(0, y - pad_h)
                x2 = min(img.shape[1], x + w + pad_w)
                y2 = min(img.shape[0], y + h + pad_h)
                img = img[y1:y2, x1:x2]

        return img

    farmhouse_img = load_asset_img("farmhouse_render.png")
    if farmhouse_img is None:
        farmhouse_img = load_asset_img("farmhouse.png")
    fountain_img = load_asset_img("fountain.png")
    petrol_pump_img = load_asset_img("petrol_pump.png")

    location_card_img = cv2.imread(os.path.join(base_assets_dir, "location_card_custom.jpg"))
    if location_card_img is None:
        location_card_img = cv2.imread(os.path.join("assets", "location_card_custom.jpg"))
    if location_card_img is None:
        location_card_img = cv2.imread(os.path.join("backend", "assets", "location_card_custom.jpg"))



    # Step A: Video ko local temp file me download karo
    # (presigned URLs ke saath cv2.VideoCapture Windows pe fail hota hai)
    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "source_video.mp4")
    upload_p = os.path.join("uploaded_files", request.object_name)
    demo_p = os.path.join("demo_clips", request.object_name)
    raw_p = request.object_name
    if os.path.exists(upload_p) and os.path.getsize(upload_p) > 0:
        import shutil
        shutil.copy(upload_p, source_local_path)
    elif os.path.exists(demo_p) and os.path.getsize(demo_p) > 0:
        import shutil
        shutil.copy(demo_p, source_local_path)
    elif os.path.exists(raw_p) and os.path.getsize(raw_p) > 0:
        import shutil
        shutil.copy(raw_p, source_local_path)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
        except Exception as e:
            print(f"[overlay] MinIO download warning for {request.object_name}: {e}")

    from app.config import get_backend_base_url
    base_url = get_backend_base_url()

    if not os.path.exists(source_local_path) or os.path.getsize(source_local_path) == 0:
        print(f"[overlay warning] Video file missing for {request.object_name}, returning direct object_name.")
        return {
            "success": True,
            "output_object_name": request.object_name,
            "url": f"{base_url}/demo-videos/{request.object_name}",
        }

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        print(f"[overlay] cv2.VideoCapture failed to open: {source_local_path}")
        return {
            "success": True,
            "output_object_name": request.object_name,
            "url": f"{base_url}/demo-videos/{request.object_name}",
        }

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0 or np.isnan(fps):
        fps = 25.0
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Normalize resolution to max 720x1280 for fast processing and optimal reel quality
    MAX_W, MAX_H = 720, 1280
    scale_factor = min(MAX_W / float(orig_w), MAX_H / float(orig_h), 1.0)
    width = int(orig_w * scale_factor)
    height = int(orig_h * scale_factor)
    # Ensure width and height are strictly even numbers for video codecs
    width = width if width % 2 == 0 else width - 1
    height = height if height % 2 == 0 else height - 1

    # Step B: Temporary output file banao (bina audio ke, sirf video)
    temp_video_path = os.path.join(temp_dir, "overlay_temp.mp4")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))

    # Build list of regions to process
    all_regions = []
    if request.regions:
        all_regions = request.regions
    elif request.polygon_per_frame:
        # Fallback for old single-highlight format
        all_regions.append(RegionOverlayRequest(
            polygon_per_frame=request.polygon_per_frame,
            highlight_color=request.highlight_color,
            border_thickness=request.border_thickness,
            label=request.label,
            enable_farmhouse_overlay=request.enable_farmhouse_overlay,
            enable_fountain_overlay=request.enable_fountain_overlay,
            enable_petrol_pump_overlay=request.enable_petrol_pump_overlay,
            text_position=request.text_position,
            price=request.price,
            size=request.size,
            road_info=request.road_info
        ))

    # Load 3D assets directory
    assets_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets")

    pil_font = None
    from PIL import Image, ImageDraw, ImageFont
    font_size = max(42, int(width / 13))
    for font_path in [r'C:\Windows\Fonts\ariblk.ttf', r'C:\Windows\Fonts\impact.ttf', r'C:\Windows\Fonts\segoeuib.ttf', r'C:\Windows\Fonts\arialbd.ttf']:
        if os.path.exists(font_path):
            try:
                pil_font = ImageFont.truetype(font_path, font_size)
                break
            except Exception:
                pass
    if pil_font is None:
        pil_font = ImageFont.load_default()

    frame_idx = 0
    if len(all_regions) > 0:
        # Animation timings
        ANIM_FRAMES = int(fps * 0.4) 
        FADE_FRAMES = int(fps * 0.25)
        
        total_tracked_frames = max(len(r.polygon_per_frame or []) for r in all_regions)

        while True:
            success, frame = cap.read()
            if not success:
                break

            if scale_factor < 1.0:
                frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)

            for region in all_regions:
                # Forced RGB values from website theme (BGR format for OpenCV)
                # Border: rgb(246, 250, 0) -> BGR(0, 250, 246)
                color_bgr = (0, 250, 246)
                request_label = region.label
                request_price = region.price
                request_size = region.size
                request_road_info = region.road_info
                request_text_position = region.text_position
                request_border_thickness = region.border_thickness

                poly_frames = region.polygon_per_frame or []
                if frame_idx < len(poly_frames):
                    raw_pts = np.array(poly_frames[frame_idx], dtype=np.float32)
                elif len(poly_frames) > 0:
                    raw_pts = np.array(poly_frames[-1], dtype=np.float32)
                else:
                    raw_pts = None

                if raw_pts is None or len(raw_pts) == 0:
                    continue

                if scale_factor < 1.0:
                    raw_pts = raw_pts * scale_factor
                polygon_points = raw_pts.astype(np.int32)
                M = len(polygon_points)

                is_line_mode = False
                if M == 2:
                    is_line_mode = True
                elif request_label:
                    rl = request_label.upper()
                    if any(k in rl for k in ["KM", "ROAD", "HIGHWAY", "FT", "METER", "MILE", "THI"]):
                        is_line_mode = True

                if M >= 1:
                    alpha = 0.35
                    if frame_idx < ANIM_FRAMES:
                        # Live tracing dynamic border drawing animation
                        t = frame_idx / ANIM_FRAMES
                        # If line_mode, M-1 segments. If closed plot, M segments.
                        num_segments = max(1, M - 1) if is_line_mode else M
                        curr_progress = t * num_segments
                        K = int(curr_progress)
                        fr = curr_progress - K
                        
                        # Draw fully completed border segments
                        for i in range(K):
                            if is_line_mode and i >= M - 1: continue
                            p_start = tuple(polygon_points[i])
                            p_end = tuple(polygon_points[(i + 1) % M])
                            cv2.line(frame, p_start, p_end, (0, 0, 0), thickness=request_border_thickness + 2, lineType=cv2.LINE_AA)
                            cv2.line(frame, p_start, p_end, color_bgr, thickness=max(1, request_border_thickness - 1), lineType=cv2.LINE_AA)
                            
                        # Draw current partial tracing segment
                        if K < num_segments:
                            p_start = polygon_points[K % M]
                            p_next = polygon_points[(K + 1) % M]
                            p_end_x = int(p_start[0] + fr * (p_next[0] - p_start[0]))
                            p_end_y = int(p_start[1] + fr * (p_next[1] - p_start[1]))
                            p_end = (p_end_x, p_end_y)
                            p_start_tuple = tuple(p_start)
                            
                            cv2.line(frame, p_start_tuple, p_end, (0, 0, 0), thickness=request_border_thickness + 2, lineType=cv2.LINE_AA)
                            cv2.line(frame, p_start_tuple, p_end, color_bgr, thickness=max(1, request_border_thickness - 1), lineType=cv2.LINE_AA)
                    else:
                        # Border is complete, draw closed polygon outline with background dimming
                        fade_progress = min(1.0, (frame_idx - ANIM_FRAMES) / float(FADE_FRAMES))
                        import math
                        
                        if M == 2:
                            # Draw a thick glowing line for road/distance
                            if fade_progress < 1.0:
                                alpha = 0.6 * fade_progress
                            else:
                                alpha = 0.55 + 0.1 * math.sin((frame_idx - ANIM_FRAMES - FADE_FRAMES) * 0.08)
                            
                            overlay = frame.copy()
                            # Outer glow shadow
                            cv2.line(overlay, tuple(polygon_points[0]), tuple(polygon_points[1]), (0, 0, 0), thickness=request_border_thickness + 18, lineType=cv2.LINE_AA)
                            # Main yellow fill
                            cv2.line(overlay, tuple(polygon_points[0]), tuple(polygon_points[1]), color_bgr, thickness=request_border_thickness + 12, lineType=cv2.LINE_AA)
                            # Inner white highlight
                            cv2.line(overlay, tuple(polygon_points[0]), tuple(polygon_points[1]), (255, 255, 255), thickness=max(2, request_border_thickness - 2), lineType=cv2.LINE_AA)
                            
                            frame = cv2.addWeighted(overlay, alpha, frame, 1.0 - alpha, 0)
                        else:
                            # 1. No background dimming to keep video 100% original
                            
                            if not is_line_mode:
                                # 2. Polygon Mask
                                mask = np.zeros(frame.shape[:2], dtype=np.uint8)
                                cv2.fillPoly(mask, [polygon_points], 255)
                                mask_3ch = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
                                
                                # 3. Pulsing alpha for plot fill
                                if fade_progress < 1.0:
                                    alpha = 0.35 * fade_progress
                                else:
                                    alpha = 0.30 + 0.10 * math.sin((frame_idx - ANIM_FRAMES - FADE_FRAMES) * 0.1)
                                
                                # 4. Highlighted area — Custom fill like reference website theme
                                # Field fill: rgb(0, 240, 212) -> BGR(212, 240, 0)
                                custom_fill_bgr = (212, 240, 0) 
                                highlighted_area = frame.copy()
                                color_overlay = np.zeros_like(frame)
                                cv2.fillPoly(color_overlay, [polygon_points], custom_fill_bgr)
                                highlighted_area = cv2.addWeighted(highlighted_area, 1.0, color_overlay, alpha, 0)
                                
                                # 5. Combine using mask (zero temporary memory allocation)
                                # Apply only to highlighted_area to keep original frame intact
                                frame[mask == 255] = highlighted_area[mask == 255]

                            # 6. Realistic 3D Border Glow (Adjusted thickness for a perfect thin fit)
                            # Gentle dark outer shadow
                            border_alpha_overlay = frame.copy()
                            cv2.polylines(border_alpha_overlay, [polygon_points], isClosed=not is_line_mode, color=(0, 0, 0), thickness=request_border_thickness + 2, lineType=cv2.LINE_AA)
                            frame = cv2.addWeighted(frame, 0.5, border_alpha_overlay, 0.5, 0)
                        
                            # Colored main border
                            cv2.polylines(frame, [polygon_points], isClosed=not is_line_mode, color=color_bgr, thickness=max(1, request_border_thickness - 1), lineType=cv2.LINE_AA)
                            
                            # Bright inner highlight for subtle 3D ridge effect
                            inner_thick = max(1, request_border_thickness - 4)
                            if inner_thick > 0:
                                cv2.polylines(frame, [polygon_points], isClosed=not is_line_mode, color=(255, 255, 255), thickness=inner_thick, lineType=cv2.LINE_AA)

                        # --- 3D PERSPECTIVE WARP OVERLAYS (Sequential Time-Split for Multiple Models) ---
                        total_clip_sec = total_tracked_frames / float(fps if fps > 0 else 25.0)
                        enable_fh = getattr(region, 'enable_farmhouse_overlay', False)
                        enable_pp = getattr(region, 'enable_petrol_pump_overlay', False)
                        enable_ft = getattr(region, 'enable_fountain_overlay', False)

                        # Auto-enable 3D Farmhouse & Petrol Pump models on long plot clips (>= 10.0s)
                        if total_clip_sec >= 10.0 and not enable_fh and not enable_pp and not enable_ft:
                            enable_fh = True
                            enable_pp = True

                        active_models = []
                        if enable_fh and farmhouse_img is not None:
                            active_models.append(('FARMHOUSE', farmhouse_img))
                        if enable_ft and fountain_img is not None:
                            active_models.append(('FOUNTAIN', fountain_img))
                        if enable_pp and petrol_pump_img is not None:
                            active_models.append(('PETROL PUMP', petrol_pump_img))
                            
                        if len(active_models) > 0 and M >= 4:
                            num_models = len(active_models)
                            active_label_override = None
                            img = None

                            if num_models == 1:
                                active_label_override, img = active_models[0]
                            else:
                                current_time_sec = frame_idx / float(fps if fps > 0 else 25.0)
                                # Display Farmhouse for first 3.0s, Petrol Pump for next 3.0s (0.0s to 6.0s in clip)
                                model_idx = int(current_time_sec / 3.0)
                                if model_idx < num_models:
                                    active_label_override, img = active_models[model_idx]
                                elif current_time_sec < 6.0:
                                    active_label_override, img = active_models[-1]

                            if img is not None:
                                try:
                                    pts_arr = np.array(polygon_points[:4], dtype=np.float32)
                                    cx = np.mean(pts_arr[:, 0])
                                    cy = np.mean(pts_arr[:, 1])
                                    angles = np.arctan2(pts_arr[:, 1] - cy, pts_arr[:, 0] - cx)
                                    sorted_indices = np.argsort(angles)
                                    pts_sorted = pts_arr[sorted_indices]
                                    sums = pts_sorted[:, 0] + pts_sorted[:, 1]
                                    tl_idx = np.argmin(sums)
                                    dst_pts = np.roll(pts_sorted, -tl_idx, axis=0)
                                    
                                    img_h, img_w = img.shape[:2]
                                    src_pts = np.float32([[0, 0], [img_w, 0], [img_w, img_h], [0, img_h]])
                                    
                                    M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                                    warped_img = cv2.warpPerspective(img, M_persp, (width, height))
                                    
                                    # Create polygon mask to keep warped 3D model 100% inside plot boundary
                                    warp_poly_mask = np.zeros((height, width), dtype=np.uint8)
                                    cv2.fillPoly(warp_poly_mask, [polygon_points], 255)
                                    poly_alpha = (warp_poly_mask / 255.0)
                                    
                                    # Alpha blend warped model onto frame strictly inside plot
                                    if warped_img.shape[2] == 4:
                                        alpha_mask = (warped_img[:, :, 3] / 255.0) * poly_alpha
                                        alpha_mask = alpha_mask[:, :, np.newaxis]
                                        frame = (warped_img[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                                    else:
                                        alpha_mask = poly_alpha[:, :, np.newaxis] * 0.85
                                        frame = (warped_img[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                                except Exception as ex_model:
                                    print(f"[overlay] warp error for {active_label_override}: {ex_model}")

                        # (Removed duplicate static border drawing that was overwriting animation)
                        
                        # 7. Draw plot name label (Bold Arial Black with slide-up entrance animation)
                        eff_label = active_label_override if ('active_label_override' in locals() and len(active_models) > 1) else request_label
                        if eff_label and pil_font:
                            min_y_idx = np.argmin(polygon_points[:, 1])
                            top_pt = polygon_points[min_y_idx]
                            max_y_idx = np.argmax(polygon_points[:, 1])
                            bottom_pt = polygon_points[max_y_idx]
                            center_x = int(np.mean(polygon_points[:, 0]))
                            center_y = int(np.mean(polygon_points[:, 1]))
                            
                            raw_label = eff_label.strip().upper()
                            if '\n' in raw_label:
                                lines = raw_label.split('\n')
                            else:
                                words = raw_label.split()
                                if len(words) == 2 and len(raw_label) >= 8:
                                    lines = words
                                else:
                                    lines = [raw_label]
                                
                            from PIL import ImageDraw
                            dummy_img = Image.new('RGBA', (1, 1))
                            d_dummy = ImageDraw.Draw(dummy_img)
                            line_bboxes = [d_dummy.textbbox((0, 0), line, font=pil_font) for line in lines]
                            line_widths = [b[2] - b[0] for b in line_bboxes]
                            line_heights = [b[3] - b[1] for b in line_bboxes]
                            
                            total_h = sum(line_heights) + (len(lines) - 1) * 10
                            
                            if request_text_position == "outro":
                                base_y = int(height * 0.72)
                            else:
                                # ALWAYS position label floating ABOVE top edge of plot boundary
                                base_y = int(top_pt[1] - total_h - 45)
                                base_y = max(30, min(base_y, height - total_h - 30))

                            TEXT_ANIM_FRAMES = 15
                            frames_since_anim = frame_idx - ANIM_FRAMES
                            
                            if frames_since_anim >= 0:
                                if frames_since_anim < TEXT_ANIM_FRAMES:
                                    t = frames_since_anim / TEXT_ANIM_FRAMES
                                    y_offset = 0  # removed slide animation for static glued effect
                                    opacity = int(t * 255)
                                else:
                                    y_offset = 0
                                    opacity = 255
                                    
                                start_y = base_y + y_offset
                                
                                if "LOCATION" in raw_label or "BEST" in raw_label or request_text_position == "outro":
                                    text_rgb = (255, 235, 59)  # Neon Yellow
                                else:
                                    text_rgb = (255, 255, 255)  # Crisp White

                                if False:
                                    pass
                                else:
                                    txt_layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
                                    d = ImageDraw.Draw(txt_layer)
                                    
                                    curr_y = start_y
                                    for idx_l, line in enumerate(lines):
                                        lw = line_widths[idx_l]
                                        lh = line_heights[idx_l]
                                        if M == 2 or "ROAD" in raw_label:
                                            lx = int((width - lw) / 2) if request_text_position == "outro" else int(top_pt[0] - lw / 2)
                                        else:
                                            lx = int((width - lw) / 2) if request_text_position == "outro" else int(center_x - lw / 2)
                                        lx = max(20, min(lx, width - lw - 20))
                                        
                                        # Drop shadow
                                        shadow_alpha = int(opacity * 0.7)
                                        for offset in range(1, 4):
                                            d.text((lx + offset, curr_y + offset), line, font=pil_font, fill=(0, 0, 0, shadow_alpha))
                                        
                                        # Main text with stroke
                                        d.text((lx, curr_y), line, font=pil_font, fill=(*text_rgb, opacity), stroke_width=3, stroke_fill=(0, 0, 0, opacity))
                                        curr_y += lh + 10

                                    # --- RENDER PLOT PRICE & SIZE BADGE ---
                                    badge_str = ""
                                    if request_price and request_price.strip():
                                        badge_str += request_price.strip().upper()
                                    if request_size and request_size.strip():
                                        badge_str += (" | " if badge_str else "") + request_size.strip().upper()

                                    if badge_str:
                                        try:
                                            badge_font_size = max(26, int(font_size * 0.65))
                                            b_font = ImageFont.truetype("ariblk.ttf", badge_font_size) if os.path.exists(r'C:\Windows\Fontsriblk.ttf') else pil_font
                                            b_bbox = d.textbbox((0, 0), badge_str, font=b_font)
                                            bw = b_bbox[2] - b_bbox[0]
                                            if M == 2 or "ROAD" in raw_label:
                                                blx = int((width - bw) / 2) if request_text_position == "outro" else int(top_pt[0] - bw / 2)
                                            else:
                                                blx = int((width - bw) / 2) if request_text_position == "outro" else int(center_x - bw / 2)
                                            blx = max(20, min(blx, width - bw - 20))
                                            
                                            # Gold (#FFD700) badge text with drop shadow
                                            for offset in range(1, 3):
                                                d.text((blx + offset, curr_y + offset), badge_str, font=b_font, fill=(0, 0, 0, shadow_alpha))
                                            d.text((blx, curr_y), badge_str, font=b_font, fill=(255, 215, 0, opacity), stroke_width=2, stroke_fill=(0, 0, 0, opacity))
                                        except Exception as ex_b:
                                            print(f"[overlay] Badge error: {ex_b}")

                                    # --- RENDER ROAD CONNECTIVITY & DISTANCE BADGE ---
                                    if request_road_info and request_road_info.strip():
                                        try:
                                            road_str = "➔ " + request_road_info.strip().upper()
                                            r_font_size = max(22, int(font_size * 0.55))
                                            r_font = ImageFont.truetype("arialbd.ttf", r_font_size) if os.path.exists(r'C:\Windows\Fontsrialbd.ttf') else pil_font
                                            r_bbox = d.textbbox((0, 0), road_str, font=r_font)
                                            rw = r_bbox[2] - r_bbox[0]
                                            rh = r_bbox[3] - r_bbox[1]
                                            
                                            rx = 25
                                            ry = int(height - rh - 45)
                                            
                                            r_pad_x = 14
                                            r_pad_y = 7
                                            r_box = [rx - r_pad_x, ry - r_pad_y, rx + rw + r_pad_x, ry + rh + r_pad_y]
                                            d.rounded_rectangle(r_box, radius=8, fill=(15, 23, 42, int(opacity * 0.85)), outline=(0, 229, 255, opacity), width=2)
                                            d.text((rx, ry), road_str, font=r_font, fill=(255, 255, 255, opacity))
                                        except Exception as ex_r:
                                            print(f"[overlay] Road info error: {ex_r}")

                                    txt_np = np.array(txt_layer)
                                    txt_alpha = (txt_np[:, :, 3] / 255.0)
                                    txt_bgr = cv2.cvtColor(txt_np[:, :, :3], cv2.COLOR_RGB2BGR)

                                    mask_alpha = txt_alpha[:, :, np.newaxis]
                                    frame = (txt_bgr * mask_alpha + frame * (1.0 - mask_alpha)).astype(np.uint8)

            # Custom Location Card Overlay with POP-POP Text Animation
            # (20s to 24s in full reel / 5.66s to 9.66s in Clip 5 - 4 full seconds)
            current_time_sec = frame_idx / float(fps if fps > 0 else 25.0)
            total_clip_sec = total_tracked_frames / float(fps if fps > 0 else 25.0)
            if total_clip_sec >= 7.0 and location_card_img is not None and 5.66 <= current_time_sec <= 9.66:
                h_img, w_img = location_card_img.shape[:2]
                target_ratio = width / float(height)
                img_ratio = w_img / float(h_img)
                if img_ratio > target_ratio:
                    new_w = int(h_img * target_ratio)
                    start_x = (w_img - new_w) // 2
                    cropped = location_card_img[:, start_x:start_x + new_w]
                else:
                    new_h = int(w_img / target_ratio)
                    start_y = (h_img - new_h) // 2
                    cropped = location_card_img[start_y:start_y + new_h, :]
                card_full = cv2.resize(cropped, (width, height), interpolation=cv2.INTER_LANCZOS4)

                # Full Cinematic Scale-Pop Entrance (elastic bounce zoom + smooth fade-in)
                local_t = current_time_sec - 5.66  # 0.0s to 4.0s window
                pop_duration = 0.45  # 0.45s snappy pop entrance

                if local_t < pop_duration:
                    import math
                    progress = local_t / pop_duration
                    # Elastic bounce-out curve
                    ease_bounce = 1.0 + 0.20 * math.sin(progress * math.pi) * (1.0 - progress)
                    scale = (1.20 * (1.0 - progress) + 1.0 * progress) * ease_bounce
                    
                    opacity = min(1.0, progress * 2.5)  # Quick smooth fade-in
                    
                    scaled_w = max(width, int(width * scale))
                    scaled_h = max(height, int(height * scale))
                    scaled_card = cv2.resize(card_full, (scaled_w, scaled_h), interpolation=cv2.INTER_LANCZOS4)
                    
                    cx, cy = scaled_w // 2, scaled_h // 2
                    x1c = max(0, cx - width // 2)
                    y1c = max(0, cy - height // 2)
                    cropped_card = scaled_card[y1c:y1c + height, x1c:x1c + width]
                    if cropped_card.shape[0] == height and cropped_card.shape[1] == width:
                        frame = cv2.addWeighted(cropped_card, opacity, frame, 1.0 - opacity, 0)
                    else:
                        frame = cv2.addWeighted(card_full, opacity, frame, 1.0 - opacity, 0)
                else:
                    frame = card_full

            out.write(frame)
            frame_idx += 1
    else:
        # Write remaining video frames (or all frames if no polygon)
        while True:
            success, frame = cap.read()
            if not success:
                break
            if scale_factor < 1.0:
                frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            out.write(frame)

    cap.release()
    out.release()

    # Step C: FFmpeg re-encode
    final_output_path = os.path.join(temp_dir, "overlay_final.mp4")
    try:
        subprocess.run([
            "ffmpeg", "-y", "-i", temp_video_path,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
            final_output_path
        ], check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        err_msg = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
        print(f"[overlay] FFmpeg re-encode warning: {err_msg}")
        final_output_path = temp_video_path

    # Step D: Result local storage & MinIO mein upload/copy karo
    output_object_name = f"highlighted_{request.object_name}"
    demo_dir = "demo_clips"
    os.makedirs(demo_dir, exist_ok=True)
    local_highlight_path = os.path.join(demo_dir, output_object_name)
    import shutil
    shutil.copy(final_output_path, local_highlight_path)

    try:
        with open(final_output_path, "rb") as f:
            file_data = f.read()
        from io import BytesIO
        minio_client.put_object(
            MINIO_BUCKET,
            output_object_name,
            data=BytesIO(file_data),
            length=len(file_data),
            content_type="video/mp4",
        )
    except Exception as e:
        print(f"[overlay warning] MinIO upload threw {e}, using local storage copy...")

    # Cleanup
    for path in [temp_video_path, final_output_path, source_local_path]:
        if os.path.exists(path):
            os.remove(path)

    output_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{output_object_name}"

    return {
        "success": True,
        "output_object_name": output_object_name,
        "url": output_url,
        "frames_processed": frame_idx,
    }


@router.post("/merge-audio/{highlighted_object_name}")
def merge_audio_back(highlighted_object_name: str, original_object_name: str):
    """
    Highlighted (audio-less) video mein original video ka audio wapas jodta hai.
    """
    from app.routers.uploads import minio_client
    from app.config import MINIO_BUCKET, MINIO_ENDPOINT

    temp_dir = tempfile.mkdtemp()

    # Step A+B: Try local demo_clips first, then fall back to MinIO
    highlighted_local = os.path.join(temp_dir, "highlighted.mp4")
    original_local = os.path.join(temp_dir, "original.mp4")

    import shutil
    demo_highlighted = os.path.join("demo_clips", highlighted_object_name)
    demo_original = os.path.join("demo_clips", original_object_name)

    # Highlighted video
    if os.path.exists(demo_highlighted) and os.path.getsize(demo_highlighted) > 0:
        shutil.copy(demo_highlighted, highlighted_local)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, highlighted_object_name, highlighted_local)
        except Exception as e:
            print(f"[merge-audio] MinIO download failed for highlighted: {e}")
            raise HTTPException(status_code=404, detail=f"Highlighted file not found: {str(e)}")

    # Original video
    if os.path.exists(demo_original) and os.path.getsize(demo_original) > 0:
        shutil.copy(demo_original, original_local)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, original_object_name, original_local)
        except Exception as e:
            print(f"[merge-audio] MinIO download failed for original: {e}")
            raise HTTPException(status_code=404, detail=f"Original file not found: {str(e)}")

    # Step C: Check karo original video mein audio stream hai bhi ya nahi
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", original_local],
        capture_output=True, text=True
    )
    has_audio = bool(probe.stdout.strip())

    final_output_path = os.path.join(temp_dir, "final_with_audio.mp4")

    if has_audio:
        # Step D: Highlighted video (visual) + Original video (audio) merge karo
        subprocess.run([
            "ffmpeg", "-y",
            "-i", highlighted_local,      # video source
            "-i", original_local,          # audio source
            "-c:v", "copy",
            "-map", "0:v:0",               # sirf highlighted video ka visual
            "-map", "1:a:0",               # sirf original video ka audio
            "-c:a", "aac",
            "-shortest",                    # jo chhota ho usi ki length use karo
            final_output_path
        ], check=True, capture_output=True)
    else:
        # Agar original mein audio hi nahi tha, toh highlighted video hi final hai
        final_output_path = highlighted_local

    # Step E: Save result locally first, then try MinIO
    final_object_name = f"final_{highlighted_object_name}"
    demo_dir = "demo_clips"
    os.makedirs(demo_dir, exist_ok=True)
    local_final_path = os.path.join(demo_dir, final_object_name)
    shutil.copy(final_output_path, local_final_path)

    try:
        with open(final_output_path, "rb") as f:
            file_data = f.read()
        from io import BytesIO
        minio_client.put_object(
            MINIO_BUCKET,
            final_object_name,
            data=BytesIO(file_data),
            length=len(file_data),
            content_type="video/mp4",
        )
    except Exception as e:
        print(f"[merge-audio warning] MinIO upload threw {e}, using local storage copy...")

    # Cleanup temp files
    for path in [highlighted_local, original_local, final_output_path]:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass
                
    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
        shutil.rmtree(out_frames_dir, ignore_errors=True)
    except Exception:
        pass

    output_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{final_object_name}"

    return {
        "success": True,
        "final_object_name": final_object_name,
        "output_object_name": final_object_name,
        "url": output_url,
        "had_audio": has_audio,
    }
