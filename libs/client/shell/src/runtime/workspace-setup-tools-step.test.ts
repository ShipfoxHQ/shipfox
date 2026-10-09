// @vitest-environment jsdom
import {
  clearWorkspaceSetupToolsStep,
  finishWorkspaceSetupToolsStep,
  isWorkspaceSetupToolsStepFinished,
  WORKSPACE_SETUP_TOOLS_STEP_EVENT,
} from './workspace-setup-tools-step.js';

const FINISHED_KEY = 'shipfox.workspaceSetupChecklist.toolsStepFinished.workspace.workspace';

describe('workspace-setup tools step storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reads not finished before anything is stored', () => {
    expect(isWorkspaceSetupToolsStepFinished('workspace')).toBe(false);
  });

  test('finish writes a workspace-scoped persistent flag', () => {
    finishWorkspaceSetupToolsStep('workspace');

    expect(isWorkspaceSetupToolsStepFinished('workspace')).toBe(true);
    expect(window.localStorage.getItem(FINISHED_KEY)).toBe('true');
  });

  test('the flag is scoped per workspace', () => {
    finishWorkspaceSetupToolsStep('workspace');

    expect(isWorkspaceSetupToolsStepFinished('other-workspace')).toBe(false);
  });

  test('clear removes the flag', () => {
    finishWorkspaceSetupToolsStep('workspace');
    clearWorkspaceSetupToolsStep('workspace');

    expect(isWorkspaceSetupToolsStepFinished('workspace')).toBe(false);
    expect(window.localStorage.getItem(FINISHED_KEY)).toBeNull();
  });

  test('notifies same-tab listeners when the flag changes', () => {
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_SETUP_TOOLS_STEP_EVENT, listener);

    finishWorkspaceSetupToolsStep('workspace');
    clearWorkspaceSetupToolsStep('workspace');

    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(WORKSPACE_SETUP_TOOLS_STEP_EVENT, listener);
  });

  test('tolerates an unparsable persisted value', () => {
    window.localStorage.setItem(FINISHED_KEY, 'not-a-boolean');

    expect(isWorkspaceSetupToolsStepFinished('workspace')).toBe(false);
  });

  test('degrades gracefully when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => isWorkspaceSetupToolsStepFinished('workspace')).not.toThrow();
    expect(isWorkspaceSetupToolsStepFinished('workspace')).toBe(false);
    expect(() => finishWorkspaceSetupToolsStep('workspace')).not.toThrow();
  });
});
