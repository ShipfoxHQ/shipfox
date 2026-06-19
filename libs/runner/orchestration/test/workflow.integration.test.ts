// Drives the REAL assembled runner (runJob / runPollLoop with the real execution layer
// and a real per-job workspace) through whole workflows against the in-memory fake
// protocol. Only the network is faked: steps spawn real shells in a real tmp dir.

import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {ClaimedJobResponseDto} from '@shipfox/api-runners-dto';
import {runJob, runPollLoop} from '#core/poll-loop.js';
import {createFakeProtocol} from '#test/harness/fake-protocol.js';
import type {WorkflowSpec} from '#test/harness/state-machine.js';

const execFileAsync = promisify(execFile);

let root: string;
// A local git remote the real setup step clones over file://. Created once; clones are
// read-only, so the fixture is shared across the suite.
let sourceRepo: string;

beforeAll(async () => {
  sourceRepo = await mkdtemp(join(tmpdir(), 'shipfox-runner-origin-'));
  await git(['init', '-b', 'main'], sourceRepo);
  await git(['config', 'user.email', 'test@shipfox.io'], sourceRepo);
  await git(['config', 'user.name', 'Test'], sourceRepo);
  await git(['config', 'commit.gpgsign', 'false'], sourceRepo);
  await writeFile(join(sourceRepo, 'README.md'), '# fixture\n');
  await git(['add', '.'], sourceRepo);
  await git(['commit', '-m', 'initial'], sourceRepo);
});

afterAll(async () => {
  await rm(sourceRepo, {recursive: true, force: true});
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shipfox-runner-harness-'));
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

// Long enough that the first tick lands after setup's real clone, so the cancelling
// heartbeat interrupts the run step rather than aborting the clone mid-flight (which
// would leave setup unreported). This couples the test to local-clone duration; see the
// gap note in test/harness/README.md.
const CANCEL_HEARTBEAT = {intervalMs: 250, maxStaleMs: 2000};
const SLOW_HEARTBEAT = {intervalMs: 10_000, maxStaleMs: 10_000};

// Every spec drives the real setup step, which clones checkout.repository_url. Point it at
// the shared local remote so setup succeeds with a real, credential-free clone.
function fakeProtocol(spec: WorkflowSpec) {
  return createFakeProtocol({
    checkout: {repository_url: `file://${sourceRepo}`, ref: 'main'},
    ...spec,
  });
}

function git(args: string[], cwd: string): Promise<unknown> {
  return execFileAsync('git', args, {cwd});
}

describe('runner workflow integration', () => {
  it('runs setup + two run steps, observing step 1 output via step 2, then cleans up', async () => {
    // Step 1 writes a marker into cwd; step 2 asserts it via `test -f`, so the marker
    // is observed by step 2's success report, not by inspecting the cwd after cleanup.
    const {protocol, machine} = fakeProtocol({
      steps: [{run: ': > marker'}, {run: 'test -f marker'}],
    });
    const job = claim(machine);

    await runJob(job, root, {protocol});

    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(machine.nextStep(job.lease_token)).toEqual({kind: 'done', status: 'succeeded'});
    expect(await readdir(root)).toHaveLength(0);
  });

  it('stops after a failing step without dispatching the rest', async () => {
    const {protocol, machine} = fakeProtocol({
      steps: [{run: 'exit 1'}, {run: ': > should-not-run'}],
    });
    const job = claim(machine);

    await runJob(job, root, {protocol});

    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded', 'failed']);
    expect(machine.reports[1]?.exitCode).toBe(1);
    const lastRun = machine.snapshot().find((s) => s.position === 2);
    expect(lastRun?.status).toBe('cancelled');
    expect(machine.nextDispatched).not.toContain(lastRun?.id);
  });

  it('reports a real setup failure when the workspace root is unusable', async () => {
    // A file where the per-job parent dir should be makes mkdir fail with ENOTDIR.
    const fileRoot = join(root, 'not-a-dir');
    await writeFile(fileRoot, 'x');
    const {protocol, machine} = fakeProtocol({steps: [{run: 'echo never'}]});
    const job = claim(machine);

    await runJob(job, fileRoot, {protocol});

    expect(machine.reports).toHaveLength(1);
    expect(machine.reports[0]?.status).toBe('failed');
    expect(machine.reports[0]?.error?.reason).toBe('workspace_prep_failed');
  });

  it('kills the step process group on abort without reporting it', async () => {
    // Markers live under root (not the per-job cwd) so they survive cleanup; the
    // sleep is killed mid-flight, so `completed` is never written.
    const started = join(root, 'started');
    const completed = join(root, 'completed');
    const {protocol, machine} = fakeProtocol({
      steps: [{run: `echo hi > ${started}; sleep 5; echo done > ${completed}`}],
    });
    const job = claim(machine);
    let jobController: AbortController | undefined;

    const finished = runJob(job, root, {
      protocol,
      registerJobController: (ac) => {
        if (ac) jobController = ac;
      },
    });
    await waitForFile(started);
    jobController?.abort();
    await finished;

    expect(await exists(completed)).toBe(false);
    // Only the setup step was reported; the killed step stops before reporting.
    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded']);
  });

  it('cancels an in-flight job when the heartbeat returns cancel', async () => {
    const {protocol, machine} = fakeProtocol({
      steps: [{run: `echo hi > ${join(root, 'started')}; sleep 5`}],
      cancelOnHeartbeat: true,
    });
    const job = claim(machine);

    await runJob(job, root, {protocol, heartbeat: CANCEL_HEARTBEAT});

    expect(machine.heartbeats.length).toBeGreaterThan(0);
    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded']);
  });

  it('aborts an orphaned job when the heartbeat reports the lease is gone', async () => {
    const {protocol, machine} = fakeProtocol({
      steps: [{run: `echo hi > ${join(root, 'started')}; sleep 5`}],
      finalizeOnHeartbeat: true,
    });
    const job = claim(machine);

    await runJob(job, root, {protocol, heartbeat: CANCEL_HEARTBEAT});

    expect(machine.heartbeats.length).toBeGreaterThan(0);
    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded']);
  });

  it('stops the step loop when the lease vanishes on next-step', async () => {
    const {protocol, machine} = fakeProtocol({steps: [{run: 'echo a'}], failNextStep: true});
    const job = claim(machine);

    await expect(runJob(job, root, {protocol})).resolves.toBeUndefined();

    expect(machine.reports).toHaveLength(0);
    expect(machine.nextDispatched).toHaveLength(0);
  });

  it('bails the job cleanly when a report is rejected as stale', async () => {
    const {protocol, machine} = fakeProtocol({steps: [{run: 'echo a'}], failReport: true});
    const job = claim(machine);

    await expect(runJob(job, root, {protocol})).resolves.toBeUndefined();

    // The report was rejected before it could be recorded; the job does not crash.
    expect(machine.reports).toHaveLength(0);
  });

  it('skips a job whose id is not a valid UUID', async () => {
    const {protocol, machine} = fakeProtocol({steps: [{run: 'echo a'}]});
    const badJob: ClaimedJobResponseDto = {
      job_id: 'not-a-uuid',
      run_id: randomUUID(),
      lease_token: 'lease-x',
    };

    await runJob(badJob, root, {protocol});

    expect(machine.reports).toHaveLength(0);
    expect(machine.nextDispatched).toHaveLength(0);
  });

  it('claims and runs a job through the poll loop, then stops on the poll signal', async () => {
    const {protocol, machine} = fakeProtocol({steps: [{run: 'echo a'}], jobsToServe: 1});
    const pollAc = new AbortController();

    const loop = runPollLoop({
      protocol,
      workspaceRoot: root,
      pollSignal: pollAc.signal,
      pollIntervalMs: 10,
      maxIntervalMs: 50,
      heartbeat: SLOW_HEARTBEAT,
    });
    await waitFor(() => machine.reports.length >= 2);
    pollAc.abort();
    await loop;

    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('recovers from a transient claim failure and still runs the job', async () => {
    const {protocol, machine} = fakeProtocol({
      steps: [{run: 'echo a'}],
      jobsToServe: 1,
      failClaims: 1,
    });
    const pollAc = new AbortController();

    const loop = runPollLoop({
      protocol,
      workspaceRoot: root,
      pollSignal: pollAc.signal,
      pollIntervalMs: 10,
      maxIntervalMs: 50,
      heartbeat: SLOW_HEARTBEAT,
    });
    await waitFor(() => machine.reports.length >= 2);
    pollAc.abort();
    await loop;

    expect(machine.reports.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });
});

function claim(machine: {requestJob: () => ClaimedJobResponseDto | null}): ClaimedJobResponseDto {
  const job = machine.requestJob();
  if (!job) throw new Error('expected the fake to serve a job');
  return job;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await exists(path)) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for file ${path}`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error('Timed out waiting for condition');
}
