import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {clickupContractFake} from './clickup.js';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import type {ContractFakeContext, SandboxFixtures} from './shared.js';

const missingNamePattern = /fixture "task" has no "name"/u;

describe('clickupContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  const context = (): ContractFakeContext => ({uniqueId: 'unique', cleanups});

  const fixtures: SandboxFixtures = {
    list: {id: 'list-1', name: 'Contracts read', task_count: 104},
    task: {id: 'task-1', name: 'Fixture task', comment_count: 32},
    parent_task: {id: 'task-2', name: 'Parent'},
    subtask: {id: 'task-3', name: 'Subtask'},
    closed_task: {id: 'task-4', name: 'Closed'},
  };

  async function getJson({endpoint, path}: {endpoint: string | undefined; path: string}) {
    return (await (await fetch(new URL(path, endpoint))).json()) as Record<string, unknown>;
  }

  it('seeds ClickUp with the tasks of the fixtures and a list of 104 tasks', async () => {
    const fake = await clickupContractFake(context());

    await fake.seed(fixtures);

    const endpoint = fake.env.CLICKUP_API_BASE_URL;
    const task = await getJson({endpoint, path: '/api/v2/task/task-1'});
    const comments = (await getJson({endpoint, path: '/api/v2/task/task-1/comment'})) as {
      comments: unknown[];
    };
    const first = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=0&include_closed=true&subtasks=true',
    })) as {tasks: unknown[]; last_page: boolean};
    const last = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=1&include_closed=true&subtasks=true',
    })) as {tasks: unknown[]; last_page: boolean};
    const open = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=1',
    })) as {tasks: unknown[]};
    expect(fake.access).toEqual({accessToken: 'clickup-access-token-unique'});
    expect(task).toMatchObject({id: 'task-1', name: 'Fixture task', list: {id: 'list-1'}});
    expect(comments.comments).toHaveLength(25);
    expect(first.tasks).toHaveLength(100);
    expect(first.last_page).toBe(false);
    expect(last).toMatchObject({last_page: true});
    expect(last.tasks).toHaveLength(4);
    // Without the closed task and the subtask, 102 tasks leave two on the second page.
    expect(open.tasks).toHaveLength(2);
  });

  it('rejects a task fixture without a name', async () => {
    const fake = await clickupContractFake(context());

    await expect(fake.seed({task: {id: 'task-1'}})).rejects.toThrow(missingNamePattern);
  });

  it('is the adapter of the clickup provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.clickup).toBe(clickupContractFake);
  });
});
