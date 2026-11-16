#!/bin/sh
# Builds the Keyvane Safari app project (macOS + iOS) from ../extension.
# Run on a Mac with Xcode 15 or later:  sh safari/build-xcode.sh
# Optional: BUNDLE_ID=com.yourname.keyvane sh safari/build-xcode.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/build"
rm -rf "$work"; mkdir -p "$work"
cp -R "$here/../extension" "$work/Keyvane Extension"

# Safari-only manifest key: needs Safari 17 (storage.session, module service worker, scripting).
/usr/bin/python3 - "$work/Keyvane Extension/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p))
m["browser_specific_settings"] = {"safari": {"strict_min_version": "17.0"}}
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
PY

xcrun safari-web-extension-converter "$work/Keyvane Extension" \
  --project-location "$work" \
  --app-name "Keyvane" \
  --bundle-identifier "${BUNDLE_ID:-app.keyvane.Keyvane}" \
  --swift --copy-resources --no-open --no-prompt --force

echo
echo "Done. Open this in Xcode:"
find "$work" -maxdepth 2 -name "*.xcodeproj" -print
