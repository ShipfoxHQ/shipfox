#!/usr/bin/env node

import {runApplicationReleaseCli} from '../dist/cli.js';

runApplicationReleaseCli(process.argv.slice(2));
