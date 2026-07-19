#!/usr/bin/env node

import {runBuildRunnerImageCli} from '../dist/build-runner-image.js';

runBuildRunnerImageCli(process.argv.slice(2));
