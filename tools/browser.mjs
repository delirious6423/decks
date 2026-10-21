// Headless CLI and private per-user worker. No extra Python dependencies or server API.
// SB_BROWSER_WORKER=0 runs one job without a worker (diagnostics / benchmarking).
// SB_BROWSER_IDLE_MS controls idle shutdown (default: two minutes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const base = (process.env.SB_URL || `http://localhost:${process.env.SB_PORT || 8790}`).replace(/\/$/, '');
// Include source files so an updated checkout never reuses an old worker implementation.
const identity = createHash('sha256').update(script + base + (process.env.SB_CHROME || '') + (process.env.PLAYWRIGHT_BROWSERS_PATH || '') + (process.env.SB_BROWSER_IDLE_MS || ''))
  .update(fs.readFileSync(script)).update(fs.readFileSync(path.join(path.dirname(script), 'browser-jobs.mjs'))).digest('hex').slice(0, 20);
const directory = path.join(os.tmpdir(), `decks-browser-${process.getuid()}`);
const socketPath = path.join(directory, `${identity}.sock`);
const lockPath = path.join(directory, `${identity}.lock`);
const idleMs = Math.max(100, Number(process.env.SB_BROWSER_IDLE_MS) || 120000);

function privateDirectory() {
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error(`Worker directory must be private: ${directory}`);
}

function claim() {
  try { fs.mkdirSync(lockPath, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Serialize stale-lock recovery too: simultaneous clients may restart a dead worker.
    const reaper = lockPath + '.reap';
    try { fs.mkdirSync(reaper, { mode: 0o700 }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(reaper).mtimeMs > 30000) fs.rmdirSync(reaper); } catch (e) {}
      return false;
    }
    try {
      try {
        const pid = Number(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) return false;
        // A killed orphan can remain a zombie until its parent reaps it. kill(0)
        // still succeeds for that PID, although it cannot serve the socket.
        const zombie = process.platform === 'linux' && (() => {
          try { return /^State:\s+Z\b/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); }
          catch (e) { return false; }
        })();
        if (!zombie) {
          try { process.kill(pid, 0); return false; } catch (e) { if (e.code !== 'ESRCH') return false; }
        }
      } catch (e) {
        if (e.code !== 'ENOENT') return false;
        try { if (Date.now() - fs.statSync(lockPath).mtimeMs < 10000) return false; } catch (e) {}
      }
      fs.rmSync(lockPath, { recursive: true, force: true });
      return claim();
    } finally {
      fs.rmdirSync(reaper);
    }
  }
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
  return true;
}

async function worker() {
  privateDirectory();
  if (!claim()) return;
  let browser, timer, closing = false, active = 0, tail = Promise.resolve();
  const jobs = await import('./browser-jobs.mjs');
  const shutdown = async () => {
    if (closing) return;
    closing = true; clearTimeout(timer);
    server.close();
    if (browser) await browser.close().catch(() => {});
    try { fs.unlinkSync(socketPath); } catch (e) {}
    fs.rmSync(lockPath, { recursive: true, force: true });
  };
  const arm = () => { clearTimeout(timer); if (!active && !closing) timer = setTimeout(shutdown, idleMs); };
  // Serializing jobs keeps expensive exports from competing for the same CPU.
  const server = net.createServer((socket) => {
    let input = '', received = false;
    socket.on('error', () => {});
    socket.setTimeout(10000, () => { if (!received) socket.destroy(); });
    socket.on('data', (chunk) => {
      if (received) return;
      input += chunk;
      if (input.length > 1024 * 1024) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      received = true; socket.setTimeout(0); active++; clearTimeout(timer);
      tail = tail.then(async () => {
        try {
          const request = JSON.parse(input.slice(0, input.indexOf('\n')));
          if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== 'string')) throw new Error('Invalid browser job');
          if (request.args[0] === 'worker-status') {
            socket.end(JSON.stringify({ output: JSON.stringify({ running: true, pid: process.pid, browserConnected: !!browser?.isConnected() }) + '\n' }) + '\n');
            return;
          }
          if (request.args[0] === 'worker-stop') {
            socket.end(JSON.stringify({ output: 'Browser worker stopped\n' }) + '\n');
            setImmediate(shutdown); return;
          }
          const output = await jobs.runJob(request.args, async () => {
            if (!browser?.isConnected()) browser = await jobs.launchBrowser();
            return browser;
          });
          socket.end(JSON.stringify({ output }) + '\n');
        } catch (e) { socket.end(JSON.stringify({ error: e.message }) + '\n'); }
        finally { active--; arm(); }
      });
    });
  });
  server.on('error', async () => { await shutdown(); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, shutdown);
  try { fs.unlinkSync(socketPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  fs.chmodSync(socketPath, 0o600); arm();
}

function request(args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '', settled = false;
    socket.setEncoding('utf8');
    const fail = (e) => { if (!settled) { settled = true; socket.destroy(); reject(e); } };
    socket.setTimeout(180000, () => fail(new Error('Browser worker timed out')));
    socket.on('connect', () => socket.write(JSON.stringify({ args }) + '\n'));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n') || settled) return;
      settled = true; socket.end();
      try { resolve(JSON.parse(data.slice(0, data.indexOf('\n')))); } catch (e) { reject(e); }
    });
    socket.on('end', () => fail(new Error('Browser worker stopped before returning a result')));
  });
}

async function main() {
  if (argv[0] === '--worker') { await worker(); return; }
  if (argv[0] === 'chrome') { console.log((await import('./browser-jobs.mjs')).chrome()); return; }
  if (process.env.SB_BROWSER_WORKER === '0') {
    const jobs = await import('./browser-jobs.mjs'); let browser;
    try { process.stdout.write(await jobs.runJob(argv, async () => browser ||= await jobs.launchBrowser())); }
    finally { if (browser) await browser.close(); }
    return;
  }
  privateDirectory();
  let result;
  try { result = await request(argv); }
  catch (e) {
    // Retry only connection failures before a job was accepted: never duplicate a PDF job.
    if (!['ENOENT', 'ECONNREFUSED'].includes(e.code)) throw e;
    if (argv[0] === 'worker-status') { console.log(JSON.stringify({ running: false })); return; }
    if (argv[0] === 'worker-stop') { console.log('Browser worker is not running'); return; }
    // Report missing Playwright or Chrome directly instead of waiting for a dead daemon.
    (await import('./browser-jobs.mjs')).chrome();
    const child = spawn(process.execPath, [script, '--worker'], { detached: true, stdio: 'ignore', env: process.env });
    child.on('error', () => {}); child.unref();
    const deadline = Date.now() + 15000;
    while (true) {
      await new Promise((r) => setTimeout(r, 50));
      try { result = await request(argv); break; }
      catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes(e.code) || Date.now() >= deadline) throw e; }
    }
  }
  if (result.error) throw new Error(result.error);
  process.stdout.write(result.output);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
