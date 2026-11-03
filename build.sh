#!/usr/bin/env bash
# Build index.html (standalone page for GitHub Pages) from film-sim-lab.html (artifact fragment).
set -euo pipefail
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  # installable app (PWA): manifest, icons and service worker exist only for the standalone copy
  printf '<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#111311">\n'
  printf '<link rel="icon" href="icons/icon-192.png">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n</head>\n<body>\n'
  cat film-sim-lab.html
  printf '\n</body>\n</html>\n'
} > index.html
echo "index.html built ($(wc -c < index.html) bytes)"
