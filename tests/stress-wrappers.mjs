// Parallel functional VM stress, deliberately separate from timing benchmarks.
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true}),base=process.env.SB_URL||'http://127.0.0.1:18799';
const cases=[];for(const viewport of [{width:1280,height:800},{width:1600,height:1000},{width:1920,height:1080},{width:2560,height:1440}])for(const cpu of [1,4])cases.push({viewport,cpu});
const results=await Promise.all(cases.map(async scenario=>{
 const c=await browser.newContext({viewport:scenario.viewport});await c.route('https://fonts.googleapis.com/**',r=>r.abort());const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const cdp=await c.newCDPSession(p);if(scenario.cpu!==1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.cpu});
 await p.goto(base+'/d/bench-large-10000/deck.html');await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>__DECK_READY);
 let max_wrappers=0;
 for(let i=0;i<24;i++){
  await p.evaluate(i=>{
   SlideBuilder.setView(i%3===0?'focus':'scroll');SlideBuilder.go('large-'+((i*997)%10000));
   document.body.classList.toggle('show-notes',i%2===0);
  },i);
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const state=await p.evaluate(()=>({n:deckIds().length,wrappers:document.querySelectorAll('#deck > [data-id]').length,fields:document.querySelectorAll('#deck > [data-id] .slide').length}));
  assert.equal(state.n,10000);assert.ok(state.wrappers<16,JSON.stringify(state));max_wrappers=Math.max(max_wrappers,state.wrappers);
 }
 await p.evaluate(()=>{SlideBuilder.setView('focus');SlideBuilder.go('large-9999');});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await p.locator('#deck > .sb-active .slide-no b').innerText(),'10000');await cdp.send('HeapProfiler.collectGarbage');const dom=await cdp.send('Memory.getDOMCounters');assert.deepEqual(errors,[]);
 const result={...scenario,max_wrappers,final_elements:await p.locator('*').count(),dom,errors};await c.close();return result;
}));await browser.close();
fs.writeFileSync(process.env.STRESS_OUT||'../wrapper-stress.json',JSON.stringify({methodology:'Eight parallel fresh contexts; 10,000 slides, four viewport sizes, normal and 4x CPU throttling; 24 alternating focus/scroll jumps per context plus notes toggles. Functional assertions, not timing comparisons.',results},null,2)+'\n');console.log('Passed',results.length,'parallel scenarios');
