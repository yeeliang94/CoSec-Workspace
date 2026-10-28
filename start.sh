#!/bin/sh
# Starts CoSec on macOS or Linux. See scripts/start.mjs.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 24 LTS from https://nodejs.org, then run this again."
  exit 1
fi
exec node scripts/start.mjs
