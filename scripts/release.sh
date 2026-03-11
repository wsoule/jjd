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

# Compute SHA256s (individual vars — compatible with bash 3.2 on macOS)
echo "==> SHA256 checksums"
SHA_DARWIN_ARM64=$(shasum -a 256 "$DIST/jjd-darwin-arm64.tar.gz" | awk '{print $1}')
SHA_DARWIN_X64=$(shasum -a 256 "$DIST/jjd-darwin-x64.tar.gz"    | awk '{print $1}')
SHA_LINUX_ARM64=$(shasum -a 256 "$DIST/jjd-linux-arm64.tar.gz"  | awk '{print $1}')
SHA_LINUX_X64=$(shasum -a 256   "$DIST/jjd-linux-x64.tar.gz"   | awk '{print $1}')
echo "  darwin-arm64: ${SHA_DARWIN_ARM64}"
echo "  darwin-x64:   ${SHA_DARWIN_X64}"
echo "  linux-arm64:  ${SHA_LINUX_ARM64}"
echo "  linux-x64:    ${SHA_LINUX_X64}"

# Update formula — version + 4 sha256 lines in order: darwin-arm64, darwin-x64, linux-arm64, linux-x64
echo "==> Updating Formula/jjd.rb"
FORMULA="Formula/jjd.rb"
sed -i '' "s/version \".*\"/version \"${VERSION}\"/" "$FORMULA"

python3 - <<PYEOF
import re

with open('${FORMULA}') as f:
    content = f.read()

shas = [
    '${SHA_DARWIN_ARM64}',
    '${SHA_DARWIN_X64}',
    '${SHA_LINUX_ARM64}',
    '${SHA_LINUX_X64}',
]

sha_pattern = r'sha256 "[a-fA-F0-9]+"|sha256 "PLACEHOLDER"'
matches = list(re.finditer(sha_pattern, content))

for i, sha in enumerate(shas):
    if i < len(matches):
        content = content.replace(matches[i].group(), f'sha256 "{sha}"', 1)

with open('${FORMULA}', 'w') as f:
    f.write(content)
PYEOF

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
