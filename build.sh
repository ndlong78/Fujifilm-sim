#!/usr/bin/env bash
# Build index.html (standalone page for GitHub Pages) from film-sim-lab.html (artifact fragment).
set -euo pipefail
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  cat film-sim-lab.html
  printf '\n</body>\n</html>\n'
} > index.html
echo "index.html built ($(wc -c < index.html) bytes)"
