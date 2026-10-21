import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
const base=process.env.SB_URL||'http://127.0.0.1:18799';
let browser;const contexts=[],errors=[],temp=fs.mkdtempSync(path.join(os.tmpdir(),'decks-library-'));
const api=slug=>`${base}/api/decks/${slug}/state`;
async function clear(slug){const st=await(await fetch(api(slug))).json();await fetch(api(slug),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:Object.keys(st.keys)})});}
async function open(size=10000,query=''){
 const c=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});contexts.push(c);
 await c.route('https://fonts.googleapis.com/**',r=>r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${base}/d/bench-large-${size}/deck.html${query}`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>__DECK_READY);return p;
}
const title=p=>p.locator('#deck > .sb-active .h-title');
const frame=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
before(async()=>{browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});for(const size of [500,1000,10000])await clear('bench-large-'+size);});
afterEach(async()=>{for(const c of contexts.splice(0))await c.close();for(const size of [500,1000,10000])await clear('bench-large-'+size);});
after(async()=>{await browser.close();fs.rmSync(temp,{recursive:true,force:true});assert.deepEqual(errors,[]);});

test('startup uses one small group; distant navigation fetches once and reuses data',async()=>{
 const p=await open(),requests=[];p.on('request',r=>{if(r.url().includes('?library='))requests.push(r.url());});
 assert.equal(await p.evaluate(()=>__SB.splitLibrary),true);
 assert.equal(await p.evaluate(()=>DeckData.ready(['large-9999'])),false);
 assert.ok(await p.evaluate(()=>Object.values(LIBRARY).filter(b=>!b.__sbChunk).length)<200);
 await p.evaluate(()=>SlideBuilder.go('large-9999'));assert.match(await title(p).innerText(),/Slide 10000/);
 assert.equal(requests.length,1);assert.ok(await p.locator('#deck > [data-id]').count()<=3);
 await p.evaluate(()=>SlideBuilder.go('large-0'));await p.evaluate(()=>SlideBuilder.go('large-9999'));assert.equal(requests.length,1);
});

test('latest navigation wins when cold requests complete out of order',async()=>{
 const p=await open();const slow=await p.evaluate(()=>window.__SB_LIBRARY_CHUNKS[LIBRARY['large-9999'].__sbChunk]);
 await p.route('**/*?library='+slow,async r=>{await new Promise(resolve=>setTimeout(resolve,200));await r.continue();});
 await p.evaluate(async()=>{const a=SlideBuilder.go('large-9999'),b=SlideBuilder.go('large-5000');await Promise.all([a,b]);});
 assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-5000');assert.match(await title(p).innerText(),/Slide 5001/);
});

test('a failed fetch leaves the current slide intact and a later navigation retries',async()=>{
 const p=await open();const key=await p.evaluate(()=>window.__SB_LIBRARY_CHUNKS[LIBRARY['large-9999'].__sbChunk]);
 await p.route('**/*?library='+key,r=>r.fulfill({status:503,body:'Unavailable'}));
 await p.evaluate(()=>SlideBuilder.go('large-9999'));assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-0');assert.match(await title(p).innerText(),/Slide 1 shows/);
 await p.unroute('**/*?library='+key);await p.evaluate(()=>SlideBuilder.go('large-9999'));assert.match(await title(p).innerText(),/Slide 10000/);
});

test('edited fields and offscreen feedback survive cold eviction, save and reload',async()=>{
 const p=await open();await p.evaluate(async()=>{
  const t=document.querySelector('#deck > .sb-active .h-title');t.innerHTML='An edit before a cold jump';t.dispatchEvent(new Event('input',{bubbles:true}));
  SlideBuilder.comment('large-9000','Offscreen feedback');await SlideBuilder.go('large-9999');
  clearTimeout(saveTimer);snapshot();await __SB.flush();
 });
 await p.waitForFunction(()=>!document.querySelector('#save-flag')?.classList.contains('saving'));await p.waitForTimeout(600);
 await p.reload();await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>SlideBuilder.go('large-0'));
 assert.equal(await title(p).innerText(),'An edit before a cold jump');assert.equal(await p.evaluate(()=>SlideBuilder.comment('large-9000')),'Offscreen feedback');
 await p.evaluate(()=>SlideBuilder.go('large-9000'));assert.equal(await p.locator('#deck > .sb-active .fb').inputValue(),'Offscreen feedback');
});

test('cold reorder and restored startup order retain complete bodies and numbering',async()=>{
 const p=await open();await p.evaluate(async()=>{const ids=deckIds();ids.splice(9000,1);ids.unshift('large-9000');applyOrder(ids);await SlideBuilder.go('large-9000');clearTimeout(saveTimer);snapshot();__SB.flush();});
 assert.equal(await p.locator('#deck > .sb-active .slide-no b').innerText(),'1');await p.waitForTimeout(600);
 await p.reload();await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));assert.match(await title(p).innerText(),/Slide 9001/);
 assert.equal(await p.locator('#deck > .sb-active .slide-no b').innerText(),'1');
});

test('Checks, guide scans and client copies await complete definitions',async()=>{
 const p=await open(500);await p.evaluate(()=>SlideBuilder.setView('checks'));
 assert.equal(await p.locator('#deck > [data-id] .slide').count(),500);assert.equal(await p.evaluate(()=>DeckData.ready(deckIds())),true);
 assert.equal(await p.evaluate(async()=>(await SBGuides.scan()).length),500);
 await p.evaluate(()=>SlideBuilder.setView('focus'));const html=await p.evaluate(()=>SlideBuilder.clientCopy());
 assert.equal((html.match(/class="cc-slide"/g)||[]).length,500);assert.match(html,/Slide 500 shows/);assert.doesNotMatch(html,/__sbChunk/);
});

test('editable download carries all definitions and edits and opens offline',async()=>{
 const p=await open(500);await p.evaluate(()=>{const t=document.querySelector('#deck > .sb-active .h-title');t.innerHTML='Offline editable title';t.dispatchEvent(new Event('input',{bubbles:true}));});
 const downloaded=p.waitForEvent('download');await p.evaluate(()=>document.getElementById('save-copy').click());const dl=await downloaded;
 assert.match(dl.suggestedFilename(),/editable/);const file=path.join(temp,'portable.html');await dl.saveAs(file);
 const html=fs.readFileSync(file,'utf8');assert.match(html,/Object.assign\(LIBRARY,/);assert.doesNotMatch(html,/JSON.parse\(".*__sbChunk/);
 const offline=await browser.newContext();contexts.push(offline);await offline.route('https://**',r=>r.abort());await offline.route('http://**',r=>r.abort());const page=await offline.newPage();page.on('pageerror',e=>errors.push(e.message));
 // Serve only the downloaded bytes; block every asset and API request.
 const portable=base+'/standalone-test.html';
 await offline.route('**/*',r=>r.request().url()===portable?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.goto(portable);await page.evaluate(()=>__DECK_READY);assert.equal(await page.locator('#deck > [data-id] .slide').count(),500);assert.equal(await page.locator('#deck > [data-id="large-0"] .h-title').innerText(),'Offline editable title');
 assert.match(await page.locator('#deck > [data-id="large-499"] .slide').innerText(),/Slide 500/);
});

test('raw, readonly and diagnostic pages retain complete libraries',async()=>{
 for(const query of ['?raw=1','?readonly=1','?library=0']){
  const c=await browser.newContext();contexts.push(c);await c.route('https://fonts.googleapis.com/**',r=>r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(`${base}/d/bench-large-500/deck.html${query}`);await p.evaluate(()=>__DECK_READY);
  assert.equal(await p.evaluate(()=>DeckData.ready(Object.keys(LIBRARY))),true);
  if(query!=='?library=0')assert.equal(await p.locator('#deck > [data-id] .slide').count(),500);
 }
});

test('native beforeprint materializes synchronously and returns to a bounded window',async()=>{
 const p=await open(500);await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 assert.equal(await p.locator('#deck > [data-id] .slide').count(),500);assert.match(await p.locator('#deck > [data-id="large-499"] .slide').innerText(),/Slide 500/);
 await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.ok(await p.locator('#deck > [data-id]').count()<=3);
});

test('content-addressed chunks reject source revisions instead of mixing definitions',async()=>{
 const p=await open();const key=await p.evaluate(()=>window.__SB_LIBRARY_CHUNKS[LIBRARY['large-9999'].__sbChunk]);
 const decks=await(await fetch(base+'/api/decks')).json(),deck=decks.decks.find(d=>d.slug==='bench-large-10000');const file=path.join(deck.folder.replace(/^~/,os.homedir()),path.basename(deck.url)),original=fs.readFileSync(file,'utf8');
 try{fs.writeFileSync(file,original.replace('Slide 10000 shows where','Revised last slide shows where'));const r=await fetch(`${base}/d/bench-large-10000/deck.html?library=${key}`);assert.equal(r.status,409);}
 finally{fs.writeFileSync(file,original);}
});

test('gzip negotiation preserves decoded content and honors identity and q=0',async()=>{
 const url=base+'/d/bench-large-1000/deck.html';
 const identity=await fetch(url,{headers:{'Accept-Encoding':'identity'}}),plain=await identity.text();
 assert.equal(identity.headers.get('content-encoding'),null);
 const zipped=await fetch(url,{headers:{'Accept-Encoding':'gzip'}});
 assert.equal(zipped.headers.get('content-encoding'),'gzip');assert.equal(zipped.headers.get('vary'),'Accept-Encoding');
 assert.ok(Number(zipped.headers.get('content-length'))<Buffer.byteLength(plain)/4);assert.equal(await zipped.text(),plain);
 const disabled=await fetch(url,{headers:{'Accept-Encoding':'gzip;q=0'}});assert.equal(disabled.headers.get('content-encoding'),null);assert.equal(await disabled.text(),plain);
 const head=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});assert.equal(head.headers.get('content-length'),zipped.headers.get('content-length'));assert.equal((await head.arrayBuffer()).byteLength,0);
});

test('body-only diagnostic mode hydrates default notes without creating edits',async()=>{
 const p=await open(500,'?wrappers=0');assert.equal(await p.evaluate(()=>DeckData.ready(['large-499'])),false);
 await p.evaluate(()=>SlideBuilder.go('large-499'));assert.match(await p.locator('#deck > .sb-active .fnote').innerText(),/Facilitator note 500/);
 assert.equal(await p.evaluate(()=>currentData()['large-499']),undefined);
 const r=await fetch(base+'/d/bench-large-500/deck.html?library=all');assert.match(r.headers.get('cache-control'),/no-store/);
});

test('automatic Scroll tracking cannot cancel a cold explicit jump',async()=>{
 const p=await open(1000);await p.evaluate(()=>SlideBuilder.setView('scroll'));await p.evaluate(()=>SlideBuilder.go('large-20'));await p.waitForTimeout(300);
 const key=await p.evaluate(()=>window.__SB_LIBRARY_CHUNKS[LIBRARY['large-999'].__sbChunk]);
 await p.route('**/*?library='+key,async r=>{await new Promise(resolve=>setTimeout(resolve,180));await r.continue();});
 await p.evaluate(async()=>{const jump=SlideBuilder.go('large-999');await new Promise(r=>setTimeout(r,140));window.dispatchEvent(new Event('sb:window'));await jump;});
 assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-999');assert.match(await p.locator('#deck > [data-id="large-999"] .h-title').innerText(),/Slide 1000/);
});

test('rapid keyboard steps advance from the requested cold slide',async()=>{
 const p=await open(500);const key=await p.evaluate(()=>window.__SB_LIBRARY_CHUNKS[LIBRARY['large-200'].__sbChunk]);
 await p.route('**/*?library='+key,async r=>{await new Promise(resolve=>setTimeout(resolve,150));await r.continue();});
 await p.evaluate(async()=>{const jump=SlideBuilder.go('large-200'),step=SlideBuilder.step(1);await Promise.all([jump,step]);});
 assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-201');assert.match(await title(p).innerText(),/Slide 202/);
});

test('switching versions inside Checks awaits all slides in the destination version',async()=>{
 const p=await open(1000);await p.evaluate(async()=>{
  PITCHES.small={name:'Small',blocks:Array.from({length:100},(_,i)=>'large-'+i)};
  PITCHES.other={name:'Other',blocks:Array.from({length:100},(_,i)=>'large-'+(900+i))};
  await renderPitch('small');restore();await SlideBuilder.setView('checks');
  if(DeckData.ready(['large-999']))throw new Error('Destination was not cold');
  await renderPitch('other');restore();
 });
 assert.equal(await p.evaluate(()=>DeckData.ready(deckIds())),true);assert.equal(await p.locator('#deck > [data-id] .slide').count(),100);
 assert.match(await p.locator('#deck > [data-id="large-999"] .h-title').innerText(),/Slide 1000/);
});
