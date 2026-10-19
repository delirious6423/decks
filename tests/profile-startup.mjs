// Separate sampling run; do not use these durations as benchmark timings.
import {chromium} from '../tools/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const b=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});
const result={};
for(const [label,base] of [['before',process.env.BASELINE_URL||'http://127.0.0.1:18800'],['after',process.env.SB_URL||'http://127.0.0.1:18799']]){
 const c=await b.newContext({viewport:{width:1600,height:1000}});await c.route('https://fonts.googleapis.com/**',r=>r.abort());
 const p=await c.newPage(),d=await c.newCDPSession(p);await d.send('Profiler.enable');await d.send('Profiler.setSamplingInterval',{interval:100});await d.send('Performance.enable');await d.send('Profiler.start');
 await p.goto(`${base}/d/bench-large-1000/deck.html`);await p.waitForFunction(()=>document.body.classList.contains('sb-ready'));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const {profile}=await d.send('Profiler.stop'),metrics=await d.send('Performance.getMetrics');
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const ch of n.children||[])parents.set(ch,n.id);
 const self=new Map(),total=new Map();profile.samples.forEach((id,i)=>{const dt=profile.timeDeltas[i]/1000;self.set(id,(self.get(id)||0)+dt);for(let k=id;k;k=parents.get(k))total.set(k,(total.get(k)||0)+dt);});
 const rows=profile.nodes.map(n=>({function:n.callFrame.functionName||'(anonymous)',url:n.callFrame.url.replace(/http:\/\/127.0.0.1:\d+/,''),line:n.callFrame.lineNumber+1,self_ms:self.get(n.id)||0,inclusive_ms:total.get(n.id)||0}));
 result[label]={metrics:Object.fromEntries(metrics.metrics.map(m=>[m.name,m.value])),self:rows.sort((a,b)=>b.self_ms-a.self_ms).slice(0,40),inclusive:[...rows].sort((a,b)=>b.inclusive_ms-a.inclusive_ms).slice(0,60),navigation:await p.evaluate(()=>performance.getEntriesByType('navigation')[0].toJSON()),dom:await p.evaluate(()=>Object.fromEntries(['*','#block-list *','#sb-film-list *','#deck *','.sb-hold'].map(s=>[s,document.querySelectorAll(s).length])))};
 console.log(label,JSON.stringify(result[label].dom));await c.close();
}
await b.close();fs.writeFileSync(process.env.PROFILE_OUT||'../startup-profile.json',JSON.stringify(result,null,2));
