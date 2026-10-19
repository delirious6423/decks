// Integration: start a scratch server and set SB_URL, SB_DECKS_DIR and SB_CHROME.
// node --test tests/browser.test.mjs
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '../tools/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const base = process.env.SB_URL || 'http://127.0.0.1:18799';
const api = `${base}/api/decks/bench-blank/state`;
const url = `${base}/d/bench-blank/deck.html`;
let browser, prefix, key;
const contexts = [];
const failures = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-test-'));
const cli = (...args) => exec(process.execPath, ['tools/browser.mjs', ...args], { env: { ...process.env, SB_URL: base }, timeout: 60000 });
async function clear() {
  const state = await (await fetch(api)).json();
  await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: Object.keys(state.keys) }) });
}
async function page(context) {
  context ||= await browser.newContext(); contexts.push(context);
  const p = await context.newPage();
  p.on('pageerror', e => failures.push(e.message));
  await p.goto(url); await p.evaluate(() => window.__DECK_READY);
  return p;
}
async function save(p, action = '') {
  return p.evaluate(action => new Promise(resolve => {
    window.addEventListener('sb:saved', () => resolve(), { once: true });
    if (action) eval(action);
    snapshot(); window.__SB.flush();
  }), action);
}
async function stored() { return JSON.parse((await (await fetch(api)).json()).keys[key] || '{}'); }
async function eventually(check) {
  for(let i=0;i<100;i++) { if(await check()) return; await new Promise(r=>setTimeout(r,50)); }
  assert.fail('Expected state did not arrive');
}
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.SB_CHROME, headless: true });
  prefix = (await (await fetch(`${base}/api/decks/bench-blank`)).json());
  const p = await page(); key = await p.evaluate(() => KEY()); await p.context().close();
  await clear();
});
after(async () => {
  for(const context of contexts) await context.close().catch(()=>{});
  await browser.close(); await clear(); fs.rmSync(tmp,{recursive:true,force:true});
  assert.deepEqual(failures, []);
});
afterEach(async () => { for (const context of contexts.splice(0)) await context.close().catch(() => {}); });

test('incremental cache notices synchronous DOM, attribute and definition edits', async () => {
  const p = await page();
  const result = await p.evaluate(() => {
    currentData();
    const el = document.querySelector('[data-id="point-1"] [contenteditable]');
    el.innerHTML = 'Changed <a href="https://example.com">link</a>';
    const data = currentData();
    el.querySelector('a').setAttribute('href','https://example.org');
    const attribute = currentData()['point-1'][0];
    const before = defHash('point-1'); LIBRARY['point-1'].body[0] = 'Changed default';
    const after = currentData().__def['point-1'];
    return { text: data['point-1'][0], attribute, before, after };
  });
  assert.match(result.text,/Changed/); assert.match(result.attribute,/example.org/);
  assert.notEqual(result.before,result.after); await p.context().close();
});

test('re-added wrappers and reverted versions cannot reuse stale cached fields', async () => {
  await clear();const p=await page();
  await p.evaluate(()=>{
    currentData();applyOrder(['title','part-1','point-2','closing']);
    stash.get('point-1').querySelector('[contenteditable]').innerHTML='Changed while detached';
    applyOrder(['title','part-1','point-1','point-2','closing']);
  });
  assert.equal(await p.evaluate(()=>currentData()['point-1'][0]),'Changed while detached');
  p.once('dialog',d=>d.accept());
  await p.evaluate(()=>document.getElementById('reload-btn').click());
  assert.notEqual(await p.evaluate(()=>currentData()['point-1'][0]),'Changed while detached');
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem(KEY()))),{__reverted:true});
});

test('wire saves only changed leaves and merges independent edits from two tabs', async () => {
  await clear(); const a = await page(); await save(a);
  const b = await page();
  const requests = []; a.on('request',r=>{if(r.method()==='PUT') requests.push(r.postDataJSON());});
  await save(a, `document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML = 'From tab A'`);
  await save(b, `document.querySelector('[data-id="point-2"] [contenteditable]').innerHTML = 'From tab B'`);
  const s = await stored(); assert.equal(s['point-1'][0],'From tab A'); assert.equal(s['point-2'][0],'From tab B');
  assert.deepEqual(requests.at(-1).set, {});
  assert.equal(requests.at(-1).patch[key].length,1);
  assert.deepEqual(requests.at(-1).patch[key][0].path,['point-1']);
  await a.context().close(); await b.context().close();
});

test('comment deletion, removal, reorder, undo and restore remain compatible', async () => {
  await clear(); const p = await page();
  await save(p, `document.querySelector('[data-id="point-1"] textarea.fb').value = 'Feedback'`);
  await save(p, `document.querySelector('[data-id="point-1"] textarea.fb').value = ''; applyOrder(['closing','point-2','title'])`);
  let s = await stored(); assert.deepEqual(s.__order,['closing','point-2','title']); assert.equal(s.__fb['point-1'],undefined); assert.equal(s['point-1'],undefined);
  await save(p, 'applyOrder(undoStack.pop(), false)');
  s = await stored(); assert.ok(s.__order.includes('point-1'));
  await p.reload(); await p.evaluate(()=>window.__DECK_READY);
  assert.deepEqual(await p.evaluate(()=>currentData().__order),s.__order);
  await p.context().close();
});

test('offline saves survive reload and replay against newer server state', async () => {
  await clear(); const p = await page(); await save(p);
  await p.route('**/api/decks/bench-blank/state',route => route.request().method()==='PUT' ? route.abort() : route.continue());
  await p.evaluate(()=>new Promise(resolve=>{
    window.addEventListener('sb:offline',()=>resolve(),{once:true});
    document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML='Offline edit';snapshot();window.__SB.flush();
  }));
  await fetch(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({patch:{[key]:[{path:['point-2'],value:['Remote edit'],hadBase:false}]}})});
  await p.unroute('**/api/decks/bench-blank/state');
  await p.reload();
  const s=await stored();assert.equal(s['point-1'][0],'Offline edit');assert.equal(s['point-2'][0],'Remote edit');
  await p.context().close();
});

test('pending edits save before navigation and before a version switch', async () => {
  await clear(); const p=await page();
  await p.evaluate(()=>{
    const el=document.querySelector('[data-id="point-1"] [contenteditable]');el.innerHTML='Before switch';el.dispatchEvent(new Event('input',{bubbles:true}));
    renderPitch('all');restore();
  });
  await eventually(async()=> (await stored())?.['point-1']?.[0]==='Before switch');
  await p.evaluate(()=>{
    const el=document.querySelector('[data-id="point-2"] [contenteditable]');el.innerHTML='Before navigation';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await p.goto(base+'/');
  const allKey=key.replace(/deck$/,'all');
  await eventually(async()=>JSON.parse((await(await fetch(api)).json()).keys[allKey]||'{}')['point-2']?.[0]==='Before navigation');
  await p.context().close();
});

test('tabs sharing localStorage preserve independent changes', async () => {
  await clear(); const a=await page();await save(a);const b=await page(a.context());
  await save(a, `document.querySelector('[data-id="point-1"] textarea.fb').value='Comment A'`);
  await save(b, `document.querySelector('[data-id="point-2"] textarea.fb').value='Comment B'`);
  assert.deepEqual((await stored()).__fb,{'point-1':'Comment A','point-2':'Comment B'});
});

test('in-flight saves cannot be overtaken by pagehide', async () => {
  await clear();const p=await page();await save(p);
  let release, started;const arrived=new Promise(r=>{started=r;});
  const gate=new Promise(r=>{release=r;});let count=0;
  await p.route('**/api/decks/bench-blank/state',async route=>{
    if(route.request().method()==='PUT' && count++===0) {started();await gate;}
    await route.continue();
  });
  await p.evaluate(()=>{document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML='First';snapshot();window.__SB.flush();});
  await arrived;
  await p.evaluate(()=>{
    const el=document.querySelector('[data-id="point-1"] [contenteditable]');el.innerHTML='Latest';el.dispatchEvent(new Event('input',{bubbles:true}));
    window.dispatchEvent(new Event('pagehide'));window.__SB.flush();
  });
  assert.equal(count,1);release();
  await eventually(async()=>(await stored())['point-1']?.[0]==='Latest');
});

test('worker queues concurrent clients, isolates raw/saved jobs and recovers after errors', async () => {
  await clear();const p=await page();await save(p,`document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML='Saved only marker'`);
  const [a,b]=await Promise.all([cli('titles','bench-blank'),cli('titles','bench-talk')]);
  assert.equal(JSON.parse(a.stdout).length,5);assert.equal(JSON.parse(b.stdout).length,14);
  const edits=JSON.parse((await cli('edits','bench-blank')).stdout);assert.ok(edits.edits.some(e=>e.now==='Saved only marker'));
  const raw=JSON.parse((await cli('titles','bench-blank')).stdout);assert.ok(!raw.some(s=>s.title==='Saved only marker'));
  await assert.rejects(cli('titles','bench-blank','--version','missing'),/no version missing/);
  assert.equal(JSON.parse((await cli('titles','bench-talk')).stdout).length,14);
  const combined=JSON.parse((await cli('export','bench-blank',path.join(tmp,'raw.pdf'),'--check-edits','--thumb',path.join(tmp,'thumb.png'))).stdout);
  assert.ok(combined.edits.edits.some(e=>e.now==='Saved only marker'));assert.ok(fs.statSync(path.join(tmp,'raw.pdf')).size>1000);
  const pdf=await exec('pdftotext',[path.join(tmp,'raw.pdf'),'-']);assert.ok(!pdf.stdout.includes('Saved only marker'));
  await cli('export','bench-blank',path.join(tmp,'saved.pdf'),'--with-edits');
  assert.match((await exec('pdftotext',[path.join(tmp,'saved.pdf'),'-'])).stdout,/Saved only marker/);
  await cli('export','bench-workshop',path.join(tmp,'facilitator.pdf'),'--version','facilitator');
  assert.ok(fs.statSync(path.join(tmp,'facilitator.pdf')).size>1000);
  await p.context().close();
});

test('worker restarts after a crash and releases Chrome on idle shutdown', async () => {
  await cli('titles','bench-talk');
  const old=JSON.parse((await cli('worker-status')).stdout);assert.equal(old.browserConnected,true);
  process.kill(old.pid,'SIGKILL');
  const results=await Promise.all([cli('titles','bench-talk'),cli('titles','bench-blank')]);
  assert.equal(JSON.parse(results[0].stdout).length,14);assert.equal(JSON.parse(results[1].stdout).length,5);
  assert.notEqual(JSON.parse((await cli('worker-status')).stdout).pid,old.pid);
  const env={...process.env,SB_URL:base,SB_BROWSER_IDLE_MS:'200'};
  const idle=(...args)=>exec(process.execPath,['tools/browser.mjs',...args],{env,timeout:30000});
  await idle('titles','bench-talk');
  await new Promise(r=>setTimeout(r,350));
  await eventually(async()=>!JSON.parse((await idle('worker-status')).stdout).running);
  await cli('worker-stop');
});
