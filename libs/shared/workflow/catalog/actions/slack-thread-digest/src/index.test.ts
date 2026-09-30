import {type ActionTestWorkspace, runAction, toolError, toolResult} from '@shipfox/actions/testing';

const action = new URL('../', import.meta.url);
const channelId = 'C0123';
const threadTs = '1721300000.000100';

describe('slack-thread-digest', () => {
  const workspaces: ActionTestWorkspace[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => workspace.remove()));
  });

  it('follows every cursor and writes each message once, in time order', async () => {
    // Pages arrive out of order, and one reply appears on two pages.
    const pages: Record<string, unknown> = {
      first: {
        messages: [
          {ts: threadTs, user: 'U1', text: 'parent', reply_count: 3},
          {ts: '1721300300.000100', user: 'U1', text: 'third reply'},
        ],
        response_metadata: {next_cursor: 'c2'},
      },
      c2: {
        messages: [
          {ts: '1721300200.000100', user: 'U1', text: 'second reply'},
          {ts: '1721300300.000100', user: 'U1', text: 'third reply'},
        ],
        response_metadata: {next_cursor: 'c3'},
      },
      c3: {
        messages: [{ts: '1721300100.000100', user: 'U1', text: 'first reply'}],
        response_metadata: {next_cursor: ''},
      },
    };

    const result = await runAction(action, {
      inputs: {channel_id: channelId, thread_ts: threadTs},
      tools: {
        slack: {
          read_thread: (args) => toolResult(pages[String(args.cursor ?? 'first')]),
          read_user_profile: () => toolResult({user: {profile: {display_name: 'Ada'}}}),
          get_permalink: (args) =>
            toolResult({
              permalink: `https://acme.slack.com/archives/${channelId}/p${args.message_ts}`,
            }),
        },
      },
    });
    workspaces.push(result.workspace);

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {path: 'context/slack-thread.md', message_count: 4, complete: true},
    });
    const reads = result.calls.filter((call) => call.tool === 'read_thread');
    expect(reads.map((call) => call.args.cursor)).toEqual([undefined, 'c2', 'c3']);
    const markdown = await result.workspace.read('context/slack-thread.md');
    const order = ['parent', 'first reply', 'second reply', 'third reply'].map((text) =>
      markdown.indexOf(`\n${text}\n`),
    );
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(order).not.toContain(-1);
    expect(markdown.match(/\nthird reply\n/gu)).toHaveLength(1);
  });

  it('keeps the user ID when an author lookup fails', async () => {
    const result = await runAction(action, {
      inputs: {channel_id: channelId, thread_ts: threadTs},
      tools: {
        slack: {
          read_thread: () =>
            toolResult({
              messages: [
                {ts: threadTs, user: 'U1', text: 'parent', reply_count: 1},
                {ts: '1721300100.000100', user: 'U2', text: 'reply'},
              ],
            }),
          read_user_profile: (args) => {
            if (args.user_id === 'U2')
              throw toolError({code: 'provider-rejected', message: 'user_not_found'});
            return toolResult({user: {profile: {display_name: 'Ada'}}});
          },
          get_permalink: () => toolResult({}),
        },
      },
    });
    workspaces.push(result.workspace);

    expect(result).toMatchObject({status: 'succeeded', outputs: {message_count: 2}});
    const markdown = await result.workspace.read('context/slack-thread.md');
    expect(markdown).toContain('## Ada, 2024-07-18T10:53:20Z');
    expect(markdown).toContain('## U2, 2024-07-18T10:55:00Z');
    expect(result.logs).toContain('Could not look up Slack user U2');
  });
  it('links each message and its files, and writes to the requested destination', async () => {
    const result = await runAction(action, {
      inputs: {channel_id: channelId, thread_ts: threadTs, destination: 'notes/thread.md'},
      tools: {
        slack: {
          read_thread: () =>
            toolResult({
              messages: [
                {
                  ts: threadTs,
                  username: 'deploy-bot',
                  text: 'parent',
                  reply_count: 0,
                  files: [{title: 'build.log', permalink: 'https://acme.slack.com/files/F1'}],
                },
              ],
            }),
          read_user_profile: () => toolResult({}),
          get_permalink: () =>
            toolResult({permalink: `https://acme.slack.com/archives/${channelId}/p1`}),
        },
      },
    });
    workspaces.push(result.workspace);

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {path: 'notes/thread.md', message_count: 1, complete: true},
    });
    expect(result.calls.map((call) => call.tool)).not.toContain('read_user_profile');
    const markdown = await result.workspace.read('notes/thread.md');
    expect(markdown).toContain('## deploy-bot, 2024-07-18T10:53:20Z');
    expect(markdown).toContain(`[ts ${threadTs}](https://acme.slack.com/archives/${channelId}/p1)`);
    expect(markdown).toContain('File: [build.log](https://acme.slack.com/files/F1)');
    expect(markdown).toContain('Complete: 1 message, the parent and 0 replies.');
  });

  it('reports an incomplete export when Slack returns fewer replies than it counts', async () => {
    const result = await runAction(action, {
      inputs: {channel_id: channelId, thread_ts: threadTs},
      tools: {
        slack: {
          read_thread: () =>
            toolResult({
              messages: [
                {ts: threadTs, user: 'U1', text: 'parent', reply_count: 3},
                {ts: '1721300100.000100', user: 'U1', text: 'reply'},
              ],
            }),
          read_user_profile: () => toolResult({user: {real_name: 'Ada Lovelace'}}),
          get_permalink: () => toolResult({}),
        },
      },
    });
    workspaces.push(result.workspace);

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {message_count: 2, complete: false},
    });
    const markdown = await result.workspace.read('context/slack-thread.md');
    expect(markdown).toContain('Incomplete: 1 of 3 replies retrieved.');
    expect(markdown).toContain('## Ada Lovelace, 2024-07-18T10:53:20Z');
  });

  it('fails without writing a file when Slack rejects the thread read', async () => {
    const result = await runAction(action, {
      inputs: {channel_id: channelId, thread_ts: threadTs},
      tools: {
        slack: {
          read_thread: () => {
            throw toolError({code: 'provider-rejected', message: 'thread_not_found'});
          },
          read_user_profile: () => toolResult({}),
          get_permalink: () => toolResult({}),
        },
      },
    });
    workspaces.push(result.workspace);

    expect(result.status).toBe('failed');
    await expect(result.workspace.read('context/slack-thread.md')).rejects.toThrow();
  });
});
