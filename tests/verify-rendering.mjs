// Export matching raw pages for text/raster comparison. QA_OUT holds disposable PDFs.
import { chromium } from '../tools/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const out=path.resolve(process.env.QA_OUT||'../lazy-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.SB_CHROME,headless:true});
const result={pdfs:{},cli:{},page_errors:[]};
for(const template of ['blank','talk','workshop','proposal','consulting','large-100']){
 result.pdfs[template]={};
 for(const [name,url] of [['baseline',process.env.BASELINE_URL||'http://127.0.0.1:18800'],['candidate',process.env.SB_URL||'http://127.0.0.1:18799']]){
  const ctx=await browser.newContext({viewport:{width:1600,height:1000}});
  await ctx.route('https://fonts.googleapis.com/**',r=>r.abort());
  const p=await ctx.newPage();p.on('pageerror',e=>result.page_errors.push(e.message));
  await p.goto(`${url}/d/bench-${template}/deck.html?raw=1`);
  await p.evaluate(async()=>{await window.__DECK_READY;await Promise.all([...document.images].map(im=>im.decode().catch(()=>{})));});
  await p.emulateMedia({media:'print'});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const pdf=path.join(out,`${template}-${name}.pdf`);await p.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
  result.pdfs[template][name]=pdf;await ctx.close();
 }
 console.log('rendered',template);
}
await browser.close();
const decks=await(await fetch((process.env.SB_URL||'http://127.0.0.1:18799')+'/api/decks')).json();
const folder=decks.decks.find(d=>d.slug==='bench-blank').folder.replace(/^~/,process.env.HOME);
const env={...process.env,SB_URL:process.env.SB_URL||'http://127.0.0.1:18799',SB_DECKS_DIR:path.dirname(folder)};
for(const template of ['blank','talk','workshop','proposal','consulting']){
 const name='Lazy verify '+template, existing=decks.decks.find(d=>d.name===name);
 const slug=existing?.slug || execFileSync('python3',['sb','new',name,'--template',template],{env,encoding:'utf8',timeout:120000}).split(/\s/)[0];
 const audit=execFileSync('python3',['sb','audit',slug],{env,encoding:'utf8',timeout:120000});
 const pdf=execFileSync('python3',['sb','export',slug],{env,encoding:'utf8',timeout:120000}).trim();
 result.cli[template]={slug,audit,pdf};console.log('cli',template);
}
fs.writeFileSync(path.join(out,'rendering.json'),JSON.stringify(result,null,2)+'\n');
