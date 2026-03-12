#!/usr/bin/env python3
"""
Update Formula/jjd.rb with the new version and SHA256 checksums.
Reads values from environment variables set by the release workflow.

Expected env vars:
  VERSION           e.g. "0.2.0"
  SHA_DARWIN_ARM64
  SHA_DARWIN_X64
  SHA_LINUX_ARM64
  SHA_LINUX_X64
  FORMULA_PATH      path to the formula file to update
"""
import re
import os
import sys

VERSION          = os.environ["VERSION"]
SHA_DARWIN_ARM64 = os.environ["SHA_DARWIN_ARM64"]
SHA_DARWIN_X64   = os.environ["SHA_DARWIN_X64"]
SHA_LINUX_ARM64  = os.environ["SHA_LINUX_ARM64"]
SHA_LINUX_X64    = os.environ["SHA_LINUX_X64"]
formula_path     = os.environ.get("FORMULA_PATH", sys.argv[1] if len(sys.argv) > 1 else "Formula/jjd.rb")

# SHA order must match the formula: darwin-arm64, darwin-x64, linux-arm64, linux-x64
shas = [SHA_DARWIN_ARM64, SHA_DARWIN_X64, SHA_LINUX_ARM64, SHA_LINUX_X64]

with open(formula_path) as f:
    content = f.read()

content = re.sub(r'version "[^"]*"', f'version "{VERSION}"', content)

matches = list(re.finditer(r'sha256 "[a-fA-F0-9]+"', content))
for i, sha in enumerate(shas):
    if i < len(matches):
        content = content.replace(matches[i].group(), f'sha256 "{sha}"', 1)

with open(formula_path, "w") as f:
    f.write(content)

print(f"Formula updated: v{VERSION}")
print(f"  darwin-arm64: {SHA_DARWIN_ARM64}")
print(f"  darwin-x64:   {SHA_DARWIN_X64}")
print(f"  linux-arm64:  {SHA_LINUX_ARM64}")
print(f"  linux-x64:    {SHA_LINUX_X64}")
