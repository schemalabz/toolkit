#!/usr/bin/env node
import { read } from './core.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const url = args.find((a) => !a.startsWith('--'));
if (!url) { console.error('usage: page-read <url> [--json]'); process.exit(1); }

const res = await read(url);
if (json) console.log(JSON.stringify(res));
else console.log(res.markdown);
