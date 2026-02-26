"""
PDF topology pre-analyzer driving orchestrator heuristics.
Inspects page boundaries, text density, and image distributions to route documents
for structural splitting, native extraction, or vision OCR pipelines.

@see architecture/details/document-types-and-processing.md - "Simplified Flow"
"""

import sys
import json
import pdfplumber
try:
    from langdetect import detect
except ImportError:
    detect = None

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
    # Check for intersection
    return (ox1 > px0 + tolerance and ox0 < px1 - tolerance and
            obot > ptop + tolerance and otop < pbot - tolerance)

def analyze_pdf(pdf_path: str) -> dict:
    """Analyze PDF and return pre-analysis results."""
    result = {
        "isMultiDocument": False,
        "documentCount": 1,
        "pageCount": 0,
        "hasTextLayer": False,
        "textQuality": "none",
        "language": "unknown",
        "documents": None, 
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            result["pageCount"] = len(pdf.pages)

            # Extract text from first 3 pages for analysis
            sample_pages = pdf.pages[:3]
            all_text = ""
            chars_per_page = []

            for page in sample_pages:
                # Get all images on the page
                images = page.images
                
                # Get all characters
                chars = page.chars
                
                filtered_text = ""
                
                # If there are images, filter out text that overlaps with them
                if images:
                    for char in chars:
                        char_bbox = (char['x0'], char['top'], char['x1'], char['bottom'])
                        is_overlapping = False
                        
                        for img in images:
                            img_bbox = (img['x0'], img['top'], img['x1'], img['bottom'])
                            
                            # Check for intersection
                            # x0 < x1_img AND x1 > x0_img AND top < bottom_img AND bottom > top_img
                            if (char_bbox[0] < img_bbox[2] and 
                                char_bbox[2] > img_bbox[0] and
                                char_bbox[1] < img_bbox[3] and 
                                char_bbox[3] > img_bbox[1]):
                                is_overlapping = True
                                break
                        
                        if not is_overlapping:
                            filtered_text += char['text']
                else:
                    # No images, use raw text extraction (faster)
                    filtered_text = page.extract_text() or ""

                all_text += filtered_text + "\n"
                chars_per_page.append(len(filtered_text.strip()))

            text_length = len(all_text.strip())

            # Debug print (optional, can be removed or kept for logs)
            # print(all_text)
            # Determine text layer quality
            if text_length > 2000:
                 result["textQuality"] = "best"
                 result["hasTextLayer"] = True
            elif text_length > 200:
                result["textQuality"] = "good"
                result["hasTextLayer"] = True
            elif text_length < 20:
                result["textQuality"] = "poor"
                result["hasTextLayer"] = False
            else:
                result["textQuality"] = "none"
                result["hasTextLayer"] = False

            # Language detection (if we have enough text)
            if float(text_length) > 50 and detect:
                try:
                    result["language"] = detect(all_text)
                except Exception:
                    # langdetect might fail on certain texts
                    result["language"] = "unknown"

            # Multi-document detection heuristic
            # Logic:
            # 1. "Best" text tier (>2000 chars) -> 1 or more successive pages = 1 document.
            # 2. Others: Check for split (Top/Bottom or Left/Right).
            # 3. Else: Full page = 1 document.
            
            documents = []
            
            # Constants for gap detection
            GAP_TOLERANCE = 5      # pts – merge images within 5 pts of each other
            MIN_GAP_RATIO = 0.01   # require 1% of page dimension as minimum gap

            def get_gap(intervals, total_length):
                """Check if images form two distinct groups separated by a
                meaningful gap around the page midpoint.
                Returns True only if there is a real visual gap suggesting
                two separate documents."""
                if not intervals:
                    return False

                intervals = sorted(intervals, key=lambda x: x[0])
                mid = total_length / 2

                # 1. If any single interval covers the midpoint, no split
                for start, end in intervals:
                    if start < mid and end > mid:
                        return False

                # 2. Merge intervals with tolerance (handles adjacent/near-adjacent images)
                merged = []
                curr_start, curr_end = intervals[0]
                for next_start, next_end in intervals[1:]:
                    if next_start <= curr_end + GAP_TOLERANCE:
                        curr_end = max(curr_end, next_end)
                    else:
                        merged.append((curr_start, curr_end))
                        curr_start, curr_end = next_start, next_end
                merged.append((curr_start, curr_end))

                # 3. After merge, if any merged interval covers mid → no split
                for start, end in merged:
                    if start < mid and end > mid:
                        return False

                # 4. Need intervals on both sides with a meaningful gap around mid
                min_gap = total_length * MIN_GAP_RATIO
                has_before = any(end <= mid for start, end in merged)
                has_after = any(start >= mid for start, end in merged)
                if has_before and has_after:
                    for i in range(len(merged) - 1):
                        gap = merged[i + 1][0] - merged[i][1]
                        if gap >= min_gap and merged[i][1] <= mid and merged[i + 1][0] >= mid:
                            return True
                return False

            current_text_doc_pages = []
            current_text_doc_covers = []

            # for i, page in enumerate(pdf.pages):
            for i, page in enumerate(pdf.pages):
                page_num = i + 1 # 1-based index
                
                # Check text length for this page
                # extract_text can be partial if not clean
                p_text = page.extract_text() or ""
                p_len = len(p_text.strip())
                
                # Calculate page area with margins (mediabox)
                mb_x0, mb_top, mb_x1, mb_bottom = page.mediabox
                page_area = max((mb_x1 - mb_x0) * (mb_bottom - mb_top), 1.0)
                
                # Analyze intervals and effective bounds for cropping
                eff = get_effective_bbox(page)
                page_x0, page_top, page_x1, page_bottom = eff
                page_w = page_x1 - page_x0
                page_h = page_bottom - page_top
                
                y_intervals = []
                x_intervals = []
                relevant_images_count = 0
                total_img_area = 0.0

                if page.images:
                    for img in page.images:
                        img_bbox = (float(img['x0']), float(img['top']), float(img['x1']), float(img['bottom']))
                        
                        # Filter out images outside the crop zone
                        if not is_within_bounds(img_bbox, eff):
                            continue
                            
                        x0, top, x1, bottom = img_bbox
                        w = x1 - x0
                        h = bottom - top
                        total_img_area += (w * h)
                        
                        if w < 20 or h < 20: continue
                        relevant_images_count += 1
                        y_intervals.append((top, bottom))
                        x_intervals.append((x0, x1))
                        
                image_cover_perc = round(min(100.0, (total_img_area / page_area) * 100), 2)
                
                # Drop pages with poor text quality and poor image cover
                if p_len < 20 and image_cover_perc < 25.0:
                    continue
                
                # Prioritize document type if text quality is best OR (good text and poor image cover)
                if p_len > 2000 or (p_len > 200 and image_cover_perc < 25.0):
                    current_text_doc_pages.append(page_num)
                    current_text_doc_covers.append(image_cover_perc)
                    continue
                else:
                    # If we have accumulated text pages, flush them
                    if current_text_doc_pages:
                        avg_cover = round(sum(current_text_doc_covers) / len(current_text_doc_covers), 2)
                        documents.append({
                            "pages": current_text_doc_pages,
                            "type": "document",
                            "image_cover": avg_cover
                        })
                        current_text_doc_pages = []
                        current_text_doc_covers = []
                    
                    # Process this non-text-heavy page
                    if relevant_images_count < 2:
                        documents.append({"pages": [page_num], "type": "full_page", "image_cover": image_cover_perc})
                        continue
                        
                    # Check splits
                    if get_gap(y_intervals, page_h):
                        documents.append({"pages": [page_num], "type": "top_half", "image_cover": image_cover_perc})
                        documents.append({"pages": [page_num], "type": "bottom_half", "image_cover": image_cover_perc})
                    elif get_gap(x_intervals, page_w):
                        documents.append({"pages": [page_num], "type": "left_half", "image_cover": image_cover_perc})
                        documents.append({"pages": [page_num], "type": "right_half", "image_cover": image_cover_perc})
                    else:
                        documents.append({"pages": [page_num], "type": "full_page", "image_cover": image_cover_perc})

            # Flush leftover text pages
            if current_text_doc_pages:
                avg_cover = round(sum(current_text_doc_covers) / len(current_text_doc_covers), 2)
                documents.append({
                    "pages": current_text_doc_pages,
                    "type": "document",
                    "image_cover": avg_cover
                })

            # Decision
            # If detected documents count > 1, then it's multi-doc logic
            # OR if we found actual splits. 
            # If we just found 1 text doc (pages 1-10), it is Single Doc.
            
            if len(documents) > 1:
                result["isMultiDocument"] = True
                result["documentCount"] = len(documents)
                result["documents"] = documents
            else:
                result["isMultiDocument"] = False
                result["documents"] = documents # Optional, but good for debug

    except Exception as e:
        # Return minimal result on error
        result["error"] = str(e)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = analyze_pdf(pdf_path)
    print(json.dumps(result))
