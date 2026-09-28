import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {defineAction} from '@shipfox/actions';

interface ThreadPage {
  messages: {ts: string; text: string}[];
  response_metadata?: {next_cursor?: string};
}

export default defineAction(async ({inputs, tools}) => {
  const messages: ThreadPage['messages'] = [];
  let cursor: string | undefined;
  do {
    const page = await tools.slack.call('read_thread', {
      channel_id: inputs.channel_id,
      message_ts: inputs.thread_ts,
      cursor,
    });
    const body = page.structured as ThreadPage;
    messages.push(...body.messages);
    cursor = body.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const destination = String(inputs.destination);
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, messages.map((message) => `- ${message.text}\n`).join(''));
  return {path: destination, message_count: messages.length};
});
