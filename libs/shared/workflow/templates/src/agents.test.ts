import {getBuiltInAgentPrompt} from './agents.js';

describe('getBuiltInAgentPrompt', () => {
  it('ships a prompt for Shippy', () => {
    const prompt = getBuiltInAgentPrompt('shippy');

    expect(prompt).toContain('You are Shippy');
  });

  it('treats results as untrusted data', () => {
    expect(getBuiltInAgentPrompt('shippy')).toContain('<untrusted_data>');
  });

  it('tells Shippy to read finished jobs at settled to find outputs', () => {
    const prompt = getBuiltInAgentPrompt('shippy');

    expect(prompt).toContain('settled');
    expect(prompt).toContain('get_workflow_job');
  });

  it('answers undefined for an unknown agent', () => {
    expect(getBuiltInAgentPrompt('missing')).toBeUndefined();
    expect(getBuiltInAgentPrompt('constructor')).toBeUndefined();
  });
});
