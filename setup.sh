#!/usr/bin/env sh
# ThumbnailBooth setup for macOS and Linux.
#   ./setup.sh
# Installs dependencies, builds the app, and starts it.
set -eu

cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m[OK]\033[0m %s\n' "$1"; }
step() { printf '  [..] %s\n' "$1"; }
die()  { printf '\n  \033[31m[X]\033[0m %s\n\n' "$1"; exit 1; }

printf '\n'; bold '  ThumbnailBooth setup'; printf '  ====================\n\n'

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Get the LTS build from https://nodejs.org and run this again."

MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$MAJOR" -ge 20 ] || die "Node.js $(node -p 'process.versions.node') is too old. Version 20 or newer is required."
ok "Node.js $(node -p 'process.versions.node')"

step "Installing dependencies. First run takes a minute."
npm install --no-fund --no-audit || die "npm install failed. Scroll up for the reason."
ok "Dependencies installed"

step "Building"
npm run build || die "Build failed. Scroll up for the reason."
ok "Built"

printf '\n  Starting ThumbnailBooth. Press Ctrl+C to stop.\n\n'
exec node bin/thumbnailbooth.js "$@"
