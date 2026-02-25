
import sys
import pdfplumber
import re

def analyze_pdf_details(pdf_path):
    print(f"Analyzing: {pdf_path}")
    try:
        with pdfplumber.open(pdf_path) as pdf:
            print(f"Total Pages: {len(pdf.pages)}")
            
            for i, page in enumerate(pdf.pages):
                print(f"\n--- Page {i+1} ---")
                text = page.extract_text()
                raw_text_len = len(text) if text else 0
                print(f"Text Length: {raw_text_len}")
                
                if not text:
                    print("No text on this page.")
                    continue
                
                print("--- Text Sample (First 300 chars) ---")
                print(text[:300].replace('\n', '\\n'))
                print("--- Text Sample (Last 300 chars) ---")
                print(text[-300:].replace('\n', '\\n') if len(text) > 300 else "")
                
                # Heuristics Check
                # 1. Alphanumeric Ratio
                alnum_count = sum(1 for c in text if c.isalnum())
                ratio = alnum_count / raw_text_len if raw_text_len else 0
                print(f"Alphanumeric Ratio: {ratio:.2f}")

                # 2. Garbage characters (sequences of 3+ non-space non-alnum)
                garbage_seqs = re.findall(r'[^a-zA-Z0-9\s]{3,}', text)
                if garbage_seqs:
                    print(f"Found {len(garbage_seqs)} garbage sequences (sample): {garbage_seqs[:5]}")
                
                # 3. Char sizes and colors (first 5 chars)
                chars = page.chars[:5]
                for j, c in enumerate(chars):
                    print(f"Char {j}: '{c.get('text')}' Size: {c.get('size')} Font: {c.get('fontname')} Color: {c.get('non_stroking_color')}")

                # 4. Check for 'transparent' text (often used for OCR overlay)
                # Render mode 3 is invisible. Stroking/Non-Stroking color alpha=0 is invisible.
                # pdfplumber colors are tuples. (0,0,0) is black.
                # It doesn't always expose render mode directly in 'chars' list in all versions.

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        analyze_pdf_details(sys.argv[1])
