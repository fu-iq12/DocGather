
import sys
import pdfplumber
import re

def is_garbage_line(line):
    if not line or len(line.strip()) < 3:
        return False
    # Count alnum
    alnum = sum(1 for c in line if c.isalnum())
    # Count valid punctuation
    valid_punct = sum(1 for c in line if c in ".,:;-'\"?!/@() ")
    # Count noise (everything else)
    total = len(line)
    noise = total - alnum - valid_punct
    
    # If noise ratio > 30%, it's garbage
    if noise / total > 0.3:
        return True
    # If alphanumeric ratio < 50%, suspicious (unless it's a list of numbers/dates, but even then)
    if alnum / total < 0.5:
        return True
    return False

def analyze(pdf_path):
    print(f"Testing Heuristics on: {pdf_path}")
    with pdfplumber.open(pdf_path) as pdf:
        sample_pages = pdf.pages[:3]
        all_text = ""
        chars_per_page = []
        
        for p in sample_pages:
            t = p.extract_text() or ""
            all_text += t + "\n"
            chars_per_page.append(len(t.strip()))
            
        print(f"Chars per page: {chars_per_page}")
        
        # 1. Page Consistency
        min_chars = min(chars_per_page) if chars_per_page else 0
        if len(chars_per_page) > 1 and min_chars < 50:
            print(f"FAIL: Consistency check. Min chars {min_chars} < 50")
        else:
            print("PASS: Consistency check")

        # 2. Garbage Analysis
        lines = [l.strip() for l in all_text.split('\n') if l.strip()]
        total_lines = len(lines)
        if total_lines == 0:
            print("No text lines.")
            return

        bad_lines = 0
        print("\n--- Bad Line Detection ---")
        for line in lines:
            if is_garbage_line(line):
                bad_lines += 1
                print(f"[BAD] {line}")
            else:
                # print(f"[OK]  {line}")
                pass
        
        garbage_ratio = bad_lines / total_lines
        print(f"\nBad Lines: {bad_lines}/{total_lines} ({garbage_ratio:.2%})")
        
        if garbage_ratio > 0.2: # 20% threshold
            print("FAIL: Garbage check (> 20%)")
        else:
            print("PASS: Garbage check")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        analyze(sys.argv[1])
