// Scratch fixtures from prepare-performance.py; exercise logical items outside the DOM window.
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
const base=process.env.SB_URL||'http://127.0.0.1:18799',slug='bench-large-1000',api=`${base}/api/decks/${slug}/state`;
let browser;const contexts=[],errors=[];
async function clear(){const st=await(await fetch(api)).json();await fetch(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:Object.keys(st.keys)})});}
async function open(s=slug,query=''){
 const c=await browser.newContext({viewport:{width:1600,height:1000}});contexts.push(c);await c.route('https://fonts.googleapis.com/**',r=>r.abort());
 const p=await c.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.goto(`${base}/d/${s}/deck.html${query}`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));return p;
}
const rows=p=>p.locator('#sb-film-list .sb-fi');
before(async()=>{browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});await clear();});
afterEach(async()=>{for(const c of contexts.splice(0))await c.close();await clear();});
after(async()=>{await browser.close();assert.deepEqual(errors,[]);});

test('filmstrip stays bounded while scrolling both ends, jumping and resizing',async()=>{
 const p=await open();assert.equal(await p.locator('#block-list input').count(),0);assert.ok(await rows(p).count()<20);
 await p.locator('#sb-film-list').evaluate(n=>n.scrollTop=990*176);await p.waitForFunction(()=>document.querySelector('#sb-film-list .sb-fi[data-id="large-990"]'));
 assert.ok(await rows(p).count()<20);await p.locator('.sb-fi[data-id="large-990"]').click();
 assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-990');
 await p.evaluate(()=>SlideBuilder.go('large-0'));await p.waitForFunction(()=>document.querySelector('.sb-fi.on')?.dataset.id==='large-0');
 assert.ok(await rows(p).count()<20);await p.setViewportSize({width:1440,height:720});await p.evaluate(()=>SlideBuilder.go('large-999'));
 const b=p.locator('.sb-fi.on');assert.match(await b.getAttribute('aria-label'),/^Slide 1000 of 1000:/);assert.equal(await b.getAttribute('aria-current'),'true');
 assert.equal(await b.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('#sb-film-list').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1}),true);
});

test('Tab crosses a virtual boundary in both directions and keyboard navigation reveals far rows',async()=>{
 const p=await open();await p.evaluate(()=>SlideBuilder.go('large-400'));
 const b=p.locator('.sb-fi[data-id="large-400"]');await b.focus();
 for(let i=0;i<12;i++)await p.keyboard.press('Tab');
 assert.equal(await p.evaluate(()=>document.activeElement.dataset.id),'large-412');
 for(let i=0;i<12;i++)await p.keyboard.press('Shift+Tab');
 assert.equal(await p.evaluate(()=>document.activeElement.dataset.id),'large-400');
 await p.locator('#sb-next').click();assert.equal(await p.evaluate(()=>SlideBuilder.current()),'large-401');
 assert.equal(await p.locator('.sb-fi.on').getAttribute('data-id'),'large-401');
});

test('filter finds offscreen comments, maintains global slide numbering and refreshes badges',async()=>{
 const p=await open();await p.evaluate(()=>{
  SlideBuilder.comment('large-900','Review this distant slide');
  SlideBuilder.filter('open');SlideBuilder.go('large-900');
 });
 assert.equal(await rows(p).count(),1);assert.equal(await p.locator('.sb-fi .sb-fn').first().innerText(),'901');
 assert.equal(await p.locator('.sb-fi .sb-dot').innerText(),'Comment');
 await p.evaluate(()=>SlideBuilder.filter('all'));assert.ok(await rows(p).count()<20);assert.equal(await p.locator('.sb-fi.on').getAttribute('data-id'),'large-900');
});

test('remove and re-add a far slide through the shelf without legacy inputs',async()=>{
 const p=await open();await p.evaluate(()=>SlideBuilder.go('large-850'));await p.locator('.sb-fi.on').hover();await p.locator('.sb-fi.on .sb-x').click();
 await p.waitForFunction(()=>!document.querySelector('#deck > [data-id="large-850"]'));
 await p.waitForFunction(()=>document.querySelector('#sb-film-list .sb-extras'));
 const shelf=p.locator('#sb-film-list .sb-extras');await shelf.evaluate(n=>n.open=true);
 const add=shelf.locator('.sb-ex').filter({hasText:'Slide 851 shows'}).locator('button');await add.click();
 await p.waitForFunction(()=>SlideBuilder.current()==='large-850');
 assert.equal(await p.evaluate(()=>deckIds().length),1000);assert.ok(await rows(p).count()<20);
});

test('drag reorder, insertion controls and version switches work across virtual windows',async()=>{
 const p=await open();await p.evaluate(()=>SlideBuilder.go('large-500'));
 await p.locator('#sb-film-list').evaluate(n=>n.scrollTop=499*176);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const a=p.locator('.sb-fi[data-id="large-500"]'),b=p.locator('.sb-fi[data-id="large-501"]');
 await a.dragTo(b,{sourcePosition:{x:10,y:15},targetPosition:{x:100,y:150}});
 await p.waitForFunction(()=>SlideBuilder.slides()[501].id==='large-500');
 assert.equal(await a.locator(':scope > .sbx-ins').count(),1);
 await a.locator(':scope > .sbx-ins').evaluate(n=>n.click());assert.equal(await p.locator('#sbx-back').evaluate(n=>n.classList.contains('on')),true);
 await p.keyboard.press('Escape');
 const values=await p.locator('#sb-version option').evaluateAll(ns=>ns.map(n=>n.value));
 await p.selectOption('#sb-version',values[1]);await p.waitForTimeout(250);await p.selectOption('#sb-version',values[0]);
 await p.waitForFunction(()=>document.querySelector('#deck > .sb-active .slide')?.getBoundingClientRect().width>0);
 assert.equal(await p.evaluate(()=>document.documentElement.classList.contains('sb-lazy-boot')),false);assert.ok(await rows(p).count()<20);
});

test('a large excluded library is windowed and can add a distant slide',async()=>{
 const p=await open();await p.evaluate(()=>SlideBuilder.order(['large-0','large-1','large-2']));
 await p.waitForFunction(()=>document.querySelector('.sb-extras summary')?.textContent.includes('Not in'));
 await p.locator('.sb-extras').evaluate(n=>n.open=true);
 await p.waitForFunction(()=>document.querySelector('.sb-extra-window'));
 assert.ok(await p.locator('.sb-ex').count()<25);
 await p.evaluate(()=>{
  const ids=DeckLibrary.excluded().filter(id=>LIBRARY[id]&&!LIBRARY[id].lib),k=ids.indexOf('large-800');
  const list=document.querySelector('#sb-film-list'),host=document.querySelector('.sb-extra-window');
  list.scrollTop+=host.getBoundingClientRect().top-list.getBoundingClientRect().top+k*64;
 });
 const add=p.locator('.sb-ex').filter({hasText:'Slide 801 shows'}).locator('button');await add.click();
 await p.waitForFunction(()=>SlideBuilder.current()==='large-800');assert.ok(await p.locator('.sb-ex').count()<25);
 assert.equal(await p.evaluate(()=>deckIds().length),4);
});

test('the slide picker adds a basic layout through the library model',async()=>{
 const p=await open();await p.evaluate(()=>SlideBuilder.addSlide());
 await p.locator('#sbx [data-tab="basic"]').click();await p.locator('#sbx [data-base]:not([disabled])').first().click();
 await p.locator('#sbx [data-add]').click();await p.waitForFunction(()=>SlideBuilder.slides().length===1001);
 await p.waitForFunction(()=>SlideBuilder.current()?.startsWith('basic-'));
 assert.equal(await p.locator('#block-list input').count(),0);assert.ok(await rows(p).count()<20);
});

test('small decks and diagnostic list opt-out retain ordinary lists',async()=>{
 const p=await open('bench-blank');assert.equal(await p.locator('.sb-film-window').count(),0);assert.ok(await p.locator('#block-list input').count()>0);
 const q=await open(slug,'?lists=0');assert.equal(await q.locator('.sb-film-window').count(),0);assert.equal(await rows(q).count(),1000);
});
