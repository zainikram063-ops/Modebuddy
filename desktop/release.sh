#!/bin/bash
# Builds ModeBuddy for Mac into desktop/release/: ModeBuddy-Intel.dmg and ModeBuddy-AppleSilicon.dmg
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('./package.json').version")
echo "Building ModeBuddy $VER"

# Speech helper that works on both Intel and Apple Silicon (one file)
swiftc -O native/mbspeech.swift -target x86_64-apple-macos12 -o native/mbspeech-x64
swiftc -O native/mbspeech.swift -target arm64-apple-macos12 -o native/mbspeech-arm64
lipo -create native/mbspeech-x64 native/mbspeech-arm64 -output native/mbspeech
rm -f native/mbspeech-x64 native/mbspeech-arm64

rm -rf release && mkdir -p release
for ARCH in x64 arm64; do
  NAME=$([ "$ARCH" = arm64 ] && echo AppleSilicon || echo Intel)
  echo "== Building for $NAME =="
  rm -rf dist
  npx electron-builder --mac dir --"$ARCH"
  APP=$(find dist -maxdepth 2 -name "ModeBuddy.app" | head -1)
  # Sign everything (free "ad-hoc" signature, needed for Apple Silicon)
  find "$APP/Contents/Resources" -type f \( -name "*.node" -o -name "mbspeech" \) -exec codesign --force --sign - {} \;
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep --strict "$APP" && echo "Signature OK"
  # Make the DMG: the app plus a shortcut to Applications to drag it into
  STAGE=$(mktemp -d)
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "ModeBuddy" -srcfolder "$STAGE" -ov -format UDZO "release/ModeBuddy-$NAME.dmg" >/dev/null
  rm -rf "$STAGE"
done
echo "DONE. Your files:"
ls -lh release
