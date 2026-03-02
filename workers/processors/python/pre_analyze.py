"""
PDF topology pre-analyzer driving orchestrator heuristics.
Inspects page boundaries, text density, and image distributions to route documents
for structural splitting, native extraction, or vision OCR pipelines.

Two-pass architecture:
  Pass 1: Gather per-page info (text, images with cover/position/overlap, mode heuristic)
  Pass 2: Group consecutive same-mode pages into document entries

@see architecture/details/document-types-and-processing.md - "Simplified Flow"
"""

import sys
import json
import pdfplumber
try:
    from langdetect import detect
except ImportError:
    detect = None


# ============================================================================
# Tool Functions (unchanged)
# ============================================================================

def get_effective_bbox(page):
    """Return (x0, top, x1, bottom) from CropBox if it differs from MediaBox, else MediaBox."""
    cb = page.cropbox  # (x0, top, x1, bottom) in pdfplumber coords
    mb = page.mediabox
    if cb and cb != mb:
        return cb
    return mb

def is_within_bounds(obj_bbox, page_bbox, tolerance=2):
    """Check if an object bbox overlaps with the effective page bounds."""
    ox0, otop, ox1, obot = obj_bbox
    px0, ptop, px1, pbot = page_bbox
    return (ox1 > px0 + tolerance and ox0 < px1 - tolerance and
            obot > ptop + tolerance and otop < pbot - tolerance)


# ============================================================================
# New Helper Functions
# ============================================================================

def compute_page_area(page):
    """Return (x0, top, x1, bottom, width, height, area) for the inner page region.
    Uses the intersection of MediaBox and effective CropBox."""
    mb = page.mediabox
    cb = get_effective_bbox(page)
    x0 = max(mb[0], cb[0])
    top = max(mb[1], cb[1])
    x1 = min(mb[2], cb[2])
    bot = min(mb[3], cb[3])
    w = max(x1 - x0, 0)
    h = max(bot - top, 0)
    return x0, top, x1, bot, w, h, max(w * h, 1.0)


def classify_image_position(img_bbox, page_bbox, is_landscape):
    """Determine position label for an image relative to the page midline.
    - Landscape pages: left/right (center if crosses horizontal midline)
    - Portrait pages: top/bottom (center if crosses vertical midline)
    """
    px0, ptop, px1, pbot = page_bbox
    ix0, itop, ix1, ibot = img_bbox
    if is_landscape:
        mid = (px0 + px1) / 2
        if ix0 < mid and ix1 > mid:
            return "center"
        return "left" if ix1 <= mid else "right"
    else:
        mid = (ptop + pbot) / 2
        if itop < mid and ibot > mid:
            return "center"
        return "top" if ibot <= mid else "bottom"


def compute_text_overlap(chars, img_bbox):
    """Count characters whose bbox intersects a given image bbox."""
    ix0, itop, ix1, ibot = img_bbox
    count = 0
    for c in chars:
        if (c['x0'] < ix1 and c['x1'] > ix0 and
                c['top'] < ibot and c['bottom'] > itop):
            count += 1
    return count


def merge_touching_bboxes(bboxes):
    """Merge overlapping or touching image bboxes.
    Skip a merge if the combined bbox introduces too much dead space:
    reject when (merged_area - area_a - area_b) > min(area_a, area_b)."""
    if len(bboxes) <= 1:
        return list(bboxes)

    def bbox_area(b):
        return max(b[2] - b[0], 0) * max(b[3] - b[1], 0)

    def touches_or_overlaps(a, b):
        """True if bboxes touch (share an edge) or overlap."""
        return (a[0] <= b[2] and a[2] >= b[0] and
                a[1] <= b[3] and a[3] >= b[1])

    def merge_pair(a, b):
        return (min(a[0], b[0]), min(a[1], b[1]),
                max(a[2], b[2]), max(a[3], b[3]))

    merged = list(bboxes)
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(merged):
            j = i + 1
            while j < len(merged):
                if touches_or_overlaps(merged[i], merged[j]):
                    area_a = bbox_area(merged[i])
                    area_b = bbox_area(merged[j])
                    candidate = merge_pair(merged[i], merged[j])
                    dead_space = bbox_area(candidate) - area_a - area_b
                    if dead_space <= min(area_a, area_b):
                        merged[i] = candidate
                        merged.pop(j)
                        changed = True
                        continue  # re-check j index
                j += 1
            i += 1
    return merged


# ============================================================================
# Pass 1: Gather per-page info
# ============================================================================

def gather_page_info(pdf):
    """Iterate all pages once and build an array of per-page analysis dicts."""
    page_infos = []

    for i, page in enumerate(pdf.pages):
        page_num = i + 1
        px0, ptop, px1, pbot, pw, ph, page_area = compute_page_area(page)
        page_bbox = (px0, ptop, px1, pbot)
        is_landscape = pw > ph

        chars = page.chars
        text = page.extract_text() or ""
        text_length = len(text.strip())

        # Gather bbox of within bounds images
        image_bboxes = []
        for img in (page.images or []):
            img_bbox = (float(img['x0']), float(img['top']),
                        float(img['x1']), float(img['bottom']))
            if not is_within_bounds(img_bbox, page_bbox):
                continue
            image_bboxes.append(img_bbox)

        # Merge touching/overlapping image bboxes
        image_bboxes = merge_touching_bboxes(image_bboxes)

        # Keep images with cover > 25%
        images_info = []
        for img_bbox in (image_bboxes):
            iw = img_bbox[2] - img_bbox[0]
            ih = img_bbox[3] - img_bbox[1]
            cover = round((iw * ih) / page_area, 3)
            if cover < 0.25:
                continue
            position = classify_image_position(img_bbox, page_bbox, is_landscape)
            overlap_len = compute_text_overlap(chars, img_bbox)
            images_info.append({
                "cover": cover,
                "position": position,
                "text_overlap": overlap_len,
                # "bbox": img_bbox,
            })

        # Mode heuristic (first matching rule)
        positions = [img["position"] for img in images_info]
        has_lr = "left" in positions and "right" in positions
        has_tb = "top" in positions and "bottom" in positions
        has_center = "center" in positions

        if len(images_info) == 0 and text_length < 20:
            mode = "discard"
        elif (has_lr or has_tb) and not has_center:
            mode = "split"
        elif (images_info
              and all(img["text_overlap"] > 200 for img in images_info)
              and (text_length - sum(img["text_overlap"] for img in images_info)) < 20):
            mode = "text"
        elif len(images_info) > 0:
            mode = "ocr"
        else:
            mode = "text"

        page_infos.append({
            "page_num": page_num,
            "text": text,
            "text_length": text_length,
            "images": images_info,
            "mode": mode,
            "is_landscape": is_landscape,
        })

    return page_infos


# ============================================================================
# Pass 2: Build documents array from page_infos
# ============================================================================

def build_documents(page_infos):
    """Group consecutive pages by compatible mode into the documents array.
    Also computes textQuality and language."""
    documents = []
    all_text = ""  # collect text for language detection

    # Accumulators for grouping consecutive same-type pages
    current_group_pages = []
    current_group_type = None  # "document" or "full_page"

    def flush_group():
        nonlocal current_group_pages, current_group_type
        if current_group_pages:
            documents.append({
                "pages": current_group_pages,
                "type": current_group_type,
            })
            current_group_pages = []
            current_group_type = None

    for info in page_infos:
        mode = info["mode"]
        page_num = info["page_num"]
        text = info["text"]
        text_length = info["text_length"]
        images = info["images"]

        # print(info)

        if mode == "discard":
            continue

        all_text += text + "\n"

        if mode == "split":
            flush_group()
            # Split direction from page orientation
            if info["is_landscape"]:
                documents.append({"pages": [page_num], "type": "left_half"})
                documents.append({"pages": [page_num], "type": "right_half"})
            else:
                documents.append({"pages": [page_num], "type": "top_half"})
                documents.append({"pages": [page_num], "type": "bottom_half"})

        elif mode == "text":
            doc_type = "document"
            if current_group_type == doc_type:
                current_group_pages.append(page_num)
            else:
                flush_group()
                current_group_type = doc_type
                current_group_pages = [page_num]

        elif mode == "ocr":
            doc_type = "full_page"
            if current_group_type == doc_type:
                current_group_pages.append(page_num)
            else:
                flush_group()
                current_group_type = doc_type
                current_group_pages = [page_num]

    flush_group()

    all_text = all_text.strip()

    return documents, all_text


# ============================================================================
# Main Analysis Entry Point
# ============================================================================

def analyze_pdf(pdf_path: str) -> dict:
    """Analyze PDF and return pre-analysis results."""
    result = {
        "isMultiDocument": False,
        "documentCount": 1,
        "pageCount": 0,
        "hasTextLayer": False,
        "textQuality": "none",
        "totalTextLength": 0,
        "language": "unknown",
        "documents": None,
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            result["pageCount"] = len(pdf.pages)

            # Pass 1: Gather per-page info
            page_infos = gather_page_info(pdf)

            # Pass 2: Build documents
            documents, all_text = build_documents(page_infos)
            
            total_text_length = len(all_text)

            # Determine text quality
            if total_text_length > 2000:
                result["textQuality"] = "best"
                result["hasTextLayer"] = True
            elif total_text_length > 200:
                result["textQuality"] = "good"
                result["hasTextLayer"] = True
            elif total_text_length > 20:
                result["textQuality"] = "poor"
                result["hasTextLayer"] = True
            else:
                result["textQuality"] = "none"
                result["hasTextLayer"] = False

            result["totalTextLength"] = total_text_length

            # Language detection on full concatenated text
            if total_text_length > 50 and detect:
                try:
                    all_text = ""
                    for page in pdf.pages:
                        all_text += (page.extract_text() or "") + "\n"
                    result["language"] = detect(all_text.strip())
                except Exception:
                    result["language"] = "unknown"

            # Multi-document decision
            if len(documents) > 1:
                result["isMultiDocument"] = True
                result["documentCount"] = len(documents)
                result["documents"] = documents
            else:
                result["isMultiDocument"] = False
                result["documents"] = documents

    except Exception as e:
        result["error"] = str(e)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = analyze_pdf(pdf_path)
    print(json.dumps(result))
