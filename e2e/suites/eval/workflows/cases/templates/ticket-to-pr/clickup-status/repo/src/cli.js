#!/usr/bin/env node
import {report} from './report.js';

const rows = [
  {name: 'open', total: 3},
  {name: 'closed', total: 5},
];

process.stdout.write(`${report(process.argv.slice(2), rows)}\n`);
