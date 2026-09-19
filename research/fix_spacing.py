#!/usr/bin/env python3
"""
Remove excessive blank lines from newserver.py
"""

import re

# Read the file
with open('newserver.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace sequences of 3 or more newlines with 2 newlines (one blank line)
content = re.sub(r'\n{3,}', '\n\n', content)

# Write back
with open('newserver.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed spacing in newserver.py")
