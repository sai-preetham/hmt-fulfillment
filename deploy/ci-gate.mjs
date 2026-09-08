import { pathToFileURL } from 'node:url';

// Only a successful push-to-main run for this precise commit can release code.
// PR checks and workflow_dispatch runs cannot authorize a production release.
export function isValidatedMainCommit(payload, sha, repository = 'sai-preetham/hmt-fulfillment') {
  const runs = (payload.workflow_runs || []).filter(run =>
    run.head_sha === sha && run.head_branch === 'main' && run.event === 'push' &&
    run.repository?.full_name === repository && run.path === '.github/workflows/ci.yml'
  ).sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
  return runs[0]?.status === 'completed' && runs[0]?.conclusion === 'success';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = process.argv[2];
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('Expected a full commit SHA.');
  const response = await fetch(`https://api.github.com/repos/sai-preetham/hmt-fulfillment/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hmt-main-deployer' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Cannot verify GitHub CI (${response.status}); release blocked.`);
  if (!isValidatedMainCommit(await response.json(), sha)) {
    console.log(`Waiting for successful main CI for ${sha}.`);
    process.exitCode = 10;
  }
}
