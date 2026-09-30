import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 9300 + Math.floor(Math.random() * 600);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-strike-smoke-'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find((candidate) => fsSync.existsSync(candidate));
}

const browser = findBrowser();
if (!browser) {
  console.log('SKIP browser smoke test: no Chrome/Edge executable found.');
  process.exit(0);
}

const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--mute-audio',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'http://127.0.0.1:4173/?autostart=1&debug=1&seed=42'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

async function getPageTarget() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.includes('127.0.0.1:4173'));
      if (page) return page;
    } catch {
      // Browser is still starting.
    }
    await wait(150);
  }
  throw new Error(`Browser DevTools endpoint did not start. ${stderr.slice(-800)}`);
}

const page = await getPageTarget();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const runtimeErrors = [];
const failedResources = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.text || 'Runtime exception');
  }
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    failedResources.push(`${message.params.response.status} ${message.params.response.url}`);
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !message.params.entry.text.includes('404')) {
    runtimeErrors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Evaluation failed');
  return response.result.value;
}

async function key(type, keyName, code, virtualKeyCode) {
  await send('Input.dispatchKeyEvent', {
    type,
    key: keyName,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode
  });
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await wait(1400);

  const initial = await evaluate('window.__neonStrikeDebug && window.__neonStrikeDebug.snapshot()');
  if (!initial || initial.mode !== 'playing') throw new Error('Game did not enter playing state.');
  if (initial.solids < 10) throw new Error('Generated level is missing platforms.');

  await key('keyDown', 'd', 'KeyD', 68);
  await wait(850);
  await key('keyUp', 'd', 'KeyD', 68);
  const moved = await evaluate('window.__neonStrikeDebug.snapshot()');
  if (moved.playerX <= initial.playerX + 12) throw new Error(`Player did not move: ${initial.playerX} -> ${moved.playerX}`);

  await key('keyDown', 'j', 'KeyJ', 74);
  await wait(180);
  await key('keyUp', 'j', 'KeyJ', 74);
  const fired = await evaluate('window.__neonStrikeDebug.snapshot()');
  if (fired.shotsFired <= initial.shotsFired) throw new Error('Player weapon did not fire.');

  if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join(' | ')}`);
  console.log(`PASS browser smoke: playerX ${initial.playerX.toFixed(1)} -> ${moved.playerX.toFixed(1)}, shots ${fired.shotsFired}.`);
} finally {
  socket.close();
  child.kill();
  await wait(250);
  await fs.rm(profile, { recursive: true, force: true });
}