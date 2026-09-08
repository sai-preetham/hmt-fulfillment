# Branch → main → saipi

Production runs a committed, validated revision of `main`. Do not copy source files directly to the server or edit the active release.

## Make a change

1. Start a branch from current `main`: `git switch main && git pull --ff-only && git switch -c codex/your-change`.
2. Commit source changes. Keep `.env`, customer exports, generated PDFs, scratch files, and dependencies out of Git.
3. Run `npm ci`, `npm test`, and `npm run build`. Use Node 24, as specified in `.nvmrc`.
4. Push the branch and open a pull request targeting `main`.
5. Merge after the required **Validate** check passes. `main` requires a pull request and passing checks, including for administrators.

## Automatic deployment

GitHub Actions runs tests and a production build on pull requests and pushes to `main`. A systemd timer on `saipi` checks `main` every minute. It requires a successful **push** run of `.github/workflows/ci.yml` for the exact candidate commit. A pull-request run, a manual workflow run, or checks on another commit do not authorize deployment.

The updater downloads that committed tree, installs locked dependencies, reruns tests, and builds on the Pi. The running app stays online during the build. If `main` advances during the build, the candidate is skipped and the next run builds the latest revision.

A completed build is activated by switching the `/home/saipi/wixdelhivery` symlink and restarting the app. `/api/health` must report the deployed commit and `/login` must return HTTP 200. A failed restart or health check restores the previous symlink and restarts the previous release. The three newest releases are retained. No live Wix writes are used in deployment checks.

- Active release: `/home/saipi/wixdelhivery` (symlink)
- Release directories: `/home/saipi/wixdelhivery-releases/<commit>`
- Shared production environment: `/home/saipi/wixdelhivery-shared/.env`
- Shared runtime data: `/home/saipi/wixdelhivery-shared/data`
- Previous release: `/home/saipi/wixdelhivery-shared/previous-release`
- Installed updater: `/usr/local/lib/hmt-deploy/`
- Updater units: `wixdelhivery-deploy.service` and `wixdelhivery-deploy.timer`

The public repository and public workflow-run API are read without credentials. Production secrets stay on `saipi`. GitHub API failures or unavailable/failed CI block deployment and leave the current release in place. The updater itself and service definitions are installed infrastructure: changes to `deploy/` must also be installed through SSH after review; app source still comes exclusively from `main`.

## Check a deployment

```sh
ssh saipi 'systemctl status wixdelhivery-deploy.timer --no-pager'
ssh saipi 'journalctl -u wixdelhivery-deploy.service -n 60 --no-pager'
ssh saipi 'curl -fsS http://127.0.0.1:3000/api/health'
```

## Pause, retry, and roll back

Pause before an emergency rollback so the next timer tick does not restore the newer main revision:

```sh
ssh saipi 'touch /home/saipi/wixdelhivery-shared/deploy-paused'
```

Wait for any running deployment to finish, then restore the saved previous release:

```sh
ssh saipi 'bash -s' <<'SH'
set -eu
shared=/home/saipi/wixdelhivery-shared
current=/home/saipi/wixdelhivery
exec 9>"$shared/deploy.lock"
flock 9
previous=$(cat "$shared/previous-release")
test -d "$previous/.next"
ln -s "$previous" "$current.next"
mv -Tf "$current.next" "$current"
sudo systemctl restart wixdelhivery.service
curl --retry 8 --retry-connrefused --retry-delay 2 -fsS http://127.0.0.1:3000/api/health
SH
```

Fix or revert the offending commit through another pull request, then resume:

```sh
ssh saipi 'rm -f /home/saipi/wixdelhivery-shared/deploy-paused && sudo systemctl start wixdelhivery-deploy.service'
```

Database migrations are reviewed separately. The deployer never runs schema changes automatically. Include backward-compatible migration work and verification in a PR when a change requires it; never remove columns needed by the previous release during rollout.
