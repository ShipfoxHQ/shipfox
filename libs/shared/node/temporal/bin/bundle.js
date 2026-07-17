#!/usr/bin/env node

import {runBundleCommand} from '../dist/bin/bundle.js';

await runBundleCommand(process.argv.slice(2));
