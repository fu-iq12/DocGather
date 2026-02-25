import sys
import extract_msg
import email
from email import policy
from pathlib import Path
from bs4 import BeautifulSoup
import argparse

def eml_to_html(input_path, output_path):
    with open(input_path, 'rb') as f:
        msg = email.message_from_binary_file(f, policy=policy.default)
    
    html_content = ""
    text_content = ""
    
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            html_content = part.get_content()
            break
        elif part.get_content_type() == "text/plain":
            text_content = part.get_content()
            
    content = html_content if html_content else f"<pre>{text_content}</pre>"
    
    # Wrap in basic HTML structure if not already present
    if not "<html" in content.lower():
        content = f"<html><body>{content}</body></html>"
        
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

def msg_to_html(input_path, output_path):
    msg = extract_msg.Message(input_path)
    
    html_content = msg.htmlBody
    if html_content:
        if isinstance(html_content, bytes):
            html_content = html_content.decode('utf-8', errors='ignore')
    else:
        text_content = msg.body
        html_content = f"<pre>{text_content}</pre>" if text_content else "<html><body></body></html>"
        
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert Email (.eml/.msg) to HTML")
    parser.add_argument("input", help="Input file path")
    parser.add_argument("output", help="Output HTML file path")
    args = parser.parse_args()
    
    input_path = Path(args.input)
    
    if input_path.suffix.lower() == '.msg':
        msg_to_html(args.input, args.output)
    else: # Assume .eml by default
        eml_to_html(args.input, args.output)
