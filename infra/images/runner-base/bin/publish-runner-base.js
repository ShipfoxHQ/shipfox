#!/usr/bin/env node

import {runPublishRunnerBaseCli} from '../dist/publication.js';

runPublishRunnerBaseCli(process.argv.slice(2));
