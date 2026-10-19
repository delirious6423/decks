// Matching Bench large 100/500/1000 fixtures on pre-lazy and candidate scratch servers.
import { chromium } from '../tools/node_modules/playwright-core/index.mjs';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
const chrome=process.env.SB_CHROME;
const trials=Number(process.env.BENCH_TRIALS)||5;
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const results={trials,methodology:'Same mixed plain/two-column/table slides; external font requests blocked equally to isolate rendering; page loads use fresh contexts. Navigation samples are synchronous go() calls and two-frame settle times. A real title edit precedes first save-state collection; warm collection is the median of nine following calls. Save timers are disabled so fixtures remain unchanged. Timings exclude server startup.',cases:{}};
const browser=await chromium.launch({executablePath:chrome,headless:true});results.browser=browser.version();
for(const size of [100,500,1000]){
 results.cases[size]={};
 for(const [name,base,query] of [['pre_lazy',process.env.BASELINE_URL||'http://127.0.0.1:18800',''],['lazy',process.env.SB_URL||'http://127.0.0.1:18799',''],['candidate_eager',process.env.SB_URL||'http://127.0.0.1:18799','?lazy=0']]){
  const samples=[];
  for(let i=0;i<trials;i++){
   const ctx=await browser.newContext({viewport:{width:1600,height:1000}});
   await ctx.route('https://fonts.googleapis.com/**',r=>r.abort());
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const t=performance.now();await page.goto(`${base}/d/bench-large-${size}/deck.html${query}`);
   await page.waitForFunction(()=>document.body.classList.contains('sb-ready'));
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const startup=performance.now()-t;
   const initial=await page.evaluate(()=>({engine_ms:window.__BENCH_ENGINE_MS,body_count:document.querySelectorAll('#deck > [data-id] .slide').length,nodes:document.querySelectorAll('*').length,build_calls:window.__BENCH_BUILDS()}));
   const navigation=await page.evaluate(async size=>{
    const sync=[],settled=[];
    for(let i=1;i<=20;i++){
     const id='large-'+(i%2 ? i : Math.floor(size/2)+i),t=performance.now();SlideBuilder.go(id);sync.push(performance.now()-t);
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     settled.push(performance.now()-t);
    }
    const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
    const editable=document.querySelector('#deck > .sb-active .h-title');editable.innerHTML+=' — benchmark edit';editable.dispatchEvent(new Event('input',{bubbles:true}));clearTimeout(saveTimer);dirty=false;
    let t=performance.now();const state=JSON.stringify(currentData()),first=performance.now()-t;const warm=[];
    for(let i=0;i<9;i++){t=performance.now();JSON.stringify(currentData());warm.push(performance.now()-t);}
    return {sync_ms:med(sync),settled_ms:med(settled),save_collect_json_ms:first,warm_save_collect_json_ms:med(warm),state_bytes:state.length,bodies:document.querySelectorAll('#deck > [data-id] .slide').length,nodes:document.querySelectorAll('*').length};
   },size);
   const cdp=await ctx.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
   await cdp.send('Performance.enable');const metrics=await cdp.send('Performance.getMetrics');
   samples.push({startup_ms:startup,...initial,navigation,heap_bytes:metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value,errors});
   await ctx.close();
  }
  const summary={startup_ms:median(samples.map(s=>s.startup_ms)),engine_ms:median(samples.map(s=>s.engine_ms)),body_count:median(samples.map(s=>s.body_count)),nodes:median(samples.map(s=>s.nodes)),build_calls:median(samples.map(s=>s.build_calls)),navigation_sync_ms:median(samples.map(s=>s.navigation.sync_ms)),navigation_settled_ms:median(samples.map(s=>s.navigation.settled_ms)),save_collect_json_ms:median(samples.map(s=>s.navigation.save_collect_json_ms)),warm_save_collect_json_ms:median(samples.map(s=>s.navigation.warm_save_collect_json_ms)),state_bytes:median(samples.map(s=>s.navigation.state_bytes)),final_body_count:median(samples.map(s=>s.navigation.bodies))};
  results.cases[size][name]={...summary,samples};console.log(size,name,JSON.stringify(summary));
 }
}
await browser.close();fs.writeFileSync(process.env.BENCH_OUT||'../lazy-benchmark.json',JSON.stringify(results,null,2)+'\n');
