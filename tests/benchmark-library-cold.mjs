// Cold transform-cache startup, distinct from browser/server-process launch.
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
const variants=[['before',process.env.BASELINE_URL||'http://127.0.0.1:18800'],['after',process.env.SB_URL||'http://127.0.0.1:18799']],trials=Number(process.env.BENCH_TRIALS)||5,median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],out={methodology:'Five interleaved trials; fresh browser contexts and cold HTTP caches. Touch the exact fixture file before each request to invalidate the serving transform cache. Includes cache construction in startup; excludes launching browser/server processes. Same 1600x1000 viewport and font blocking as the warm-cache benchmark.',cases:{}};
const b=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});
for(const size of [1000,10000]){
 const samples={before:[],after:[]};
 for(let i=0;i<trials;i++)for(const [label,base]of i%2?[...variants].reverse():variants){
  const slug='bench-large-'+size,deck=await(await fetch(base+'/api/decks/'+slug)).json(),file=path.join(deck.folder.replace(/^~/,os.homedir()),path.basename(deck.url));
  const now=new Date();fs.utimesSync(file,now,now);
  const c=await b.newContext({viewport:{width:1600,height:1000}});await c.route('https://fonts.googleapis.com/**',r=>r.abort());const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const t=performance.now();await p.goto(base+deck.url);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  samples[label].push({startup_ms:performance.now()-t,navigation:await p.evaluate(()=>performance.getEntriesByType('navigation')[0].toJSON()),errors});await c.close();
 }
 out.cases[size]=Object.fromEntries(Object.entries(samples).map(([label,ss])=>[label,{startup_ms:median(ss.map(s=>s.startup_ms)),ttfb_ms:median(ss.map(s=>s.navigation.responseStart)),samples:ss}]));console.log(size,JSON.stringify(Object.fromEntries(Object.entries(out.cases[size]).map(([k,v])=>[k,v.startup_ms]))));
}
await b.close();fs.writeFileSync(process.env.BENCH_OUT||'../library-cold-benchmark.json',JSON.stringify(out,null,2)+'\n');
