#!/bin/sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "[ImperialsBot] Node.js not found. Install Node 18+ first."
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "[ImperialsBot] Installing dependencies, this can take a few minutes..."
    npm install
fi

echo "[ImperialsBot] Starting server on http://localhost:3000"
echo "[ImperialsBot] Press Ctrl+C to stop."
exec node index.js