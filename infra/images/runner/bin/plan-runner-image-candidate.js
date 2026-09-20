#!/usr/bin/env node

import {runRunnerImageCandidatePlannerCli} from '../dist/candidate-planner.js';

runRunnerImageCandidatePlannerCli(process.argv.slice(2));
