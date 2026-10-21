import {type ClickUpTaskFixture, startClickUpApiMock} from '@shipfox/e2e-driver-clickup';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  field,
  fixtureComments,
  rejectingSeed,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the ClickUp tool adapter needs to act as the connection. */
export interface ClickUpContractAccess {
  accessToken: string;
}

// What the sandbox's ClickUp tasks are besides tasks of the read list.
const CLICKUP_TASK_FIXTURES = ['task', 'parent_task', 'subtask', 'closed_task'] as const;
const CLICKUP_PARENT_FIXTURE = 'parent_task';
const CLICKUP_SUBTASK_FIXTURE = 'subtask';
const CLICKUP_CLOSED_FIXTURE = 'closed_task';
// The `task` fixture holds the `tag` fixture and a value in the `text_field` fixture.
const CLICKUP_TAGGED_FIXTURE = 'task';

type ClickUpList = NonNullable<ClickUpTaskFixture['list']>;

function clickupList(fixtures: SandboxFixtures): ClickUpList | undefined {
  const fixture = fixtures.list;
  if (fixture === undefined) return undefined;
  return {
    id: String(requiredField({provider: 'clickup', fixture, fixtureName: 'list', name: 'id'})),
    name: String(field({fixture, name: 'name'}) ?? 'Contracts'),
  };
}

function clickupTask({
  id,
  name,
  list,
  ...rest
}: {id: string; name: string; list: ClickUpList | undefined} & Partial<ClickUpTaskFixture>) {
  return {
    url: `https://app.clickup.com/t/${id}`,
    markdownDescription: '',
    ...rest,
    id,
    name,
    list,
  } satisfies ClickUpTaskFixture;
}

function clickupTasks({
  fixtures,
  list,
}: {
  fixtures: SandboxFixtures;
  list: ClickUpList | undefined;
}): ClickUpTaskFixture[] {
  const parent = fixtures[CLICKUP_PARENT_FIXTURE];
  const parentId = parent === undefined ? undefined : String(field({fixture: parent, name: 'id'}));
  const tag = fixtures.tag === undefined ? undefined : field({fixture: fixtures.tag, name: 'name'});
  const textField = fixtures.text_field;
  return CLICKUP_TASK_FIXTURES.flatMap((fixtureName) => {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) return [];
    return [
      clickupTask({
        id: String(requiredField({provider: 'clickup', fixture, fixtureName, name: 'id'})),
        name: String(requiredField({provider: 'clickup', fixture, fixtureName, name: 'name'})),
        list,
        markdownDescription: String(field({fixture, name: 'description'}) ?? ''),
        closed: fixtureName === CLICKUP_CLOSED_FIXTURE,
        parentId: fixtureName === CLICKUP_SUBTASK_FIXTURE ? parentId : undefined,
        comments: fixtureComments(fixture),
        ...(fixtureName === CLICKUP_TAGGED_FIXTURE && tag !== undefined
          ? {tags: [String(tag)]}
          : {}),
        ...(fixtureName === CLICKUP_TAGGED_FIXTURE && textField !== undefined
          ? {
              customFields: [
                {
                  id: String(field({fixture: textField, name: 'id'})),
                  value: field({fixture: textField, name: 'value'}),
                },
              ],
            }
          : {}),
      }),
    ];
  });
}

/**
 * ClickUp, behind an access token the fake answers for. It seeds the `list` fixture as a List, the
 * task fixtures as its tasks, and enough more tasks to fill the `task_count` the sandbox list
 * holds, so a task search has a second page. The `task` fixture gets its `comment_count` comments,
 * the `tag` fixture, and the `value` of the `text_field` fixture.
 */
export const clickupContractFake: ContractFakeAdapter<ClickUpContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const accessToken = `clickup-access-token-${uniqueId}`;
  const mock = await startClickUpApiMock({
    accessToken,
    rejectUnseeded: true,
    endpoint: ephemeralEndpoint(),
  });
  cleanups.push(() => mock.stop());

  return {
    env: {CLICKUP_API_BASE_URL: mock.endpoint.toString()},
    access: {accessToken},
    seed: (fixtures) =>
      rejectingSeed(() => {
        const list = clickupList(fixtures);
        for (const task of clickupTasks({fixtures, list})) mock.tasks.set(task.id, task);
        const taskCount = Number(field({fixture: fixtures.list ?? {}, name: 'task_count'}) ?? 0);
        if (list === undefined) return;
        for (let index = mock.tasks.size; index < taskCount; index++) {
          const id = `contract-filler-${index}`;
          mock.tasks.set(id, clickupTask({id, name: `Contract filler task ${index}`, list}));
        }
      }),
    writes: () => mock.writes(),
  };
};
