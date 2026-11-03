import {projectAgentSnapshot} from '#test/fixtures/definitions-client.js';
import {buildPinnedPrompt} from './pinned-prompt.js';

const project = {projectId: 'project-1', projectName: 'Platform'};

describe('buildPinnedPrompt', () => {
  it('uses the shipped prompt for the built-in agent', () => {
    const prompt = buildPinnedPrompt({agentKey: 'shippy', agent: {kind: 'built-in'}, ...project});

    expect(prompt).toContain('## This conversation');
    expect(prompt).toContain('Project: "Platform" (id project-1)');
    expect(prompt).not.toContain('Use pnpm.');
  });

  it('appends the instructions of shippy.yaml after the shipped prompt', () => {
    const builtIn = buildPinnedPrompt({agentKey: 'shippy', agent: {kind: 'built-in'}, ...project});

    const prompt = buildPinnedPrompt({
      agentKey: 'shippy',
      agent: {
        kind: 'configured',
        agent: projectAgentSnapshot({key: 'shippy', instructions: 'Use pnpm.'}),
      },
      ...project,
    });

    const base = builtIn.slice(0, builtIn.indexOf('## This conversation')).trimEnd();
    expect(prompt.startsWith(`${base}\n\nUse pnpm.\n\n## This conversation`)).toBe(true);
  });

  it('keeps the shipped prompt for a shippy.yaml without instructions', () => {
    const builtIn = buildPinnedPrompt({agentKey: 'shippy', agent: {kind: 'built-in'}, ...project});

    const prompt = buildPinnedPrompt({
      agentKey: 'shippy',
      agent: {
        kind: 'configured',
        agent: projectAgentSnapshot({key: 'shippy', document: {model: 'm'}}),
      },
      ...project,
    });

    expect(prompt).toBe(builtIn);
  });

  it('uses the instructions of a custom agent as the whole prompt', () => {
    const shipped = buildPinnedPrompt({agentKey: 'shippy', agent: {kind: 'built-in'}, ...project});

    const prompt = buildPinnedPrompt({
      agentKey: 'reviewer',
      agent: {
        kind: 'configured',
        agent: projectAgentSnapshot({key: 'reviewer', instructions: 'Review pull requests.'}),
      },
      ...project,
    });

    expect(prompt.startsWith('Review pull requests.\n\n## This conversation')).toBe(true);
    const shippedBase = shipped.slice(0, shipped.indexOf('## This conversation'));
    expect(prompt).not.toContain(shippedBase.trim());
  });
});
