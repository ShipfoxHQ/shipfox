#!/usr/bin/env node
import {run} from './commands.js';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
});
