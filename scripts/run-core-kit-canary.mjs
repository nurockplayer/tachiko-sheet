// Source attribution: lifecycle adapted mechanically from
// nurockplayer/tachiko-work at 49d2dfad2d411d9944499c4d35b097e0cb25a7da,
// upstream tests/consumer-kit/run-canary.mjs SHA-256
// b7be9d93b7b023edabbc96095e088d9704ca87dda49f791e9a28504ef0874646.
// This helper owns the local server lifecycle and passes only the intact kit
// path to the existing Sheet canary server/browser test.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const kit = path.resolve(process.env.WORK_CORE_KIT ?? path.join(root, 'public/core-kit'));
const port = Number(process.env.TACHIKO_CANARY_PORT ?? '4186');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('TACHIKO_CANARY_PORT must be 1024..65535');
const serve = path.join(root, 'scripts', 'serve-canary.mjs');
const browser = path.join(root, 'tests', 'browser.mjs');
const environment = {
  ...process.env,
  WORK_CLIENT_KIT: kit,
  PORT: String(port),
};
const server = spawn(process.execPath, [serve], {
  cwd: root,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
let serverExited = false;
const serverExit = new Promise(resolve => server.once('exit', (code, signal) => {
  serverExited = true;
  resolve({code, signal});
}));
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => {
  serverOutput += chunk.toString();
  process.stderr.write(chunk);
});
const ready = new Promise((resolve, reject) => {
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.off('error', onError);
    server.off('exit', onExit);
    server.stdout.off('data', onStdout);
    error ? reject(error) : resolve();
  };
  const onError = error => finish(error);
  const onExit = (code, signal) => finish(new Error(`canary server exited ${signal ?? code}: ${serverOutput}`));
  const onStdout = chunk => {
    if (serverOutput.includes(`Runtime canary: http://127.0.0.1:${port}`)) finish();
    else if (chunk.toString().includes(`Runtime canary: http://127.0.0.1:${port}`)) finish();
  };
  const timer = setTimeout(() => finish(new Error('canary server did not report readiness')), 30000);
  server.once('error', onError);
  server.once('exit', onExit);
  server.stdout.on('data', onStdout);
});

async function stopServer() {
  if (serverExited || !server.pid) return;
  server.kill('SIGTERM');
  const exited = await Promise.race([
    serverExit,
    new Promise(resolve => setTimeout(() => resolve(undefined), 5000)),
  ]);
  if (exited === undefined && !serverExited) {
    server.kill('SIGKILL');
    await serverExit;
  }
}

try {
  await ready;
  const child = spawn(process.execPath, [browser, '--canary'], {
    cwd: root,
    env: {
      ...process.env,
      WORK_CLIENT_URL: `http://127.0.0.1:${port}`,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
    },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  if (result.code !== 0) process.exitCode = typeof result.code === 'number' ? result.code : 1;
} finally {
  await stopServer();
}
