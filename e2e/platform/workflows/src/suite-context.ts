import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ProvisionerHandle} from '@shipfox/e2e-helper-runners';

/**
 * Everything a worker needs to drive scenarios against the shared suite arrangement.
 * It is serializable on purpose: global setup writes it once and the worker processes
 * read it back, since they do not share memory with the setup process.
 */
export interface SuiteContext {
  runId: string;
  workspaceId: string;
  sessionToken: string;
  org: string;
  connectionId: string;
  provisionerLogFile: string;
}

const runDir = fileURLToPath(new URL('../.e2e-run/', import.meta.url));
const contextFile = `${runDir}suite-context.json`;
const failureSentinelFile = `${runDir}failed`;

export function suiteRunDir(): string {
  mkdirSync(runDir, {recursive: true});
  return runDir;
}

export function resetSuiteRunDir(): void {
  rmSync(runDir, {recursive: true, force: true});
}

export function writeSuiteContext(context: SuiteContext): void {
  suiteRunDir();
  writeFileSync(contextFile, JSON.stringify(context, null, 2));
}

export function readSuiteContext(): SuiteContext {
  return JSON.parse(readFileSync(contextFile, 'utf8')) as SuiteContext;
}

// Global setup and teardown run in the same Playwright process, so the live child
// provisioner handle is passed between them in memory rather than through the context
// file: a ChildProcess cannot be serialized. Both files must import this module
// through the same specifier for the singleton to be shared.
let provisionerHandle: ProvisionerHandle | undefined;

export function setProvisionerHandle(handle: ProvisionerHandle): void {
  provisionerHandle = handle;
}

export function getProvisionerHandle(): ProvisionerHandle | undefined {
  return provisionerHandle;
}

// A test worker marks the run failed by touching a sentinel file (workers do not share
// memory with the teardown process). Teardown reads it to decide whether to keep the
// gitea org for inspection.
export function markSuiteFailed(): void {
  suiteRunDir();
  writeFileSync(failureSentinelFile, '');
}

export function suiteFailed(): boolean {
  try {
    readFileSync(failureSentinelFile);
    return true;
  } catch {
    return false;
  }
}
