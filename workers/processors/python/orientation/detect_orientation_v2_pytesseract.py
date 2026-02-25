"""
Image Orientation Detection (Tesseract OSD)

Detects the correct upright orientation of document images using
Tesseract's Orientation and Script Detection (OSD) engine.

Tesseract OSD analyzes text patterns to determine:
- Page orientation (0/90/180/270 degrees)
- Orientation confidence
- Script (Latin, Cyrillic, etc.)

Fallback: if OSD fails (e.g., too little text), uses a lightweight
aspect-ratio + EXIF heuristic.

Usage: python detect_orientation.py <image_path>
Output: JSON to stdout
"""

import json
import argparse

import pytesseract
from PIL import Image, ExifTags


# ---------------------------------------------------------------------------
# EXIF helper
# ---------------------------------------------------------------------------

def _get_exif_rotation(img: Image.Image) -> int | None:
    """Extract EXIF orientation as rotation degrees (0/90/180/270), or None."""
    try:
        exif = img.getexif()
        if not exif:
            return None
        orientation_key = None
        for tag, name in ExifTags.TAGS.items():
            if name == "Orientation":
                orientation_key = tag
                break
        if orientation_key is None or orientation_key not in exif:
            return None
        val = exif[orientation_key]
        # EXIF orientation → rotation degrees
        # 1=normal, 3=180°, 6=90° CW, 8=90° CCW (270° CW)
        mapping = {1: 0, 3: 180, 6: 90, 8: 270}
        return mapping.get(val, None)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main detection
# ---------------------------------------------------------------------------

def detect_orientation(image_path: str) -> dict:
    """
    Detect the correct upright orientation of an image.

    Primary: Tesseract OSD (pytesseract.image_to_osd)
    Fallback: EXIF hint if OSD fails

    Returns dict with:
      rotation: int (0/90/180/270)
      confidence: float (0-1)
      method: str (how it was detected)
      script: str | None (detected script, e.g., "Latin")
    """
    try:
        img = Image.open(image_path)
        exif_hint = _get_exif_rotation(img)

        # Convert to RGB if needed (Tesseract doesn't handle all modes)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # --- Try Tesseract OSD ---
        try:
            osd = pytesseract.image_to_osd(img, output_type=pytesseract.Output.DICT)
            print(pytesseract.image_to_string(img))

            rotation = int(osd.get("rotate", 0))
            orientation_conf = float(osd.get("orientation_conf", 0))
            script = osd.get("script", None)
            script_conf = float(osd.get("script_conf", 0))

            # Tesseract OSD confidence is 0-100, normalise to 0-1
            confidence = orientation_conf / 100.0

            return {
                "rotation": rotation,
                "confidence": round(confidence, 3),
                "method": "tesseract_osd",
                "script": script,
                "scriptConfidence": round(script_conf / 100.0, 3),
                "exifHint": exif_hint,
            }

        except pytesseract.TesseractError as te:
            # OSD can fail if the image has too little text or is blank
            # Fall back to EXIF hint
            if exif_hint is not None and exif_hint != 0:
                return {
                    "rotation": exif_hint,
                    "confidence": 0.5,  # EXIF-only = medium confidence
                    "method": "exif_fallback",
                    "script": None,
                    "scriptConfidence": 0,
                    "exifHint": exif_hint,
                    "osdError": str(te),
                }

            # No OSD, no EXIF → assume upright
            return {
                "rotation": 0,
                "confidence": 0.3,  # low confidence guess
                "method": "default_fallback",
                "script": None,
                "scriptConfidence": 0,
                "exifHint": None,
                "osdError": str(te),
            }

    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect image orientation")
    parser.add_argument("image_path", help="Path to input image")
    args = parser.parse_args()

    result = detect_orientation(args.image_path)
    print(json.dumps(result))
