import {appendFile, writeFile} from 'node:fs/promises';
import {defineAction, ToolCallError} from '@shipfox/actions';

interface ProbeCall {
  alias: string;
  tool: string;
  args?: Record<string, unknown>;
  /** Set to download instead of call. */
  destination?: string;
}

export default defineAction(async ({inputs, tools, setOutput, log}) => {
  setOutput('cwd', process.cwd());
  await writeFile('cwd.txt', process.cwd());
  await appendFile(process.env.SHIPFOX_STEP_SUMMARY ?? '', '## Probe\n');

  const results: unknown[] = [];
  for (const call of inputs.calls as ProbeCall[]) {
    const alias = tools[call.alias];
    try {
      results.push(
        call.destination === undefined
          ? (await alias.call(call.tool, call.args ?? {})).structured
          : await alias.download(call.tool, call.args ?? {}, {destination: call.destination}),
      );
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      results.push({code: error.code, outcomeUnknown: error.outcomeUnknown});
    }
  }
  setOutput('results', results);

  await new Promise((resolve) => setTimeout(resolve, inputs.sleep_ms as number));
  if (inputs.fail) throw new Error('The probe failed on purpose.');
  log.info('Probe finished');
});
