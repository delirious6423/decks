// Requires matching Bench <template> fixtures on baseline and modified scratch servers.
// BASELINE_DIR=/path/to/original SB_URL=... BASELINE_URL=... SB_CHROME=... node tests/benchmark.mjs
import { chromium } from '../tools/node_modules/playwright-core/index.mjs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.BENCH_OUT || path.resolve(repo,'../implemented-benchmark.json');
const configs=[{name:'baseline',repo:process.env.BASELINE_DIR,url:process.env.BASELINE_URL||'http://127.0.0.1:18800'},
 {name:'implemented',repo,url:process.env.SB_URL||'http://127.0.0.1:18799'}];
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const phase=process.env.BENCH_PHASE || 'all';
const results=phase!=='all' && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out,'utf8')) : {baseline_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),node:process.version,platform:process.platform,cpu:os.cpus()[0].model,cli:{},saves:{},templates:{}};
const log=(name,data)=>console.log(name,JSON.stringify(data));
function run(cfg,args) {
 return execFileSync(args[0],args.slice(1),{cwd:cfg.repo,encoding:'utf8',env:cfg.env,timeout:180000});
}
for(const cfg of configs){
 if(!cfg.repo)throw Error('Set BASELINE_DIR to a clean archive of HEAD');
 const decks=await(await fetch(cfg.url+'/api/decks')).json();
 const talk=decks.decks.find(d=>d.slug==='bench-talk');
 const folder=talk.folder.replace(/^~/,os.homedir());
 cfg.env={...process.env,SB_URL:cfg.url,SB_DECKS_DIR:path.dirname(folder),SB_CHECK_UPDATES:'0'};
 cfg.folder=folder;
 if(phase==='saves')continue;
 results.cli[cfg.name]={};
 if(cfg.name==='implemented'){
   run(cfg,['node','tools/browser.mjs','worker-stop']);
   const t=performance.now();run(cfg,['node','tools/browser.mjs','titles','bench-talk']);
   results.cli[cfg.name].cold_titles_ms=performance.now()-t;
 }
 for(const [name,args] of [['titles',['node','tools/browser.mjs','titles','bench-talk']],['audit',['python3','sb','audit','bench-talk']],['export',['python3','sb','export','bench-talk']]]){
  const times=[];
  for(let i=0;i<5;i++){const t=performance.now();run(cfg,args);times.push(performance.now()-t);}
  results.cli[cfg.name][name]={median_ms:median(times),samples_ms:times};
  log(`${cfg.name}_${name}`,results.cli[cfg.name][name]);
 }
 const exports=fs.readdirSync(folder).filter(n=>n.endsWith(' export).pdf'));
 results.cli[cfg.name].pdf=path.join(folder,exports[0]);
}
// These checks run real CLI commands, including sb new, the audit, thumbnail and export.
for(const template of phase==='all' ? ['blank','talk','workshop','proposal','consulting'] : []){
 results.templates[template]={};
 const cfg=configs[1],name='Verify '+template;
 const existing=await(await fetch(cfg.url+'/api/decks')).json();
 let slug=existing.decks.find(d=>d.name===name)?.slug;
 if(!slug){const text=run(cfg,['python3','sb','new',name,'--template',template]);slug=text.split(/\s/)[0];}
 run(cfg,['python3','sb','audit',slug]);run(cfg,['python3','sb','export',slug]);
 for(const c of configs){
  const audit=run(c,['python3','sb','audit','bench-'+template]);
  const exported=run(c,['python3','sb','export','bench-'+template]).trim();
  results.templates[template][c.name]={audit,pdf:exported};
 }
 results.templates[template].audit_equal=results.templates[template].baseline.audit===results.templates[template].implemented.audit;
 log('template_'+template,{audit_equal:results.templates[template].audit_equal});
}
const browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});
for(const cfg of phase==='cli' ? [] : configs){
 results.saves[cfg.name]=[];
 for(const n of [100,500]){
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(cfg.url+'/d/bench-blank/deck.html');
  const captured=[];page.on('request',r=>{if(r.method()==='PUT')captured.push(Buffer.byteLength(r.postData()));});
  const metric=await page.evaluate(async n=>{
   await document.fonts.ready;
   const template=LIBRARY['point-1'],ids=Array.from({length:n},(_,i)=>'bench-'+i);
   ids.forEach((id,i)=>{LIBRARY[id]={...template,title:'Benchmark slide '+i};});PITCHES[current].blocks=ids;renderPitch(current);
   // Let the previous fetch's finally callback clear inflight before the next sample;
   // otherwise this tight loop measures the 300 ms deferred-flush timer instead.
   const snap=()=>new Promise(resolve=>{clearTimeout(saveTimer);dirty=false;window.addEventListener('sb:saved',()=>setTimeout(resolve,0),{once:true});snapshot();window.__SB.flush();});
   await snap();
   const collection=[],collectionJson=[],full=[];
   for(let i=0;i<15;i++){
    const el=deckEl.querySelector('[contenteditable]');el.innerHTML='Edit '+i;el.dispatchEvent(new Event('input',{bubbles:true}));
    let t=performance.now();currentData();collection.push(performance.now()-t);
    t=performance.now();JSON.stringify(currentData());collectionJson.push(performance.now()-t);
    t=performance.now();await snap();full.push(performance.now()-t);
   }
   const med=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
   return {slides:n,collection_ms:med(collection),collection_json_ms:med(collectionJson),snapshot_to_server_ms:med(full),state_bytes:JSON.stringify(currentData()).length};
  },n);
  metric.initial_request_bytes=captured[0];metric.steady_request_bytes=median(captured.slice(1));
  results.saves[cfg.name].push(metric);log(`${cfg.name}_save`,metric);
  // Clear synthetic state before other checks use the fixtures again.
  await page.evaluate(()=>{clearTimeout(saveTimer);dirty=false;});
  await context.close();
  const state=await(await fetch(cfg.url+'/api/decks/bench-blank/state')).json();
  await fetch(cfg.url+'/api/decks/bench-blank/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:Object.keys(state.keys)})});
 }
}
await browser.close();
fs.writeFileSync(out,JSON.stringify(results,null,2)+'\n');
