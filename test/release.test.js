'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, beforeEach, test } = require('node:test');

const release = require('../lib/release.js');

const ASSET = 'wut-x86_64-unknown-linux-musl.tar.gz';
const VERSION_TEXT = '0.0.2';

let server;
let origin;
let served;
let workspace;

function tarUp(contents, destination) {
  const source = fs.mkdtempSync(path.join(workspace, 'src-'));
  for (const [name, body] of Object.entries(contents)) {
    const file = path.join(source, name);
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
  }
  const result = spawnSync('tar', ['-czf', destination, '-C', source, ...Object.keys(contents)]);
  assert.equal(result.status, 0, `tar failed: ${result.stderr}`);
}

before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wut-npm-test-'));
  served = fs.mkdtempSync(path.join(workspace, 'served-'));

  server = http.createServer((request, response) => {
    const name = path.basename(request.url.split('?')[0]);
    const file = path.join(served, name);
    if (!fs.existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.WUT_NPM_BASE_URL = origin;
});

after(() => {
  server.close();
  fs.rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of fs.readdirSync(served)) {
    fs.rmSync(path.join(served, name), { force: true });
  }
  process.env.WUT_NPM_CACHE_DIR = fs.mkdtempSync(path.join(workspace, 'cache-'));
});

function publishRelease({ tamper = false } = {}) {
  const archive = path.join(workspace, `${ASSET}.${crypto.randomUUID()}`);
  tarUp({ wut: `#!/bin/sh\necho ${VERSION_TEXT}\n` }, archive);

  // The published checksum always describes the pristine archive, so a tampered
  // download must be rejected before anything is unpacked.
  const pristine = fs.readFileSync(archive);
  const hash = crypto.createHash('sha256').update(pristine).digest('hex');
  const bytes = tamper ? Buffer.concat([pristine, Buffer.from('tampered')]) : pristine;

  fs.writeFileSync(path.join(served, ASSET), bytes);
  fs.writeFileSync(path.join(served, `${ASSET}.sha256`), `${hash}  ${ASSET}\n`);
  return hash;
}

test('maps platforms to release assets', () => {
  assert.equal(release.assetFor('darwin', 'arm64'), 'wut-aarch64-apple-darwin.tar.gz');
  assert.equal(release.assetFor('darwin', 'x64'), 'wut-x86_64-apple-darwin.tar.gz');
  assert.equal(release.assetFor('linux', 'arm64'), 'wut-aarch64-unknown-linux-musl.tar.gz');
  assert.equal(release.assetFor('linux', 'x64'), ASSET);
  assert.throws(() => release.assetFor('win32', 'x64'), /unsupported platform/);
  assert.throws(() => release.assetFor('linux', 'ia32'), /unsupported platform/);
});

test('parses and validates checksum files', () => {
  const hash = 'a'.repeat(64);
  assert.equal(release.expectedChecksum(`${hash}  ${ASSET}\n`, ASSET), hash);
  assert.equal(release.expectedChecksum(`${hash} *${ASSET}\n`, ASSET), hash);
  assert.equal(release.expectedChecksum(`${hash}\n`, ASSET), hash);
  assert.throws(() => release.expectedChecksum('nonsense', ASSET), /malformed checksum/);
  assert.throws(() => release.expectedChecksum(`${hash}  other.tar.gz`, ASSET), /names other/);
});

test('downloads, verifies, unpacks, and runs the binary', async () => {
  const published = publishRelease();
  const binary = await release.ensureBinary();

  assert.equal(published.length, 64);
  assert.ok(fs.existsSync(binary), `missing binary at ${binary}`);
  assert.ok(fs.statSync(binary).mode & 0o100, 'binary is not executable');
  assert.deepEqual(fs.readdirSync(path.dirname(binary)), ['wut'], 'cache should hold only the binary');
  assert.match(fs.readFileSync(binary, 'utf8'), new RegExp(VERSION_TEXT));

  const run = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), VERSION_TEXT);
});

test('reuses the cached binary without re-downloading', async () => {
  publishRelease();
  const first = await release.ensureBinary();

  for (const name of fs.readdirSync(served)) {
    fs.rmSync(path.join(served, name), { force: true });
  }

  const second = await release.ensureBinary();
  assert.equal(second, first);
  assert.equal(spawnSync(second, ['--version'], { encoding: 'utf8' }).stdout.trim(), VERSION_TEXT);
});

test('refuses a tampered archive and installs nothing', async () => {
  const published = publishRelease({ tamper: true });

  await assert.rejects(release.ensureBinary(), (error) => {
    assert.match(error.message, /checksum mismatch/);
    assert.match(error.message, new RegExp(published.slice(0, 12)));
    return true;
  });

  assert.equal(
    fs.existsSync(release.binaryPath()),
    false,
    'a rejected download must not leave a binary behind',
  );
});
