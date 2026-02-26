"""
First-page PDF rasterization utility via pdf2image.
Downscales and transcodes into highly compressed WebP format for LLM vision optimization.

@see architecture/details/document-types-and-processing.md - "Image Scaling Strategy"
"""
import sys
import json
import argparse
from pathlib import Path
from pdf2image import convert_from_path

def convert_pdf_to_image(pdf_path, output_dir):
    try:
        # 1. Convert first page to image (300 DPI)
        # fmt='webp' is not supported by pdf2image directly save, 
        # it returns PIL images.
        images = convert_from_path(pdf_path, first_page=1, last_page=1, dpi=300, grayscale=True, size=int(args.size))
        
        if not images:
            return {"error": "No images extracted from PDF"}
            
        img = images[0]
        original_width, original_height = img.size

        # 3. Save as WebP
        output_filename = "page_1.webp"
        output_path = Path(output_dir) / output_filename
        
        img.save(output_path, "WEBP", quality=85, method=6) # 6 is the best compression method
        
        return {
            "scaledPath": str(output_path),
            "originalDimensions": {"width": original_width, "height": original_height},
            "scaledDimensions": {"width": original_width, "height": original_height},
            "fileSize": output_path.stat().st_size
        }
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path", help="Path to input PDF")
    parser.add_argument("--output_dir", help="Directory for output image", default=".")
    parser.add_argument("--size", help="Size of the image", default="1280")
    args = parser.parse_args()
    
    result = convert_pdf_to_image(args.pdf_path, args.output_dir)
    print(json.dumps(result))
