import {type ActionTestWorkspace, runAction, toolError, toolResult} from '@shipfox/actions/testing';

const action = new URL('./', import.meta.url);
const channelId = 'C0123';
const threadTs = '1721300000.000100';

describe('slack-thread', () => {
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
});
