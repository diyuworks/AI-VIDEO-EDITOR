import sys
import os

file_path = r'c:\Users\Saubhagyam\AI-Video Editor\AI-VIDEO-EDITOR\backend\app\routers\tracking.py'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

corrupted_block = """        for idx, tr in enumerate(trackers):
    return {"polygons_per_frame": polygons_per_frame}"""

fixed_block = """        for idx, tr in enumerate(trackers):
            if tr["prev_pts"] is not None and len(tr["prev_pts"]) > 0:
                curr_pts, status, err = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, tr["prev_pts"], None, **lk_params)
                good_curr = curr_pts[status == 1]
                good_prev = tr["prev_pts"][status == 1]

                if len(good_curr) >= 4:
                    M, inliers = cv2.findHomography(good_prev, good_curr, cv2.RANSAC, 5.0)
                    if M is not None:
                        homog_pts = np.array([tr["current_poly_scaled"]], dtype=np.float32)
                        tr["current_poly_scaled"] = cv2.perspectiveTransform(homog_pts, M)[0]

                tr["prev_pts"] = good_curr.reshape(-1, 1, 2)
                
                if len(tr["prev_pts"]) < 10:
                    poly_pts_int = np.array(tr["current_poly_scaled"], dtype=np.int32)
                    fresh_mask = np.zeros_like(curr_gray)
                    if len(poly_pts_int) > 2:
                        cv2.fillPoly(fresh_mask, [poly_pts_int], 255)
                    else:
                        cv2.polylines(fresh_mask, [poly_pts_int], False, 255, 5)
                    
                    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
                    fresh_mask = cv2.dilate(fresh_mask, kernel, iterations=1)
                    
                    fresh_features = cv2.goodFeaturesToTrack(curr_gray, maxCorners=100, qualityLevel=0.01, minDistance=5, mask=fresh_mask)
                    cur_vertex_pts = tr["current_poly_scaled"].reshape(-1, 1, 2)
                    if fresh_features is not None:
                        tr["prev_pts"] = np.vstack((cur_vertex_pts, fresh_features))
                    else:
                        tr["prev_pts"] = cur_vertex_pts
            
            polygons_per_frame[idx].append((tr["current_poly_scaled"] / scale_factor).tolist())

        prev_gray = curr_gray.copy()

    cap.release()
    return {"polygons_per_frame": polygons_per_frame}"""

if corrupted_block in content:
    content = content.replace(corrupted_block, fixed_block)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed corrupted tracking.py successfully.")
else:
    print("Corrupted block not found. Checking if it's already fixed or something else.")
