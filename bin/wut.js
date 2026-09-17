#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { ensureBinary } = require('../lib/release.js');

async function main() {
  let binary;
  try {
    binary = await ensureBinary();
  } catch (error) {
    process.stderr.write(`wut: ${error.message}\n`);
    if (error.hint) {
      process.stderr.write(`     ${error.hint}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on('error', (error) => {
    process.stderr.write(`wut: could not start ${binary}: ${error.message}\n`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    process.exitCode = code === null ? (signal ? 1 : 0) : code;
  });
}

main();
