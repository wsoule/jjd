#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/release.sh <version>}"
TAG="v${VERSION}"
DIST="dist/release"

echo "==> Building jjd ${TAG}"

rm -rf "$DIST"
mkdir -p "$DIST"

# Build all targets
echo "  Building darwin-arm64..."
bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile "$DIST/jjd-darwin-arm64/jjd"

echo "  Building darwin-x64..."
bun build src/index.ts --compile --target=bun-darwin-x64 --outfile "$DIST/jjd-darwin-x64/jjd"

echo "  Building linux-x64..."
bun build src/index.ts --compile --target=bun-linux-x64 --outfile "$DIST/jjd-linux-x64/jjd"

echo "  Building linux-arm64..."
bun build src/index.ts --compile --target=bun-linux-arm64 --outfile "$DIST/jjd-linux-arm64/jjd"

# Codesign macOS binaries (only works on macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "  Codesigning macOS binaries..."
  codesign --force --sign - "$DIST/jjd-darwin-arm64/jjd"
  codesign --force --sign - "$DIST/jjd-darwin-x64/jjd"
  xattr -cr "$DIST/jjd-darwin-arm64/jjd"
  xattr -cr "$DIST/jjd-darwin-x64/jjd"
fi

# Create tarballs
echo "==> Creating tarballs"
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  tar -czf "$DIST/jjd-${target}.tar.gz" -C "$DIST/jjd-${target}" jjd
done

# Compute SHA256s
echo "==> SHA256 checksums"
declare -A SHAS
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  SHA=$(shasum -a 256 "$DIST/jjd-${target}.tar.gz" | awk '{print $1}')
  SHAS[$target]="$SHA"
  echo "  ${target}: ${SHA}"
done

# Update formula
echo "==> Updating Formula/jjd.rb"
FORMULA="Formula/jjd.rb"
sed -i '' "s/version \".*\"/version \"${VERSION}\"/" "$FORMULA"

# Update SHAs in order: darwin-arm64, darwin-x64, linux-arm64, linux-x64
# The formula has 4 sha256 lines in platform order
python3 -c "
import re

with open('$FORMULA') as f:
    content = f.read()

shas = {
    'darwin-arm64': '${SHAS[darwin-arm64]}',
    'darwin-x64': '${SHAS[darwin-x64]}',
    'linux-arm64': '${SHAS[linux-arm64]}',
    'linux-x64': '${SHAS[linux-x64]}',
}

# Replace sha256 placeholders/values in order of appearance
sha_pattern = r'sha256 \"[a-fA-F0-9]+\"|sha256 \"PLACEHOLDER\"'
matches = list(re.finditer(sha_pattern, content))

# Order in formula: darwin-arm64, darwin-x64, linux-arm64, linux-x64
order = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']
for i, key in enumerate(order):
    if i < len(matches):
        old = matches[i].group()
        content = content.replace(old, f'sha256 \"{shas[key]}\"', 1)

with open('$FORMULA', 'w') as f:
    f.write(content)
"

echo "==> Creating GitHub release ${TAG}"
gh release create "$TAG" \
  "$DIST/jjd-darwin-arm64.tar.gz" \
  "$DIST/jjd-darwin-x64.tar.gz" \
  "$DIST/jjd-linux-x64.tar.gz" \
  "$DIST/jjd-linux-arm64.tar.gz" \
  --title "jjd ${TAG}" \
  --generate-notes

echo ""
echo "==> Done! Release ${TAG} created."
echo ""
echo "Next steps:"
echo "  1. Copy Formula/jjd.rb to your homebrew-tap repo"
echo "  2. Push the tap: cd <tap-repo> && git add . && git commit && git push"
echo "  3. Users install with: brew install wsoule/tap/jjd"
