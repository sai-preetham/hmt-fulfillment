import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidatedMainCommit } from '../deploy/ci-gate.mjs';

const sha = 'a'.repeat(40);
const successfulRun = { head_sha: sha, head_branch: 'main', event: 'push', repository: { full_name: 'sai-preetham/hmt-fulfillment' }, path: '.github/workflows/ci.yml', run_number: 10, run_attempt: 1, status: 'completed', conclusion: 'success' };

test('deployment accepts only successful push-to-main CI for the exact release', () => {
  assert.equal(isValidatedMainCommit({ workflow_runs: [successfulRun] }, sha), true);
  for (const change of [{head_sha:'b'.repeat(40)}, {head_branch:'feature'}, {event:'pull_request'}, {event:'workflow_dispatch'}, {repository:{full_name:'fork/repo'}}, {path:'.github/workflows/other.yml'}, {status:'in_progress'}, {conclusion:'failure'}, {conclusion:'cancelled'}, {conclusion:'skipped'}]) {
    assert.equal(isValidatedMainCommit({ workflow_runs: [{...successfulRun, ...change}] }, sha), false);
  }
  assert.equal(isValidatedMainCommit({workflow_runs:[]},sha),false);
});

test('a newer failed or running CI attempt blocks an earlier success', () => {
  assert.equal(isValidatedMainCommit({ workflow_runs: [successfulRun, {...successfulRun, run_attempt:2, status:'in_progress', conclusion:null}] }, sha), false);
  assert.equal(isValidatedMainCommit({ workflow_runs: [successfulRun, {...successfulRun, run_number:11, conclusion:'failure'}] }, sha), false);
});
