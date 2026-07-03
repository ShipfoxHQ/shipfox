import {projectFactory} from '#test/index.js';
import {getProjectCount} from './projects.js';

describe('getProjectCount', () => {
  it('reports the current project count', async () => {
    const before = await getProjectCount();

    const after = await getProjectCount();

    expect(after - before).toBe(0);
  });

  it('counts newly created projects', async () => {
    const before = await getProjectCount();
    await projectFactory.create();
    await projectFactory.create();

    const after = await getProjectCount();

    expect(after - before).toBe(2);
  });
});
