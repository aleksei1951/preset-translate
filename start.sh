#!/usr/bin/env bash
# SillyTavern Preset Translator — one-click launcher

set -e
cd "$(dirname "$0")"

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "  [ERROR] Node.js not found!"
    echo ""
    echo "  Install it:"
    echo "    macOS:  brew install node"
    echo "    Linux:  sudo apt install nodejs npm"
    echo "    Or:     https://nodejs.org/"
    echo ""
    exit 1
fi

node preset-translate.js "$@"
