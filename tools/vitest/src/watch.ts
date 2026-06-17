#! /usr/bin/env node

import {runVitest} from './run-vitest.js';

runVitest(['watch', ...process.argv.slice(2)]);
