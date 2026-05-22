#!/usr/bin/env node
/**
 * End-to-end smoke test for create-volo-app against a local volo-app template.
 *
 * Uses fixed paths only. Nothing is deleted unless you run `cleanup`.
 *
 * Usage:
 *   node scripts/test-volo-flow.mjs run [--force]
 *   node scripts/test-volo-flow.mjs dev
 *   node scripts/test-volo-flow.mjs stop
 *   node scripts/test-volo-flow.mjs cleanup
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(CLI_ROOT, '.tmp/volo-flow-test');
const STATE_FILE = path.join(CLI_ROOT, '.tmp/volo-flow-test.state.json');
const CONFIG_FILE = path.join(CLI_ROOT, 'examples/volo-config.local.json');
const DEV_READY_TIMEOUT_MS = 120_000;
const DEV_STOP_TIMEOUT_MS = 30_000;

const command = process.argv[2] ?? 'run';
const force = process.argv.includes('--force');

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function extractFailureMessage(output) {
  const plain = stripAnsi(output).trim();
  if (!plain) return null;

  const cliError = plain.match(/❌ Error:\s*([\s\S]*?)(?:\n\s*\n|$)/);
  if (cliError?.[1]) return cliError[1].trim();

  const failedStep = plain.match(/✖\s+(.+)/g);
  if (failedStep?.length) {
    return failedStep[failedStep.length - 1].replace(/^✖\s+/, '').trim();
  }

  return plain.split('\n').map((line) => line.trim()).filter(Boolean).slice(-4).join('\n');
}

function testEnv() {
  const localBin = path.join(CLI_ROOT, 'node_modules', '.bin');
  const pathParts = (process.env.PATH ?? '').split(path.delimiter);
  const filtered = pathParts.filter((entry) => {
    if (!entry) {
      return false;
    }

    try {
      return path.resolve(entry) !== localBin;
    } catch {
      return true;
    }
  });

  return {
    ...process.env,
    PATH: filtered.join(path.delimiter),
  };
}

function resolveTemplatePath() {
  const templatePath = process.env.VOLO_APP_TEMPLATE
    ? path.resolve(process.env.VOLO_APP_TEMPLATE)
    : path.resolve(CLI_ROOT, '..', 'volo-app');

  if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isDirectory()) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  return templatePath;
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(`State file not found: ${STATE_FILE}\n  Run pnpm test:volo-flow first.`);
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(updates) {
  const state = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    : {};

  const next = { ...state, ...updates };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

function clearDevState() {
  writeState({
    devPid: undefined,
    frontendUrl: undefined,
    devStartedAt: undefined,
  });
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function parseFrontendUrl(output) {
  const plain = stripAnsi(output);
  const match = plain.match(/Frontend:\s+(https?:\/\/\S+)/i);
  return match?.[1]?.trim() ?? null;
}

function releaseDevChild(child) {
  child.stdout?.removeAllListeners();
  child.stderr?.removeAllListeners();
  child.removeAllListeners('exit');
  child.removeAllListeners('error');
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function signalDevProcess(pid, signal) {
  if (process.platform === 'win32') {
    process.kill(pid, signal);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') {
      process.kill(pid, signal);
      return;
    }
    throw error;
  }
}

function listTestDirProcessPids() {
  if (process.platform === 'win32') {
    return [];
  }

  const result = spawnSync('pgrep', ['-f', TEST_DIR], {
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout?.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split('\n')
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopOrphanTestProcesses({ quiet = false } = {}) {
  const pids = listTestDirProcessPids();
  if (pids.length === 0) {
    return false;
  }

  if (!quiet) {
    console.log(`Stopping orphaned test processes (${pids.length})...`);
  }

  for (const pid of pids) {
    try {
      signalDevProcess(pid, 'SIGINT');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  const deadline = Date.now() + DEV_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (listTestDirProcessPids().length === 0) {
      return true;
    }
    await sleep(250);
  }

  for (const pid of listTestDirProcessPids()) {
    try {
      signalDevProcess(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  await sleep(2000);
  return listTestDirProcessPids().length === 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printPlan({ templatePath, mode }) {
  console.log('Test plan');
  console.log(`  Template:  ${templatePath}`);
  console.log(`  Test dir:  ${TEST_DIR}`);
  console.log(`  State:     ${STATE_FILE}`);
  console.log('');

  if (mode === 'run') {
    console.log('Run will:');
    console.log('  1. Build the CLI');
    console.log('  2. Scaffold into the test dir above');
    console.log('  3. Verify structure and builds');
    console.log('');
    console.log('Run will NOT start the dev server or delete anything.');
    console.log('After run succeeds, start dev manually, then browser-test.');
    console.log('');
  }

  if (mode === 'dev') {
    console.log('Dev will:');
    console.log('  1. Start the scaffolded app dev server in the background');
    console.log('  2. Wait for "Your app is ready at:"');
    console.log('  3. Record pid and frontend URL in the state file');
    console.log('');
  }

  if (mode === 'stop') {
    console.log('Stop will send SIGINT to the dev server pid recorded in state.');
    console.log('');
  }

  if (mode === 'cleanup') {
    console.log('Cleanup will:');
    console.log('  1. Stop the dev server if one is recorded in state');
    console.log('  2. Delete ONLY:');
    console.log(`     - ${TEST_DIR}`);
    console.log(`     - ${STATE_FILE}`);
    console.log('');
  }
}

function runCommand(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: options.cwd ?? CLI_ROOT,
    stdio: options.inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: options.env ?? testEnv(),
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.status !== 0) {
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(extractFailureMessage(combined) || `exit code ${result.status}`);
  }

  return result;
}

function runCommandStreaming(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(command, args, {
      cwd: options.cwd ?? CLI_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: options.env ?? testEnv(),
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      chunks.push(chunk);
    });

    child.on('error', (error) => reject(new Error(error.message)));

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const output = Buffer.concat(chunks).toString('utf8');
      reject(new Error(extractFailureMessage(output) || `exit code ${code}`));
    });
  });
}

class StepTracker {
  constructor() {
    this.steps = [];
  }

  async run(name, fn) {
    process.stdout.write(`${name}... `);
    try {
      const value = await fn();
      console.log('OK');
      this.steps.push({ name, status: 'passed' });
      return value;
    } catch (error) {
      console.log('FAILED');
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${message}`);
      this.steps.push({ name, status: 'failed', error: message });
      throw error;
    }
  }

  printSummary() {
    console.log('');
    console.log('Summary');
    for (const step of this.steps) {
      const mark = step.status === 'passed' ? 'OK' : 'FAILED';
      console.log(`  [${mark}] ${step.name}`);
      if (step.error) {
        for (const line of step.error.split('\n')) {
          console.log(`        ${line}`);
        }
      }
    }
  }

  get failedStep() {
    return this.steps.find((step) => step.status === 'failed');
  }
}

function verifyStructure() {
  const requiredEntries = ['package.json', 'server', 'ui', 'scripts/post-setup.js'];
  for (const entry of requiredEntries) {
    const target = path.join(TEST_DIR, entry);
    if (!fs.existsSync(target)) {
      throw new Error(`Missing ${target}`);
    }
  }
}

function verifyBuilds() {
  runCommand(['pnpm', '--dir', TEST_DIR, 'install']);
  runCommand(['pnpm', '--dir', path.join(TEST_DIR, 'ui'), 'run', 'build']);
  runCommand(['pnpm', '--dir', path.join(TEST_DIR, 'server'), 'exec', 'tsc', '--noEmit']);
}

function ensureTestDirAvailable() {
  if (!fs.existsSync(TEST_DIR)) {
    return;
  }

  if (!force) {
    throw new Error(
      `Test dir already exists: ${TEST_DIR}\n` +
      '  Run cleanup first, or re-run with --force to replace it.'
    );
  }

  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

async function runFlow() {
  const templatePath = resolveTemplatePath();
  printPlan({ templatePath, mode: 'run' });

  const tracker = new StepTracker();

  try {
    await tracker.run('Check test dir', async () => {
      ensureTestDirAvailable();
    });

    await tracker.run('Check pnpm', async () => {
      runCommand(['pnpm', '--version']);
    });

    await tracker.run('Build CLI', async () => {
      runCommand(['pnpm', 'run', 'build'], { inherit: true });
    });

    await tracker.run('Scaffold test project', async () => {
      await runCommandStreaming('node', [
        'bin/cli.js',
        TEST_DIR,
        '--template',
        templatePath,
        '--config',
        CONFIG_FILE,
      ]);
    });

    await tracker.run('Verify scaffold structure', async () => {
      verifyStructure();
    });

    await tracker.run('Verify builds', async () => {
      verifyBuilds();
    });

    writeState({
      testDir: TEST_DIR,
      templatePath,
      createdAt: new Date().toISOString(),
    });

    tracker.printSummary();

    console.log('');
    console.log('Scaffold and verification complete.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. pnpm test:volo-flow:dev');
    console.log('  2. Browser-test the frontend URL');
    console.log('  3. pnpm test:volo-flow:stop');
    console.log('  4. pnpm test:volo-flow:cleanup');
    console.log('');
    console.log(JSON.stringify({
      status: 'ready',
      steps: tracker.steps,
      testDir: TEST_DIR,
      templatePath,
    }, null, 2));
  } catch {
    tracker.printSummary();
    console.error('');
    console.error(`Stopped at: ${tracker.failedStep?.name ?? 'unknown step'}`);
    console.error(`Test dir left in place: ${TEST_DIR}`);
    console.error('');
    console.error(JSON.stringify({
      status: 'failed',
      steps: tracker.steps,
      failedStep: tracker.failedStep?.name ?? null,
      testDir: TEST_DIR,
    }, null, 2));
    process.exit(1);
  }
}

async function runDev() {
  if (!fs.existsSync(TEST_DIR)) {
    throw new Error(`Test dir not found: ${TEST_DIR}\n  Run pnpm test:volo-flow first.`);
  }

  const state = readState();
  if (state.devPid && isProcessRunning(state.devPid)) {
    throw new Error(
      `Dev server already running (pid ${state.devPid}).\n` +
      '  Run pnpm test:volo-flow:stop first.'
    );
  }

  printPlan({
    templatePath: state.templatePath ?? resolveTemplatePath(),
    mode: 'dev',
  });

  let output = '';
  let settled = false;

  const child = spawn('node', ['scripts/run-dev.js'], {
    cwd: TEST_DIR,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...testEnv(),
      VOLO_DEV_IGNORE_STDIN: '1',
    },
  });

  let readyTimeoutId;

  const readyPromise = new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(readyTimeoutId);
      fn(value);
    };

    const handleOutput = (chunk) => {
      output += chunk.toString();
      const frontendUrl = parseFrontendUrl(output);
      if (frontendUrl) {
        settle(resolve, frontendUrl);
      }
    };

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      handleOutput(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      handleOutput(chunk);
    });

    child.on('error', (error) => {
      settle(reject, new Error(error.message));
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }

      if (code === 0 || signal) {
        return;
      }

      settle(
        reject,
        new Error(extractFailureMessage(output) || `Dev server exited with code ${code}`),
      );
    });

    readyTimeoutId = setTimeout(() => {
      settle(reject, new Error(`Timed out waiting for dev server (${DEV_READY_TIMEOUT_MS / 1000}s)`));
    }, DEV_READY_TIMEOUT_MS);
  });

  try {
    const frontendUrl = await readyPromise;
    releaseDevChild(child);

    const nextState = writeState({
      devPid: child.pid,
      frontendUrl,
      devStartedAt: new Date().toISOString(),
    });

    console.log('');
    console.log(`Dev server running (pid ${child.pid})`);
    console.log(`Frontend: ${frontendUrl}`);
    console.log(`State: ${STATE_FILE}`);
    console.log('');
    console.log('Next: browser-test the frontend URL, then run pnpm test:volo-flow:stop');
    console.log('');
    console.log(JSON.stringify({
      status: 'dev-ready',
      devPid: nextState.devPid,
      frontendUrl: nextState.frontendUrl,
      testDir: TEST_DIR,
    }, null, 2));
  } catch (error) {
    releaseDevChild(child);
    if (child.pid && isProcessRunning(child.pid)) {
      try {
        process.kill(child.pid, 'SIGINT');
      } catch {
        // Best effort cleanup for a failed startup.
      }
    }
    throw error;
  }
}

async function stopDev({ quiet = false } = {}) {
  let state;

  try {
    state = readState();
  } catch (error) {
    if (quiet) {
      return;
    }
    throw error;
  }

  const { devPid } = state;

  if (!devPid) {
    if (!quiet) {
      console.log('No dev server recorded in state.');
    }
    if (await stopOrphanTestProcesses({ quiet })) {
      if (!quiet) {
        console.log('Orphaned test processes stopped.');
      }
    }
    return;
  }

  if (!isProcessRunning(devPid)) {
    if (!quiet) {
      console.log(`Dev server pid ${devPid} is not running.`);
    }
    clearDevState();
    await stopOrphanTestProcesses({ quiet });
    return;
  }

  if (!quiet) {
    console.log(`Stopping dev server (pid ${devPid})...`);
  }

  try {
    signalDevProcess(devPid, 'SIGINT');
  } catch (error) {
    if (error.code === 'ESRCH') {
      clearDevState();
      await stopOrphanTestProcesses({ quiet });
      return;
    }
    throw error;
  }

  const deadline = Date.now() + DEV_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessRunning(devPid) && listTestDirProcessPids().length === 0) {
      clearDevState();
      if (!quiet) {
        console.log('Dev server stopped.');
      }
      return;
    }
    await sleep(250);
  }

  if (isProcessRunning(devPid)) {
    try {
      signalDevProcess(devPid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }

    await sleep(2000);
  }

  await stopOrphanTestProcesses({ quiet: true });

  if (isProcessRunning(devPid) || listTestDirProcessPids().length > 0) {
    throw new Error(`Dev server pid ${devPid} did not stop within ${DEV_STOP_TIMEOUT_MS / 1000}s`);
  }

  clearDevState();
  if (!quiet) {
    console.log('Dev server stopped.');
  }
}

async function runCleanup() {
  printPlan({ templatePath: resolveTemplatePath(), mode: 'cleanup' });

  await stopDev({ quiet: true });

  let removed = 0;

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    console.log(`Removed ${TEST_DIR}`);
    removed += 1;
  } else {
    console.log(`Nothing to remove at ${TEST_DIR}`);
  }

  if (fs.existsSync(STATE_FILE)) {
    fs.rmSync(STATE_FILE, { force: true });
    console.log(`Removed ${STATE_FILE}`);
    removed += 1;
  }

  console.log(removed > 0 ? 'Cleanup complete' : 'Nothing to clean up');
}

function printUsage() {
  console.log(`Usage:
  node scripts/test-volo-flow.mjs run [--force]   Scaffold and verify (fixed test dir)
  node scripts/test-volo-flow.mjs dev               Start dev server; record pid in state
  node scripts/test-volo-flow.mjs stop              Stop dev server from state pid
  node scripts/test-volo-flow.mjs cleanup           Stop dev server and remove test artifacts

Environment:
  VOLO_APP_TEMPLATE  Path to local volo-app checkout (default: ../volo-app)`);
}

if (command === 'run') {
  await runFlow();
} else if (command === 'dev') {
  try {
    await runDev();
  } catch (error) {
    console.error('');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else if (command === 'stop') {
  try {
    await stopDev();
  } catch (error) {
    console.error('');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else if (command === 'cleanup') {
  try {
    await runCleanup();
  } catch (error) {
    console.error('');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else if (command === 'help' || command === '--help' || command === '-h') {
  printUsage();
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
