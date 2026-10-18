#!/bin/sh
# One-time setup for StrategyU Decks on macOS or Linux.
# The server itself needs only Python 3. This installs what `sb shot`, `sb audit`,
# `sb export`, and the dashboard thumbnails use: playwright-core (in tools/) and
# Chrome for Testing (in Playwright's cache: ~/Library/Caches/ms-playwright on macOS,
# ~/.cache/ms-playwright on Linux). An existing one is reused.
set -e
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1: $2"; exit 1; }; }
need python3 "install Python 3.9 or newer"
need node "install Node.js 18 or newer (https://nodejs.org)"
need npm "it comes with Node.js"
command -v git >/dev/null 2>&1 || echo "Note: git not found. Decks work, but they won't get version history (sb commit)."

python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || { echo "Python 3.9 or newer is needed"; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { echo "Node.js 18 or newer is needed"; exit 1; }

echo "Installing playwright-core into tools/ ..."
(cd tools && npm install --no-audit --no-fund --loglevel=error)

if CHROME=$(node tools/browser.mjs chrome 2>/dev/null); then
  echo "Chrome: $CHROME"
else
  echo "Installing Chrome for Testing (about 150 MB) ..."
  (cd tools && npx --no-install playwright-core install chromium)
  CHROME=$(node tools/browser.mjs chrome) || { echo "Chrome still not found. Set SB_CHROME to a Chrome or Chromium executable."; exit 1; }
  echo "Chrome: $CHROME"
fi

if [ "$(uname -s)" = Linux ]; then
  echo
  echo "On Linux, Chrome needs some system libraries. If screenshots or PDFs fail, run:"
  echo "  (cd tools && sudo npx playwright-core install-deps chromium)"
fi

chmod +x sb 2>/dev/null || true
PORT=$(python3 -c 'import sbconfig; print(sbconfig.PORT)')
echo
echo "Ready. Start the server:"
echo "  python3 server.py"
echo "then open http://localhost:$PORT/"
