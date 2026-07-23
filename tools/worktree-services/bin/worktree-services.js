#!/usr/bin/env node

import('../dist/cli.js')
  .then(({main}) => main(process.argv.slice(2)))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
