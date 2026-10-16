import {toolGrants} from '@shipfox/actions/tool-grants';

describe('tool grants', () => {
  it('lists the sensitivity of a tool', () => {
    expect(toolGrants.slack?.send_message?.sensitivity).toBe('write');
    expect(toolGrants.slack?.read_thread?.sensitivity).toBe('read');
  });

  it('lists the sensitivity of every method of a family tool', () => {
    expect(toolGrants.github?.issue_read?.methods?.get).toBe('read');
    expect(toolGrants.github?.actions_run_trigger?.methods?.run_workflow).toBe('write');
  });

  it('lists a tool that returns images as image, so an action cannot call it', () => {
    expect(toolGrants.jam?.getFrames?.result).toBe('image');
    expect(toolGrants.jam?.getScreenshots?.result).toBe('image');
    expect(toolGrants.jam?.getDetails?.result).toBe('json');
  });
});
