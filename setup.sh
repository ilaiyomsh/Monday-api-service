#!/bin/bash
# Quick setup script — run this from the repo root
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh <your-github-repo-url>
#
# Example:
#   ./setup.sh https://github.com/your-username/monday-app-services.git

REPO_URL=$1

if [ -z "$REPO_URL" ]; then
  echo "Usage: ./setup.sh <github-repo-url>"
  echo "Example: ./setup.sh https://github.com/your-username/monday-app-services.git"
  exit 1
fi

git init
git add -A
git commit -m "feat: initial commit — service layer + AI skill for monday.com apps

- mondayApi.js: unified API client (monday-sdk-js + SeamlessApiClient)
- errorHandler.js: 40+ error codes, retry logic, failure tracking
- logger.js: leveled logging + Supabase error reporting
- ErrorBanner.jsx: two-step error UX (HE/EN, RTL)
- SKILL.md: complete monday API reference for Claude Code
- supabase-setup.sql: error_logs table with RLS
- docs: SDK research + architecture diagram"

git branch -M main
git remote add origin "$REPO_URL"
git push -u origin main

echo ""
echo "✅ Pushed to $REPO_URL"
