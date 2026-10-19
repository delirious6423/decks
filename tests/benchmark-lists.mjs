// Run against matching prepare-performance.py fixtures on two scratch servers.
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';
const trials=Number(process.env.BENCH_TRIALS)||5,median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const variants=[['before',process.env.BASELINE_URL||'http://127.0.0.1:18800'],['after',process.env.SB_URL||'http://127.0.0.1:18799']];
if(process.env.ORIGINAL_URL)variants.unshift(['original',process.env.ORIGINAL_URL]);
const result={trials,methodology:'Interleaved before/after runs with reversed order on alternate trials; fresh browser contexts, 1600x1000 viewport, external Google font CSS blocked equally. Startup ends at sb-ready plus two animation frames. Large cases include 20 scattered navigation calls, a real title edit followed by first and nine warm JSON state collections, and five independent filmstrip scrolls. Timings exclude server startup. Durations are milliseconds; medians are across trials; no CPU profiler runs during timing.',cases:{}};
const browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});result.browser=browser.version();
for(const fixture of ['blank','workshop',100,500,1000]){
 const samples=Object.fromEntries(variants.map(([name])=>[name,[]])),large=typeof fixture==='number';
 for(let trial=0;trial<trials;trial++)for(const [variant,base] of trial%2?[...variants].reverse():variants){
  const c=await browser.newContext({viewport:{width:1600,height:1000}});await c.route('https://fonts.googleapis.com/**',r=>r.abort());const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const cdp=await c.newCDPSession(p);await cdp.send('Performance.enable');
  const t=performance.now();await p.goto(`${base}/d/bench-${large?'large-':''}${fixture}/deck.html`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const startup_ms=performance.now()-t;
  const initial=await p.evaluate(()=>({engine_ms:window.__BENCH_ENGINE_MS,nodes:document.querySelectorAll('*').length,body_count:document.querySelectorAll('#deck > [data-id] .slide').length,film_rows:document.querySelectorAll('#sb-film-list .sb-fi').length,sidebar_rows:document.querySelectorAll('#block-list .toggle').length}));
  const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  let navigation={};
  if(large)navigation=await p.evaluate(async size=>{
   const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),sync=[],settled=[],scroll=[];
   for(let i=1;i<=20;i++){const id='large-'+(i%2?i:Math.floor(size/2)+i),t=performance.now();SlideBuilder.go(id);sync.push(performance.now()-t);await frame();settled.push(performance.now()-t);}
   const editable=document.querySelector('#deck > .sb-active .h-title');editable.innerHTML+=' — benchmark edit';editable.dispatchEvent(new Event('input',{bubbles:true}));clearTimeout(saveTimer);dirty=false;
   let t=performance.now();const state=JSON.stringify(currentData()),first=performance.now()-t,warm=[];for(let i=0;i<9;i++){t=performance.now();JSON.stringify(currentData());warm.push(performance.now()-t);}
   const list=document.querySelector('#sb-film-list');for(const f of [0,.25,.5,.75,1]){t=performance.now();list.scrollTop=(list.scrollHeight-list.clientHeight)*f;await frame();scroll.push(performance.now()-t);}
   return {sync_ms:med(sync),settled_ms:med(settled),scroll_settled_ms:med(scroll),save_collect_json_ms:first,warm_save_collect_json_ms:med(warm),state_bytes:state.length,final_film_rows:list.querySelectorAll('.sb-fi').length,final_bodies:document.querySelectorAll('#deck > [data-id] .slide').length};
  },fixture);
  await cdp.send('HeapProfiler.collectGarbage');const heap=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  samples[variant].push({startup_ms,...initial,layout_ms:metrics.LayoutDuration*1000,style_ms:metrics.RecalcStyleDuration*1000,script_ms:metrics.ScriptDuration*1000,heap_bytes:heap.JSHeapUsedSize,navigation,errors});await c.close();
 }
 result.cases[fixture]={};for(const [variant,ss]of Object.entries(samples)){
  const summary={};for(const k of Object.keys(ss[0]))if(typeof ss[0][k]==='number')summary[k]=median(ss.map(s=>s[k]));
  for(const k of Object.keys(ss[0].navigation))summary[k]=median(ss.map(s=>s.navigation[k]));
  result.cases[fixture][variant]={summary,samples:ss};console.log(fixture,variant,JSON.stringify(summary));
 }
}
await browser.close();fs.writeFileSync(process.env.BENCH_OUT||'../lists-benchmark.json',JSON.stringify(result,null,2)+'\n');
