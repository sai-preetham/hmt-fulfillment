#!/usr/bin/env bash
# Installed in /usr/local/lib/hmt-deploy; run as saipi by the systemd timer.
set -Eeuo pipefail
umask 027
base=/home/saipi
cache="$base/hmt-deploy-cache.git"
releases="$base/wixdelhivery-releases"
shared="$base/wixdelhivery-shared"
current="$base/wixdelhivery"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$releases" "$shared"
exec 9>"$shared/deploy.lock"
flock -n 9 || exit 0
if [[ -f "$shared/deploy-paused" ]]; then
  echo 'Automatic deployment is paused.'
  exit 0
fi
[[ -L "$current" ]] || { echo 'Install the release layout before enabling the timer.'; exit 1; }
[[ -f "$shared/.env" ]] || { echo 'Shared production environment is missing.'; exit 1; }
if [[ ! -d "$cache" ]]; then
  git init --bare "$cache"
  git --git-dir="$cache" remote add origin https://github.com/sai-preetham/hmt-fulfillment.git
fi
git --git-dir="$cache" fetch --quiet origin +refs/heads/main:refs/heads/main
sha="$(git --git-dir="$cache" rev-parse refs/heads/main)"
previous="$(readlink -f "$current")"
[[ "$(cat "$previous/.release-sha" 2>/dev/null || true)" != "$sha" ]] || exit 0
node "$script_dir/ci-gate.mjs" "$sha" || {
  gate_status=$?
  [[ "$gate_status" == 10 ]] && exit 0
  exit "$gate_status"
}
release="$releases/$sha"
# Never reuse an incomplete build from a failed attempt.
if [[ -d "$release" ]]; then
  [[ "$release" != "$previous" ]] || exit 1
  rm -rf -- "$release"
fi
mkdir -p "$release"
git --git-dir="$cache" archive "$sha" | tar -x -C "$release"
ln -s "$shared/.env" "$release/.env"
ln -s "$shared/data" "$release/data"
printf '%s\n' "$sha" > "$release/.release-sha"
printf 'APP_RELEASE_SHA=%s\n' "$sha" > "$release/.release.env"
cd "$release"
echo "Building main commit $sha"
export NEXT_TELEMETRY_DISABLED=1
npm ci --no-audit --no-fund
npm test
npm run build
# Skip an obsolete candidate if main advanced while the build ran.
git --git-dir="$cache" fetch --quiet origin +refs/heads/main:refs/heads/main
[[ "$(git --git-dir="$cache" rev-parse refs/heads/main)" == "$sha" ]] || {
  echo 'Main advanced during the build; the next run will build its new head.'
  exit 0
}
switched=0
rollback() {
  result=$?
  if [[ "$switched" == 1 ]]; then
    echo "Release failed; restoring $previous"
    ln -s "$previous" "$current.next"
    mv -Tf "$current.next" "$current"
    sudo -n /usr/bin/systemctl restart wixdelhivery.service || true
  fi
  exit "$result"
}
trap rollback ERR
ln -s "$release" "$current.next"
mv -Tf "$current.next" "$current"
switched=1
sudo -n /usr/bin/systemctl restart wixdelhivery.service
healthy=0
for attempt in {1..30}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/health | node -e '
    let input=""; process.stdin.on("data",chunk=>input+=chunk);
    process.stdin.on("end",()=>{try{const r=JSON.parse(input);process.exit(r.status==="ok" && r.commit===process.argv[1]?0:1)}catch{process.exit(1)}});
  ' "$sha"; then
    if [[ "$(curl --silent --output /dev/null --max-time 5 --write-out '%{http_code}' http://127.0.0.1:3000/login)" == 200 ]]; then
      healthy=1
      break
    fi
  fi
  sleep 2
done
[[ "$healthy" == 1 ]] || { echo 'Release health check failed.'; false; }
switched=0
trap - ERR
printf '%s\n' "$previous" > "$shared/previous-release"
echo "Deployed and verified main commit $sha"
# Retain the active release and two preceding releases; backups are elsewhere.
python3 - "$releases" "$release" "$previous" <<'PY'
from pathlib import Path
import re, shutil, sys
root, active, previous = map(Path, sys.argv[1:])
candidates = sorted((p for p in root.iterdir() if p.is_dir() and re.fullmatch('[0-9a-f]{40}', p.name)), key=lambda p: p.stat().st_mtime, reverse=True)
keep = {active, previous, *candidates[:3]}
for path in candidates:
    if path not in keep:
        shutil.rmtree(path)
PY
