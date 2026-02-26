"""
Alternative orientation detection driver using DocTR OCR confidence scoring.
Evaluates rotation candidates via full OCR passes when OSD heuristics fail.

@see architecture/details/document-types-and-processing.md - "Image Scaling Strategy"
"""

import json
import argparse
import numpy as np
import cv2
from doctr.models import ocr_predictor
from doctr.io import DocumentFile


# ---------------------------------------------------------------------------
# Load OCR model (CPU)
# ---------------------------------------------------------------------------

model = ocr_predictor(pretrained=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def rotate_image(img: np.ndarray, angle: int) -> np.ndarray:
    if angle == 0:
        return img
    elif angle == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    elif angle == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    else:
        raise ValueError("Invalid angle")


def score_image(img: np.ndarray) -> float:
    result = model([img])

    words = []
    for page in result.pages:
        for block in page.blocks:
            for line in block.lines:
                for word in line.words:
                    words.append(word.confidence)

    return float(np.mean(words)) if words else 0.0


# ---------------------------------------------------------------------------
# Main detection
# ---------------------------------------------------------------------------

def detect_orientation(image_path: str) -> dict:
    img = cv2.imread(image_path)

    if img is None:
        return {"error": "Could not load image"}

    scores = {}
    for angle in [0, 90, 180, 270]:
        rotated = rotate_image(img, angle)
        scores[angle] = score_image(rotated)

    best_angle = max(scores, key=scores.get)
    best_score = scores[best_angle]

    total = sum(scores.values()) + 1e-6
    confidence = best_score / total

    return {
        "rotation": int(best_angle),
        "confidence": round(float(confidence), 3),
        "method": "doctr_rotation_scoring",
        "scores": {str(k): round(float(v), 3) for k, v in scores.items()}
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect image orientation")
    parser.add_argument("image_path", help="Path to input image")
    args = parser.parse_args()

    result = detect_orientation(args.image_path)
    print(json.dumps(result))
