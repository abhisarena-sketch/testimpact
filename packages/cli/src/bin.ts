#!/usr/bin/env node
import { main } from './cli.js';

const code = await main(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: process.cwd(),
  env: process.env,
  isTTY: Boolean(process.stdout.isTTY),
});
process.exitCode = code;
