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
    polygon_per_frame: List[List[List[float]]]
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

    farmhouse_img = cv2.imread(os.path.join("assets", "farmhouse_render.png"), cv2.IMREAD_UNCHANGED)
    fountain_img = cv2.imread(os.path.join("assets", "fountain.png"), cv2.IMREAD_UNCHANGED)


    # Step A: Video ko local temp file me download karo
    # (presigned URLs ke saath cv2.VideoCapture Windows pe fail hota hai)
    temp_dir = tempfile.mkdtemp()
    source_local_path = os.path.join(temp_dir, "source_video.mp4")
    demo_p = os.path.join("demo_clips", request.object_name)
    if os.path.exists(demo_p) and os.path.getsize(demo_p) > 0:
        import shutil
        shutil.copy(demo_p, source_local_path)
    else:
        try:
            minio_client.fget_object(MINIO_BUCKET, request.object_name, source_local_path)
        except Exception as e:
            print(f"[overlay] MinIO download failed for {request.object_name}: {e}")
            traceback.print_exc()
            raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

    cap = cv2.VideoCapture(source_local_path)
    if not cap.isOpened():
        print(f"[overlay] cv2.VideoCapture failed to open: {source_local_path}")
        raise HTTPException(status_code=400, detail=f"Could not open video: {request.object_name}")

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

    if len(all_regions) > 0:
        # Animation timings
        ANIM_FRAMES = int(fps * 0.4) 
        FADE_FRAMES = int(fps * 0.25)
        
        frame_idx = 0
        total_tracked_frames = max(len(r.polygon_per_frame) for r in all_regions)

        while True:
            success, frame = cap.read()
            if not success:
                break

            if scale_factor < 1.0:
                frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)

            for region in all_regions:
                color_bgr = hex_to_bgr(region.highlight_color)
                request_label = region.label
                request_price = region.price
                request_size = region.size
                request_road_info = region.road_info
                request_text_position = region.text_position
                request_border_thickness = region.border_thickness

                if frame_idx < len(region.polygon_per_frame):
                    raw_pts = np.array(region.polygon_per_frame[frame_idx], dtype=np.float32)
                elif len(region.polygon_per_frame) > 0:
                    raw_pts = np.array(region.polygon_per_frame[-1], dtype=np.float32)
                else:
                    raw_pts = None

                if raw_pts is None or len(raw_pts) == 0:
                    continue

                if scale_factor < 1.0:
                    raw_pts = raw_pts * scale_factor
                polygon_points = raw_pts.astype(np.int32)
                M = len(polygon_points)
                
                if M >= 1:
                    if frame_idx < ANIM_FRAMES:
                        # Live tracing dynamic border drawing animation
                        t = frame_idx / ANIM_FRAMES
                        curr_progress = t * M
                        K = int(curr_progress)
                        fr = curr_progress - K
                        
                        # Draw fully completed border segments
                        for i in range(K):
                            p_start = tuple(polygon_points[i])
                            p_end = tuple(polygon_points[(i + 1) % M])
                            cv2.line(frame, p_start, p_end, (0, 0, 0), thickness=request_border_thickness + 4, lineType=cv2.LINE_AA)
                            cv2.line(frame, p_start, p_end, color_bgr, thickness=request_border_thickness, lineType=cv2.LINE_AA)
                            
                        # Draw current partial tracing segment
                        if K < M:
                            p_start = polygon_points[K]
                            p_next = polygon_points[(K + 1) % M]
                            p_end_x = int(p_start[0] + fr * (p_next[0] - p_start[0]))
                            p_end_y = int(p_start[1] + fr * (p_next[1] - p_start[1]))
                            p_end = (p_end_x, p_end_y)
                            p_start_tuple = tuple(p_start)
                            
                            cv2.line(frame, p_start_tuple, p_end, (0, 0, 0), thickness=request_border_thickness + 4, lineType=cv2.LINE_AA)
                            cv2.line(frame, p_start_tuple, p_end, color_bgr, thickness=request_border_thickness, lineType=cv2.LINE_AA)
                    else:
                        alpha = 0.30 + 0.10 * math.sin((frame_idx - ANIM_FRAMES - FADE_FRAMES) * 0.1)
                    
                    # 4. Highlighted area
                    highlighted_area = frame.copy()
                    color_overlay = np.zeros_like(frame)
                    cv2.fillPoly(color_overlay, [polygon_points], color_bgr)
                    highlighted_area = cv2.addWeighted(highlighted_area, 1.0, color_overlay, alpha, 0)
                    
                    # 5. Combine using mask (zero temporary memory allocation)
                    frame = dimmed_frame.copy()
                    frame[mask == 255] = highlighted_area[mask == 255]

                    # Determine active 3D overlays and compute sequential time slots
                    active_overlays = []
                    if farmhouse_img is not None: active_overlays.append(("farmhouse", farmhouse_img))
                    if fountain_img is not None: active_overlays.append(("fountain", fountain_img))
                    if petrol_pump_img is not None: active_overlays.append(("petrol_pump", petrol_pump_img))

                    num_active = len(active_overlays)
                    current_asset_img = None
                    if num_active > 0:
                        slot_len = total_tracked_frames / float(num_active)
                        active_slot_idx = min(num_active - 1, int(frame_idx / slot_len))
                        current_asset_name, current_asset_img = active_overlays[active_slot_idx]

                    if current_asset_img is not None and M >= 4:
                        try:
                            img_h, img_w = current_asset_img.shape[:2]
                            src_pts = np.float32([[0, 0], [img_w, 0], [img_w, img_h], [0, img_h]])
                            dst_pts = polygon_points[:4].astype(np.float32)
                            M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                            warped_img = cv2.warpPerspective(current_asset_img, M_persp, (width, height))
                            if warped_img.shape[2] == 4:
                                alpha_mask = (warped_img[:, :, 3] / 255.0)[:, :, np.newaxis]
                                frame = (warped_img[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                            else:
                                frame = cv2.addWeighted(warped_img, 0.8, frame, 0.2, 0)
                        except Exception as ex_overlay:
                            print(f"[overlay] 3D overlay warp error: {ex_overlay}")

                    # 6. Draw glowing borders
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=color_bgr, thickness=request.border_thickness + 4, lineType=cv2.LINE_AA)
                    cv2.polylines(frame, [polygon_points], isClosed=True, color=(255, 255, 255), thickness=request.border_thickness + 1, lineType=cv2.LINE_AA)
                    
                    # 7. Draw plot name label (Bold Arial Black with slide-up entrance animation)
                    if request.label and pil_font:
                        min_y_idx = np.argmin(polygon_points[:, 1])
                        # Border is complete, draw closed polygon outline with background dimming
                        fade_progress = min(1.0, (frame_idx - ANIM_FRAMES) / float(FADE_FRAMES))
                        
                        # 1. Dim background smoothly outside plot (Very subtle so multiple highlights don't turn it pitch black)
                        dim_factor = 1.0 - (0.15 * fade_progress)
                        dimmed_frame = cv2.convertScaleAbs(frame, alpha=dim_factor, beta=0)
                        
                        # 2. Polygon Mask
                        mask = np.zeros(frame.shape[:2], dtype=np.uint8)
                        cv2.fillPoly(mask, [polygon_points], 255)
                        mask_3ch = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
                        
                        # 3. Pulsing alpha for plot fill
                        import math
                        if fade_progress < 1.0:
                            alpha = 0.35 * fade_progress
                        else:
                            alpha = 0.30 + 0.10 * math.sin((frame_idx - ANIM_FRAMES - FADE_FRAMES) * 0.1)
                        
                        # 4. Highlighted area
                        highlighted_area = frame.copy()
                        color_overlay = np.zeros_like(frame)
                        cv2.fillPoly(color_overlay, [polygon_points], color_bgr)
                        highlighted_area = cv2.addWeighted(highlighted_area, 1.0, color_overlay, alpha, 0)
                        
                        # 5. Combine using mask (zero temporary memory allocation)
                        frame = dimmed_frame.copy()
                        frame[mask == 255] = highlighted_area[mask == 255]

                        # --- 3D FARMHOUSE PERSPECTIVE WARP OVERLAY ---
                        if farmhouse_img is not None and M >= 4:
                            try:
                                fh_h, fh_w = farmhouse_img.shape[:2]
                                src_pts = np.float32([[0, 0], [fh_w, 0], [fh_w, fh_h], [0, fh_h]])
                                dst_pts = polygon_points[:4].astype(np.float32)
                                M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                                warped_fh = cv2.warpPerspective(farmhouse_img, M_persp, (width, height))
                                # Alpha blend warped farmhouse onto frame
                                if warped_fh.shape[2] == 4:
                                    alpha_mask = (warped_fh[:, :, 3] / 255.0)[:, :, np.newaxis]
                                    frame = (warped_fh[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                                else:
                                    frame = cv2.addWeighted(warped_fh, 0.8, frame, 0.2, 0)
                            except Exception as ex_fh:
                                print(f"[overlay] Farmhouse warp error: {ex_fh}")

                        # --- 3D FOUNTAIN PERSPECTIVE WARP OVERLAY ---
                        if fountain_img is not None and M >= 4:
                            try:
                                ft_h, ft_w = fountain_img.shape[:2]
                                src_pts = np.float32([[0, 0], [ft_w, 0], [ft_w, ft_h], [0, ft_h]])
                                dst_pts = polygon_points[:4].astype(np.float32)
                                M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                                warped_ft = cv2.warpPerspective(fountain_img, M_persp, (width, height))
                                # Alpha blend warped fountain onto frame
                                if warped_ft.shape[2] == 4:
                                    alpha_mask = (warped_ft[:, :, 3] / 255.0)[:, :, np.newaxis]
                                    frame = (warped_ft[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                                else:
                                    frame = cv2.addWeighted(warped_ft, 0.8, frame, 0.2, 0)
                            except Exception as ex_ft:
                                print(f"[overlay] Fountain warp error: {ex_ft}")

                        # --- 3D PETROL PUMP PERSPECTIVE WARP OVERLAY ---
                        petrol_pump_img = None
                        if region.enable_petrol_pump_overlay:
                            pp_path = os.path.join(assets_dir, "petrol_pump.png")
                            if os.path.exists(pp_path):
                                petrol_pump_img = cv2.imread(pp_path, cv2.IMREAD_UNCHANGED)

                        if petrol_pump_img is not None and M >= 4:
                            try:
                                pp_h, pp_w = petrol_pump_img.shape[:2]
                                src_pts = np.float32([[0, 0], [pp_w, 0], [pp_w, pp_h], [0, pp_h]])
                                dst_pts = polygon_points[:4].astype(np.float32)
                                M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
                                warped_pp = cv2.warpPerspective(petrol_pump_img, M_persp, (width, height))
                                if warped_pp.shape[2] == 4:
                                    alpha_mask = (warped_pp[:, :, 3] / 255.0)[:, :, np.newaxis]
                                    frame = (warped_pp[:, :, :3] * alpha_mask + frame * (1.0 - alpha_mask)).astype(np.uint8)
                                else:
                                    frame = cv2.addWeighted(warped_pp, 0.8, frame, 0.2, 0)
                            except Exception as ex_pp:
                                print(f"[overlay] Petrol pump warp error: {ex_pp}")

                        # 6. Draw glowing borders
                        cv2.polylines(frame, [polygon_points], isClosed=True, color=color_bgr, thickness=request_border_thickness + 4, lineType=cv2.LINE_AA)
                        cv2.polylines(frame, [polygon_points], isClosed=True, color=(255, 255, 255), thickness=request_border_thickness + 1, lineType=cv2.LINE_AA)
                        
                        # 7. Draw plot name label (Bold Arial Black with slide-up entrance animation)
                        if request_label and pil_font:
                            min_y_idx = np.argmin(polygon_points[:, 1])
                            top_pt = polygon_points[min_y_idx]
                            
                            raw_label = request_label.strip().upper()
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
                                base_y = int(top_pt[1] - total_h - 35)
                                base_y = max(30, min(base_y, height - total_h - 30))

                            TEXT_ANIM_FRAMES = 15
                            frames_since_anim = frame_idx - ANIM_FRAMES
                            
                            if frames_since_anim >= 0:
                                if frames_since_anim < TEXT_ANIM_FRAMES:
                                    t = frames_since_anim / TEXT_ANIM_FRAMES
                                    y_offset = int((1.0 - t) * 40)
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
                                        lx = int((width - lw) / 2) if request_text_position == "outro" else int(top_pt[0] - lw / 2)
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
                                            blx = int((width - bw) / 2) if request_text_position == "outro" else int(top_pt[0] - bw / 2)
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

    output_url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET}/{final_object_name}"

    return {
        "success": True,
        "final_object_name": final_object_name,
        "url": output_url,
        "had_audio": has_audio,
    }
