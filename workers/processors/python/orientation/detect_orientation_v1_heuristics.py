"""
Legacy V1 orientation detection utilizing pure computer vision heuristics.
Analyzes projection profiles, edge histograms, and connected components to infer rotation.

@see architecture/details/document-types-and-processing.md - "Image Scaling Strategy"
"""

import sys
import json
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ExifTags

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ANALYSIS_SIZE = 512  # Downscale longest side to this for speed
BINARIZE_THRESHOLD = 128
CONFIDENCE_THRESHOLD = 0.6

# Heuristic weights – must sum to 1.0
W_PROJECTION = 0.35
W_EDGE = 0.25
W_COMPONENTS = 0.20
W_ASPECT = 0.10
W_EXIF = 0.10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _downscale(img: Image.Image, max_dim: int) -> Image.Image:
    """Downscale image so longest side = max_dim. No upscaling."""
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / max(w, h)
    return img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)


def _to_binary(gray: np.ndarray) -> np.ndarray:
    """Binarize: text pixels = 1, background = 0 (assumes dark text on light bg)."""
    return (gray < BINARIZE_THRESHOLD).astype(np.uint8)


def _get_exif_rotation(img: Image.Image) -> int | None:
    """Extract EXIF orientation as rotation degrees (0/90/180/270), or None."""
    try:
        exif = img.getexif()
        if not exif:
            return None
        # Find orientation tag
        orientation_key = None
        for tag, name in ExifTags.TAGS.items():
            if name == "Orientation":
                orientation_key = tag
                break
        if orientation_key is None or orientation_key not in exif:
            return None
        val = exif[orientation_key]
        # Map EXIF orientation value to rotation degrees
        # Values: 1=normal, 3=180, 6=90CW, 8=90CCW
        mapping = {1: 0, 3: 180, 6: 90, 8: 270}
        return mapping.get(val, None)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Heuristic scorers – each returns a dict {0: score, 90: score, ...}
# ---------------------------------------------------------------------------


def _score_projection_profile(rotations: dict[int, np.ndarray]) -> dict[int, float]:
    """
    For each rotation, compute horizontal projection profile (sum each row).
    High variance in the profile → clear text lines → likely correct orientation.
    """
    scores: dict[int, float] = {}
    for angle, binary in rotations.items():
        row_sums = binary.sum(axis=1).astype(float)
        if row_sums.std() < 1e-9:
            scores[angle] = 0.0
        else:
            # Normalised variance: higher is better
            scores[angle] = float(row_sums.var() / (row_sums.mean() + 1e-9))
    return _normalise(scores)


def _score_edge_histogram(rotations: dict[int, np.ndarray]) -> dict[int, float]:
    """
    Compute horizontal vs vertical gradient energy.
    Upright text has strong horizontal edges (baselines, ascenders).
    We want the ratio horizontal / (horizontal + vertical) to be maximised.
    """
    scores: dict[int, float] = {}
    for angle, gray in rotations.items():
        g = gray.astype(float)
        # Simple Sobel-like kernels via diff
        gy = np.abs(np.diff(g, axis=0))  # horizontal edges (row-wise diff)
        gx = np.abs(np.diff(g, axis=1))  # vertical edges (col-wise diff)
        h_energy = gy.sum()
        v_energy = gx.sum()
        total = h_energy + v_energy + 1e-9
        # Upright text → more horizontal edges → higher ratio
        scores[angle] = float(h_energy / total)
    return _normalise(scores)


def _score_connected_components(
    rotations: dict[int, np.ndarray],
) -> dict[int, float]:
    """
    Simple connected-component analysis via run-length heuristic.
    Instead of full flood-fill, we measure:
    - Row-level run statistics (avg run length & count)
    Upright text has many short horizontal runs clustered in rows.
    """
    scores: dict[int, float] = {}
    for angle, binary in rotations.items():
        total_runs = 0
        total_run_length = 0
        row_run_counts = []

        for row in binary:
            # Count transitions 0→1 and track run lengths
            in_run = False
            run_count = 0
            for px in row:
                if px == 1 and not in_run:
                    in_run = True
                    run_count += 1
                    total_runs += 1
                    total_run_length += 1
                elif px == 1 and in_run:
                    total_run_length += 1
                elif px == 0:
                    in_run = False
            row_run_counts.append(run_count)

        if total_runs == 0:
            scores[angle] = 0.0
            continue

        avg_run_length = total_run_length / total_runs
        run_count_variance = float(np.var(row_run_counts))

        # Upright text: moderate run lengths (characters), high variance in
        # runs-per-row (text rows vs whitespace rows)
        # Penalise very long runs (image bands, not text)
        run_length_score = 1.0 / (1.0 + abs(avg_run_length - 8.0))
        scores[angle] = run_count_variance * run_length_score
    return _normalise(scores)


def _score_aspect_ratio(w: int, h: int) -> dict[int, float]:
    """
    Most documents are portrait. Give a small bonus to rotations that yield
    portrait-ish aspect ratio. 0° and 180° keep aspect ratio, 90° and 270° swap.
    """
    scores: dict[int, float] = {}
    for angle in [0, 90, 180, 270]:
        aw, ah = (w, h) if angle in (0, 180) else (h, w)
        ratio = ah / (aw + 1e-9)  # > 1 means portrait
        # Slight portrait preference, but not extreme
        scores[angle] = min(ratio, 2.0) / 2.0  # clamp
    return _normalise(scores)


def _score_exif_hint(exif_rotation: int | None) -> dict[int, float]:
    """Give a bonus to the EXIF-suggested rotation, if available."""
    scores = {0: 0.0, 90: 0.0, 180: 0.0, 270: 0.0}
    if exif_rotation is not None and exif_rotation in scores:
        scores[exif_rotation] = 1.0
    else:
        # No hint → uniform (no influence)
        scores = {k: 0.25 for k in scores}
    return _normalise(scores)


def _normalise(scores: dict[int, float]) -> dict[int, float]:
    """Normalise scores to [0, 1] range (max = 1)."""
    mx = max(scores.values())
    if mx < 1e-12:
        return {k: 0.0 for k in scores}
    return {k: v / mx for k, v in scores.items()}


# ---------------------------------------------------------------------------
# Main detection
# ---------------------------------------------------------------------------


def detect_orientation(image_path: str) -> dict:
    """
    Detect the correct upright orientation of an image.

    Returns dict with:
      rotation: int (0/90/180/270)
      confidence: float (0-1)
      scores: dict per-rotation composite scores
      breakdown: per-heuristic scores
    """
    try:
        img = Image.open(image_path)

        # Get EXIF hint before any transforms
        exif_rotation = _get_exif_rotation(img)

        # Prepare: grayscale + downscale
        gray_img = _downscale(img.convert("L"), ANALYSIS_SIZE)
        w, h = gray_img.size
        gray_arr = np.array(gray_img)

        # Generate all 4 rotations as numpy arrays
        gray_rotations: dict[int, np.ndarray] = {0: gray_arr}
        binary_rotations: dict[int, np.ndarray] = {0: _to_binary(gray_arr)}

        for angle in [90, 180, 270]:
            # PIL rotates counter-clockwise, so 90° CCW = np.rot90 once
            k = angle // 90
            rotated = np.rot90(gray_arr, k=k)
            gray_rotations[angle] = rotated
            binary_rotations[angle] = _to_binary(rotated)

        # Score each heuristic
        proj_scores = _score_projection_profile(binary_rotations)
        edge_scores = _score_edge_histogram(gray_rotations)
        comp_scores = _score_connected_components(binary_rotations)
        aspect_scores = _score_aspect_ratio(w, h)
        exif_scores = _score_exif_hint(exif_rotation)

        # Composite weighted score
        composite: dict[int, float] = {}
        for angle in [0, 90, 180, 270]:
            composite[angle] = (
                W_PROJECTION * proj_scores[angle]
                + W_EDGE * edge_scores[angle]
                + W_COMPONENTS * comp_scores[angle]
                + W_ASPECT * aspect_scores[angle]
                + W_EXIF * exif_scores[angle]
            )

        # Pick winner
        best_angle = max(composite, key=composite.get)  # type: ignore[arg-type]
        best_score = composite[best_angle]

        # Confidence = how much better the best is vs the runner-up
        sorted_scores = sorted(composite.values(), reverse=True)
        if len(sorted_scores) >= 2 and sorted_scores[0] > 1e-9:
            margin = (sorted_scores[0] - sorted_scores[1]) / sorted_scores[0]
        else:
            margin = 0.0

        confidence = min(1.0, best_score * (0.5 + 0.5 * margin))

        return {
            "rotation": best_angle,
            "confidence": round(confidence, 3),
            "scores": {str(k): round(v, 4) for k, v in composite.items()},
            "exifHint": exif_rotation,
            "breakdown": {
                "projection": {str(k): round(v, 4) for k, v in proj_scores.items()},
                "edge": {str(k): round(v, 4) for k, v in edge_scores.items()},
                "components": {str(k): round(v, 4) for k, v in comp_scores.items()},
                "aspect": {str(k): round(v, 4) for k, v in aspect_scores.items()},
                "exif": {str(k): round(v, 4) for k, v in exif_scores.items()},
            },
        }

    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect image orientation")
    parser.add_argument("image_path", help="Path to input image")
    args = parser.parse_args()

    result = detect_orientation(args.image_path)
    print(json.dumps(result))
