import numpy as np
import cv2
import torch
from segment_anything import sam_model_registry, SamPredictor

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

sam = sam_model_registry["vit_b"](checkpoint="sam_vit_b.pth")
sam.to(device=device)
predictor = SamPredictor(sam)

image = cv2.imread("plot_test_frame.jpg")
image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
predictor.set_image(image_rgb)

# Same click point verified visually: (424, 262) in an 848x478 frame
input_point = np.array([[424, 262]])
input_label = np.array([1])  # 1 = foreground click

masks, scores, logits = predictor.predict(
    point_coords=input_point,
    point_labels=input_label,
    multimask_output=True,  # SAM returns 3 candidate masks, ranked by confidence
)

for i, (mask, score) in enumerate(zip(masks, scores)):
    print(f"Mask {i}: confidence score = {score:.3f}")
    overlay = image_rgb.copy()
    overlay[mask] = overlay[mask] * 0.5 + np.array([255, 255, 0]) * 0.5  # yellow tint
    cv2.imwrite(f"sam_mask_{i}.jpg", cv2.cvtColor(overlay.astype(np.uint8), cv2.COLOR_RGB2BGR))

print("Done. Check sam_mask_0.jpg, sam_mask_1.jpg, sam_mask_2.jpg")
