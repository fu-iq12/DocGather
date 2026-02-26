"""
Native PDF text extraction driver utilizing pdfplumber.
Yields layout-preserved formatted text for digital-native documents, bypassing OCR fallbacks.

@see architecture/details/document-types-and-processing.md - "Processing Paths by MIME Type"
"""

import sys
import json
import pdfplumber


def extract_text(pdf_path: str) -> dict:
    """Extract text from PDF and return results."""
    result = {
        "text": "",
        "pageCount": 0,
        "hasTextLayer": False,
        "textQuality": "poor",
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            result["pageCount"] = len(pdf.pages)
            full_text = []

            for page in pdf.pages:
                # Extract text using basic layout-preserving method
                page_text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""
                
                # Add page marker for downstream context
                full_text.append(f"--- PAGE {page.page_number} ---")
                full_text.append(page_text)
            
            result["text"] = "\n".join(full_text)
            
            # Simple quality check based on text length relative to pages
            text_length = len(result["text"])
            avg_text_per_page = text_length / max(1, result["pageCount"])
            
            # If we have reasonable amount of text, assume good quality/text layer
            if avg_text_per_page > 50:
                result["hasTextLayer"] = True
                result["textQuality"] = "good"
            elif avg_text_per_page > 0:
                result["hasTextLayer"] = True
                result["textQuality"] = "poor"
            else:
                result["hasTextLayer"] = False
                result["textQuality"] = "poor"

    except Exception as e:
        result["error"] = str(e)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = extract_text(pdf_path)
    print(json.dumps(result))
