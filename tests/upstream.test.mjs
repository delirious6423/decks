// Integration regressions for upstream features combined with the performance engine.
import {test, before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';

const exec = promisify(execFile), base = process.env.SB_URL || 'http://127.0.0.1:18799';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-upstream-'));
let browser; const contexts = [], errors = [];
const state = slug => `${base}/api/decks/${slug}/state`;
const cli = (...args) => exec(process.execPath, ['tools/browser.mjs', ...args], {env:{...process.env,SB_URL:base},timeout:60000});
async function open(slug='bench-sync') {
 const context = await browser.newContext({acceptDownloads:true}); contexts.push(context);
 await context.route('https://**', r=>r.abort());
 const page = await context.newPage(); page.on('pageerror', e=>errors.push(e.message));
 await page.goto(`${base}/d/${slug}/deck.html`);
 await page.waitForFunction(()=>document.body.classList.contains('sb-ready'));
 return page;
}
async function clear(slug='bench-sync') {
 const st=await(await fetch(state(slug))).json();
 await fetch(state(slug),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:Object.keys(st.keys)})});
 await fetch(`${base}/api/decks/${slug}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'decide',slide:'s400',decision:null,replaces:'s0'})});
}
before(async()=>{
 assert.ok(process.env.SB_DECKS_DIR, 'Use a disposable SB_DECKS_DIR');
 await exec('python3',['-c',`
import json,re
from pathlib import Path
import newdeck,sbconfig,library
reg=json.loads(sbconfig.REGISTRY.read_text())
d=next((d for d in reg['decks'] if d['slug']=='bench-sync'),None) or newdeck.create_deck('Bench sync','blank')
html=newdeck.assemble('blank','Bench sync',d['prefixes'][0])
match=re.search(r'const LIBRARY = ',html)
reader=library.Literal(html,match.end());reader.value()
slides={f's{i}':dict(cat='main',layout='plain',title=f'Slide {i+1} supports the decision',body=[f'Unique evidence for slide {i+1}'],notes=f'PRIVATE facilitator instruction number {i+1}') for i in range(500)}
slides['s400'].update(prop=True,replaces='s0')
html=html[:match.end()]+json.dumps(slides)+html[reader.pos:]
html=html.replace('blocks: CATS.flatMap(byCat)', 'blocks: '+json.dumps(list(slides)))
(Path(d['folder']).expanduser()/d['entry']).write_text(html)
`]);
 browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});
 await clear(); await clear('bench-blank');
});
afterEach(async()=>{for(const c of contexts.splice(0))await c.close();await clear();await clear('bench-blank');});
after(async()=>{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});assert.deepEqual(errors,[]);});

test('cold proposals retain their replacement and use the full logical order',async()=>{
 const p=await open();
 assert.equal(await p.evaluate(()=>LIBRARY.s400.replaces),'s0');
 assert.equal(await p.evaluate(()=>DeckData.ready(['s400'])),false);
 assert.equal(await p.locator('[data-f="proposed"] b').innerText(),'1');
 await p.evaluate(async()=>{await SlideBuilder.go('s400');SlideBuilder.decide('s400','accept');});
 await p.waitForFunction(()=>!deckIds().includes('s0'));
 assert.equal(await p.evaluate(()=>deckIds().length),499);
 await p.evaluate(()=>SlideBuilder.undo());
 await p.waitForFunction(()=>deckIds().includes('s0'));
 assert.equal(await p.evaluate(()=>deckIds().length),500);
 assert.ok(await p.locator('#deck > [data-id]').count()<10);
});

test('flush waits for in-flight and queued edits before allowing PDF work',async()=>{
 const p=await open('bench-blank'); await p.evaluate(async()=>{snapshot();await __SB.flush();});
 let release, started; const gate=new Promise(r=>release=r), arrived=new Promise(r=>started=r);let first=true;
 await p.route('**/api/decks/bench-blank/state',async r=>{if(r.request().method()==='PUT'&&first){first=false;started();await gate;}await r.continue();});
 await p.evaluate(()=>{document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML='Earlier';snapshot();window.firstFlush=__SB.flush();});
 await arrived;
 await p.evaluate(()=>{document.querySelector('[data-id="point-1"] [contenteditable]').innerHTML='Latest PDF edit';snapshot();window.finished=false;window.finalFlush=__SB.flush().then(()=>finished=true);});
 await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>finished),false);release();
 await p.evaluate(()=>window.finalFlush);
 const key=await p.evaluate(()=>KEY()), saved=await(await fetch(state('bench-blank'))).json();
 assert.equal(JSON.parse(saved.keys[key])['point-1'][0],'Latest PDF edit');
 const r=await fetch(`${base}/api/decks/bench-blank/pdf`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,200);const file=path.join(tmp,'download.pdf');fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
 assert.match((await exec('pdftotext',[file,'-'])).stdout,/Latest PDF edit/);
});

test('review copies load cold definitions, include offscreen edits, and omit notes',async()=>{
 const p=await open();
 await p.evaluate(async()=>{await SlideBuilder.go('s499');const el=document.querySelector('#deck > .sb-active .h-title');el.innerHTML='Offscreen reviewer title';el.dispatchEvent(new Event('input',{bubbles:true}));await SlideBuilder.go('s0');SlideBuilder.comment('s0','PRIVATE reviewer comment to omit');});
 const download=p.waitForEvent('download',{timeout:20000});
 await p.evaluate(()=>document.getElementById('sb-review-copy').click());
 const dl=await download,file=path.join(tmp,'review.html');await dl.saveAs(file);const html=fs.readFileSync(file,'utf8');
 assert.match(html,/Offscreen reviewer title/);assert.doesNotMatch(html,/PRIVATE facilitator instruction|PRIVATE reviewer comment/);
 assert.ok(await p.locator('#deck > [data-id]').count()<10);
 const c=await browser.newContext();contexts.push(c);await c.route('https://**',r=>r.abort());await c.route('http://**',r=>r.abort());
 const offline=await c.newPage();offline.on('pageerror',e=>errors.push(e.message));
 const portable=base+'/review-standalone-test.html';
 await c.route('**/*',r=>r.request().url()===portable?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await offline.goto(portable);await offline.evaluate(()=>__DECK_READY);
 assert.equal(await offline.locator('#deck > [data-id] .slide').count(),500);
 assert.equal(await offline.locator('[data-id="s499"] .h-title').innerText(),'Offscreen reviewer title');
});

test('worker supports proposal inspection and review import fingerprints',async()=>{
 const proposals=JSON.parse((await cli('proposals','bench-sync')).stdout);
 assert.equal(proposals.pairs[0].o,'s0');assert.deepEqual(proposals.shown.deck.s400,[true,true]);
 const info=JSON.parse((await cli('deckinfo','bench-sync')).stdout);
 assert.equal(info.slides.includes('s499'),true);assert.ok(info.defs.s499);assert.ok(info.fnotes.s499);
});

test('state removal ignores keys from other decks and non-string entries',async()=>{
 const p=await open('bench-blank');await p.evaluate(async()=>{snapshot();await __SB.flush();});
 const before=await(await fetch(state('bench-blank'))).json(), key=await p.evaluate(()=>KEY());
 const r=await fetch(state('bench-blank'),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:[123,null,'another-deck-key']})});
 assert.equal(r.status,200);assert.equal((await(await fetch(state('bench-blank'))).json()).keys[key],before.keys[key]);
});
