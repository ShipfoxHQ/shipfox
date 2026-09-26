#!/usr/bin/env node

import {runBuildRunnerBaseCli} from '../dist/build-runner-base.js';

runBuildRunnerBaseCli(process.argv.slice(2));
