#!/usr/bin/env python3
"""
Direct spreadsheet extraction driver utilizing pandas.
Dumps distinct worksheets into dense, token-optimized Markdown tables for LLM normalization.

@see architecture/details/document-types-and-processing.md - "Special Format Handling"
"""
import os
import sys
import pandas as pd

import traceback

def extract_xlsx(input_path: str):
    # read_excel with sheet_name=None reads all sheets into a dict of DataFrames
    engine = 'pyxlsb' if input_path.lower().endswith('.xlsb') else 'openpyxl'
    sheets = pd.read_excel(input_path, sheet_name=None, engine=engine)
    
    import re
    
    sheet_lines = {}
    total_size = 0
    
    for sheet_name, df in sheets.items():
        # Drop purely empty columns and rows to reduce noise
        df.dropna(how='all', axis=1, inplace=True)
        df.dropna(how='all', axis=0, inplace=True)
        
        if df.empty:
            continue
            
        # Round floating point numbers to max 2 decimals, even in object columns
        def round_float(val):
            if isinstance(val, float):
                return round(val, 2)
            return val
        
        if hasattr(df, 'map'):
            df = df.map(round_float)
        else:
            df = df.applymap(round_float)
        
        # Fill NaN with empty string
        df = df.astype(object).fillna("")
        
        # Convert to markdown
        md = df.to_markdown(index=False)
        
        # Compress multiple spaces to a single space to save LLM tokens (preserves newlines)
        md = re.sub(r' {2,}', ' ', md)
        
        lines = [f"## Sheet: {sheet_name}"] + md.split("\n") + [""]
        sheet_lines[sheet_name] = lines
        
        total_size += sum(len(line) + 1 for line in lines)
        
    # Hard cap at 50k characters
    while total_size > 50000:
        max_sheet = max(
            (s for s in sheet_lines if sheet_lines[s]), 
            key=lambda s: len(sheet_lines[s]), 
            default=None
        )
        if not max_sheet:
            break
            
        popped = sheet_lines[max_sheet].pop()
        total_size -= (len(popped) + 1)
        
    final_lines = []
    for sheet_name in sheets:
        if sheet_name in sheet_lines and sheet_lines[sheet_name]:
            final_lines.extend(sheet_lines[sheet_name])
            
    print("\n".join(final_lines))

def fix_xlsx_empty_styles(path):
    """
    Deal with invalid empty Fill values in Excel files
    Handles multiple problematic patterns:
    1. <x:fill /> empty tags
    2. <fills><fill/></fills> patterns with empty fill tags
    3. <fill></fill> or <fill/> tags within fills sections
    """

    import re
    import zipfile
    from tempfile import NamedTemporaryFile

    with NamedTemporaryFile(delete=False) as tmp:
        tmp_name = tmp.name
        
    zin = zipfile.ZipFile(path, "r")
    zout = zipfile.ZipFile(tmp_name, "w")
    for item in zin.infolist():
        buffer = zin.read(item.filename)
        if item.filename == "xl/styles.xml":
            styles = buffer.decode("utf-8")
            
            # Remove problematic standalone empty tags
            styles = styles.replace("<x:fill />", "")
            # Fix empty fill tags within fills sections using regex
            pattern = re.compile(r'(<fills[^>]*>)(.*?)(</fills>)', re.DOTALL)
            matches = pattern.finditer(styles)
            
            result = ""
            last_end = 0
            for match in matches:
                # Add text before this match
                result += styles[last_end:match.start()]
                
                # Extract components
                fills_start = match.group(1)
                fills_content = match.group(2)
                fills_end = match.group(3)
                
                # Replace empty fill tags with proper pattern fill
                fixed_content = re.sub(
                    r'<fill\s*/>|<fill>\s*</fill>',
                    '<fill><patternFill patternType="none"/></fill>',
                    fills_content
                )
                
                # Add fixed content
                result += fills_start + fixed_content + fills_end
                last_end = match.end()
            
            # Add any remaining content
            result += styles[last_end:]
            styles = result if result else styles
            
            buffer = styles.encode("utf-8")
        zout.writestr(item, buffer)
    zout.close()
    zin.close()
    return tmp_name

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: extract_xlsx.py <input.xlsx|input.xlsb>")
        sys.exit(1)
        
    input_file = sys.argv[1]
    try:
        extract_xlsx(input_file)
    except Exception as e:
        # deal with error: expected <class 'openpyxl.styles.fills.Fill'>
        # cf. https://github.com/pandas-dev/pandas/issues/40499
        input_file = fix_xlsx_empty_styles(input_file)
        # print(f"Fixed spreadsheet: {input_file}", file=sys.stderr)
        try:
            extract_xlsx(input_file)
        except Exception as e:
            print(f"Error reading spreadsheet: {e}", file=sys.stderr)
            sys.exit(1)
        os.remove(input_file)
