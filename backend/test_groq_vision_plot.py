import os
import base64
from groq import Groq

def encode_image(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

image_path = "plot_test_frame.jpg"
base64_image = encode_image(image_path)

completion = client.chat.completions.create(
    model="qwen/qwen3.6-27b",
    reasoning_effort="none",
    reasoning_format="hidden",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "This is an aerial drone photo of agricultural land divided into plots. "
                        "Describe the boundary of the plot closest to the center of the image. "
                        "If you can identify a clear boundary (dirt path, fence, tree line, color change), "
                        "describe its approximate location using percentages of image width/height "
                        "(e.g. left edge at 30% from left, top edge at 20% from top). "
                        "If the boundary is NOT clearly visually distinguishable from adjacent plots, say so explicitly."
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                }
            ]
        }
    ],
)

print(completion.choices[0].message.content)
