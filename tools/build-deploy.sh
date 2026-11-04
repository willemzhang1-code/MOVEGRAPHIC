#!/usr/bin/env bash
# Builds the web app and publishes dist/ to the `deploy` branch (served by the
# Cloudflare Worker in tools/worker.js). Spine example assets are excluded.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/web"
npm run -s build
rm -rf dist/examples
tmp="$(mktemp -d)"
cp -r dist/. "$tmp/"
cd "$root"
git worktree remove --force .deploy 2>/dev/null || true
if git ls-remote --exit-code origin deploy >/dev/null 2>&1; then
  git fetch -q origin deploy
  git worktree add -q -B deploy .deploy origin/deploy
else
  git worktree add -q --detach .deploy
  (cd .deploy && git checkout -q --orphan deploy && git rm -rqf . >/dev/null 2>&1 || true)
fi
cd .deploy
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$tmp/." .
git add -A
git commit -q -m "deploy: $(git -C "$root" rev-parse --short HEAD)" || true
git push -q origin deploy
git rev-parse HEAD
cd "$root" && git worktree remove --force .deploy
