// Generate BENCH_SIZES=100,500,1000,5000,10000 fixtures before running.
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
const base=process.env.SB_URL||'http://127.0.0.1:18799',slug='bench-large-10000',api=`${base}/api/decks/${slug}/state`;
let browser;const contexts=[],errors=[];
async function clear(){const st=await(await fetch(api)).json();await fetch(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:Object.keys(st.keys)})});}
async function open({viewport={width:1600,height:1000},query='',review}={}){
 const c=await browser.newContext({viewport});contexts.push(c);await c.route('https://fonts.googleapis.com/**',r=>r.abort());
 if(review)await c.route(`**/api/decks/${slug}/review`,r=>r.fulfill({json:review}));
 const p=await c.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${base}/d/${slug}/deck.html${query}`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>window.__DECK_READY);return p;
}
const frame=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const save=p=>p.evaluate(()=>new Promise(resolve=>{clearTimeout(saveTimer);window.addEventListener('sb:saved',resolve,{once:true});snapshot();__SB.flush();}));
const mounted=p=>p.locator('#deck > [data-id]').count();
before(async()=>{browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});await clear();});
afterEach(async()=>{for(const c of contexts.splice(0))await c.close();await clear();});
after(async()=>{await browser.close();assert.deepEqual(errors,[]);});

test('10,000 logical slides allocate only a bounded window and release detached DOM',async()=>{
 const p=await open();assert.equal(await p.evaluate(()=>deckIds().length),10000);assert.ok(await mounted(p)<=3);
 const cdp=await p.context().newCDPSession(p);await cdp.send('HeapProfiler.collectGarbage');const start=await cdp.send('Memory.getDOMCounters');
 await p.evaluate(()=>{for(let i=0;i<180;i++)SlideBuilder.go('large-'+((i*997)%10000));});await frame(p);
 assert.ok(await mounted(p)<=3);assert.ok(await p.locator('#sb-film-list .sb-fi').count()<20);
 await cdp.send('HeapProfiler.collectGarbage');const end=await cdp.send('Memory.getDOMCounters');assert.ok(end.nodes<start.nodes+2000,JSON.stringify({start,end}));
});

test('offscreen state, synchronous mutations, saves and reload retain fields and comments',async()=>{
 const p=await open();await p.evaluate(()=>{
  const w=document.querySelector('#deck > [data-id="large-0"]');w.querySelector('.h-title').innerHTML='Retain this before eviction';w.querySelector('.fnote').innerHTML='Edited facilitator note';
  w.querySelector('.h-title').dispatchEvent(new Event('input',{bubbles:true}));SlideBuilder.comment('large-9000','An offscreen comment');SlideBuilder.go('large-9999');
 });await save(p);
 const state=await p.evaluate(()=>__DECK_STATE());assert.equal(state.order.length,10000);assert.equal(state.feedback['large-9000'],'An offscreen comment');assert.equal(state.edits['large-0'][0],'Retain this before eviction');
 assert.equal(await p.locator('#deck > [data-id="large-9000"]').count(),0);
 await p.reload();await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>SlideBuilder.go('large-0'));
 assert.equal(await p.locator('#deck > [data-id="large-0"] .h-title').innerText(),'Retain this before eviction');assert.equal(await p.locator('#deck > [data-id="large-0"] .fnote').innerText(),'Edited facilitator note');
 await p.evaluate(()=>SlideBuilder.go('large-9000'));assert.equal(await p.locator('#deck > [data-id="large-9000"] .fb').inputValue(),'An offscreen comment');assert.ok(await mounted(p)<=3);
});

test('numbering follows logical order, removal, undo and empty-deck transitions',async()=>{
 const p=await open();const result=await p.evaluate(()=>{
  const original=deckIds(),order=original.slice();order.splice(9000,1);order.unshift('large-9000');applyOrder(order);SlideBuilder.go('large-9000');
  const first=document.querySelector('#deck > .sb-active .slide-no b').textContent;
  applyOrder(order.filter(id=>id!=='large-9000'));applyOrder(undoStack.pop(),false);SlideBuilder.go('large-9000');
  const restored=document.querySelector('#deck > .sb-active .slide-no').textContent;
  applyOrder([]);const empty=__DECK_STATE().order.length;applyOrder(original);SlideBuilder.go('large-9999');
  return{first,restored,empty,last:document.querySelector('#deck > .sb-active .slide-no').textContent,order:deckIds().length};
 });assert.equal(result.first,'1');assert.match(result.restored,/1large-9000of 10000/);assert.equal(result.empty,0);assert.match(result.last,/10000large-9999of 10000/);assert.equal(result.order,10000);await save(p);
});

test('scrolling, comment resizing and viewport resizing preserve anchors and contiguous rows',async()=>{
 const p=await open();await p.evaluate(()=>{SlideBuilder.setView('scroll');SlideBuilder.go('large-5000');});await p.waitForTimeout(180);
 const top=await p.locator('#deck > [data-id="large-5000"]').evaluate(n=>n.getBoundingClientRect().top);
 await p.locator('#deck > [data-id="large-4999"] .fb').evaluate(n=>n.style.height='300px');await p.waitForTimeout(100);
 const after=await p.locator('#deck > [data-id="large-5000"]').evaluate(n=>n.getBoundingClientRect().top);assert.ok(Math.abs(after-top)<3,JSON.stringify({top,after}));
 await p.setViewportSize({width:1280,height:800});await p.waitForTimeout(200);
 assert.ok(await mounted(p)<15);assert.ok(await p.locator('#deck > [data-id="large-5000"]').count());
 const resized = await p.locator('#deck > [data-id="large-5000"]').evaluate(n=>n.getBoundingClientRect().top);assert.ok(Math.abs(resized-top)<3,JSON.stringify({top,resized}));
 const gaps=await p.evaluate(()=>{
  const ws=[...document.querySelectorAll('#deck > [data-id]')].map(n=>({k:lazySlides.positions.get(n.dataset.id),r:n.getBoundingClientRect()}));
  return ws.slice(1).filter((n,i)=>n.k===ws[i].k+1).map((n,i)=>n.r.top-ws[i].r.bottom);
 });assert.ok(gaps.every(g=>g>=20&&g<35),JSON.stringify(gaps));
 for(const f of [0,.3,.8,1,.05]){await p.evaluate(f=>scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*f),f);await p.waitForTimeout(100);assert.ok(await mounted(p)<15);}
 await p.evaluate(()=>SlideBuilder.setView('focus'));assert.ok(await mounted(p)<=3);
});

test('offscreen review badges and held comments are restored when their wrappers mount',async()=>{
 const text='Hold this feedback',id='large-7000',review={comments:{[id]:{state:'draft',text}},replies:{},changed:{[id]:{round:3,note:'Updated evidence'}},rounds:[]};
 const p=await open({review});await p.evaluate(([id,text])=>{SlideBuilder.comment(id,text);SlideBuilder.go(id);},[id,text]);
 assert.equal(await p.locator('#deck > .sb-active .sb-hold input').isChecked(),true);assert.match(await p.locator('#deck > .sb-active .sb-badge').innerText(),/round 3/);
 await p.evaluate(()=>{SlideBuilder.go('large-0');SlideBuilder.go('large-7000');});assert.equal(await p.locator('#deck > .sb-active .sb-hold input').isChecked(),true);await save(p);
});

test('leaving sorter/checks releases bulk DOM and keeps the selected slide',async()=>{
 // Use the smaller fixture for operations deliberately materializing the whole deck.
 const p=await open();await p.goto(`${base}/d/bench-large-500/deck.html`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));
 await p.evaluate(()=>SlideBuilder.setView('sorter'));assert.equal(await mounted(p),0);assert.equal(await p.locator('#sb-grid .sb-card').count(),500);
 await p.locator('#sb-sorter .sb-card[data-id="large-400"]').evaluate(n=>n.click());assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-400');assert.equal(await p.locator('#sb-sorter .sb-card').count(),0);
 await p.evaluate(()=>SlideBuilder.setView('checks'));assert.equal(await mounted(p),500);await p.evaluate(()=>SlideBuilder.setView('focus'));assert.ok(await mounted(p)<=3);assert.equal(await p.locator('#sb-checks > *').count(),0);
});

test('updated slide definitions win over saved fields for an unmounted slide',async()=>{
 const p=await open();await p.evaluate(()=>{
  SlideBuilder.go('large-9000');const t=document.querySelector('#deck > .sb-active .h-title');t.innerHTML='Old saved title';t.dispatchEvent(new Event('input',{bubbles:true}));
 });await save(p);
 await p.evaluate(()=>{SlideBuilder.go('large-0');LIBRARY['large-9000'].title='Updated source title';renderPitch(current);restore();SlideBuilder.go('large-9000');});
 assert.equal(await p.locator('#deck > .sb-active .h-title').innerText(),'Updated source title');
});

test('live print materializes every slide without a banner page and releases wrappers afterward',async()=>{
 const p=await open();await p.goto(`${base}/d/bench-large-100/deck.html`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));
 await p.evaluate(async()=>{SlideBuilder.setView('scroll');SlideBuilder.go('large-99');document.querySelector('#deck > [data-id="large-99"] .h-title').innerHTML='Final virtual slide is printed';await DeckRenderer.preparePrint();});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decks-wrapper-print-')),pdf=path.join(dir,'live.pdf');
 try{
  await p.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
  assert.equal(Number(execFileSync('pdfinfo',[pdf],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]),100);
  const text=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8',maxBuffer:5*1024*1024}).replace(/\s+/g,' ');assert.ok(text.includes('Final virtual slide is printed'));
  await p.evaluate(()=>DeckRenderer.resume());await frame(p);assert.ok(await mounted(p)<15);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('height index agrees with a reference after random changes and at exact boundaries',async()=>{
 const p=await open();assert.equal(await p.evaluate(()=>{
  let seed=123;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32),v=Array.from({length:1000},()=>20+Math.floor(random()*800)),h=new SlideHeights(v);
  for(let trial=0;trial<300;trial++){
   const k=Math.floor(random()*v.length);v[k]=20+Math.floor(random()*800);h.set(k,v[k]);
   const n=Math.floor(random()*v.length),sum=v.slice(0,n).reduce((a,b)=>a+b,0);
   if(h.prefix(n)!==sum||h.at(sum)!==n||h.at(sum+v[n]-.1)!==n)return false;
  }return true;
 }),true);
});
