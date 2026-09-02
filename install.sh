#!/usr/bin/env sh
# ThumbnailBooth installer.
#   curl -fsSL https://raw.githubusercontent.com/YOUR-USER/thumbnailbooth/main/install.sh | sh
#
# There is nothing to install, really: this checks you have Node and then
# hands over to npx, which fetches and runs the current version.

set -eu

red() { printf '\033[38;5;210m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

if ! command -v node >/dev/null 2>&1; then
  red "✕ ThumbnailBooth needs Node.js, and it isn't installed."
  dim "  Get it from https://nodejs.org (pick the LTS button), then run this again."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then
  red "✕ Your Node.js is too old (v$(node -p 'process.versions.node'))."
  dim "  ThumbnailBooth needs v20 or newer. Update at https://nodejs.org"
  exit 1
fi

dim "Starting ThumbnailBooth…"
exec npx --yes thumbnailbooth "$@"
