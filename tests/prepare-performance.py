"""Make disposable standard and mixed-layout large fixtures: python3 tests/prepare-performance.py /tmp/decks-perf."""
import sys, json, os
from pathlib import Path
repo=Path(__file__).resolve().parent.parent; dest=Path(sys.argv[1]).resolve();sys.path.insert(0,str(repo));os.environ['SB_DECKS_DIR']=str(dest);os.environ['SB_CHECK_UPDATES']='0'
import newdeck, sbconfig
for tid in ('blank','talk','workshop','proposal','consulting'):
    name='Bench '+tid
    reg=json.loads(sbconfig.REGISTRY.read_text()) if sbconfig.REGISTRY.exists() else {'decks':[]}
    d=next((d for d in reg['decks'] if d['name']==name),None) or newdeck.create_deck(name,tid)
    (Path(d['folder']).expanduser()/d['entry']).write_text(newdeck.assemble(tid,name,d['prefixes'][0]))
for size in (100,500,1000):
    name='Bench large '+str(size)
    reg=json.loads(sbconfig.REGISTRY.read_text());d=next((d for d in reg['decks'] if d['name']==name),None) or newdeck.create_deck(name,'blank')
    lib={}
    for i in range(size):
        common={'cat':'main','title':f'Slide {i+1} shows where the operating plan improves margins','notes':f'Facilitator note {i+1}'}
        if i%3==0:
            common.update(layout='data',cols=['Product','Revenue','Cost','Margin'],rows=[[f'Product {j}',str(j*10),str(j*6),'40%'] for j in range(12)],numeric=True)
        elif i%3==1:common.update(layout='twocol',cols=[{'h':'Today','body':['Long manual handoffs','Repeated data collection','Delayed decisions']},{'h':'Proposed','body':['One shared review','Automatic checks','Visible ownership']}])
        else:common.update(layout='plain',body=['The body proves this slide’s title.','Keep the evidence focused on this decision.','Each version retains its own edits and order.'])
        lib['large-'+str(i)]=common
    html=newdeck.assemble('blank',name,d['prefixes'][0])
    marker='const PITCHES = {'
    html=html.replace(marker,'Object.assign(LIBRARY,'+json.dumps(lib,ensure_ascii=False)+');\n'+marker)
    html=html.replace('blocks: CATS.flatMap(byCat)',f"blocks: Array.from({{length:{size}}}, (_,i)=>'large-'+i)")
    html=html.replace('renderPitch(current); restore(); recountSidebar();',"const benchStart=performance.now();const benchBuild=build;let benchBuilds=0;build=(...args)=>{benchBuilds++;return benchBuild(...args);};renderPitch(current); restore(); recountSidebar();window.__BENCH_ENGINE_MS=performance.now()-benchStart;window.__BENCH_BUILDS=()=>benchBuilds;")
    (Path(d['folder']).expanduser()/d['entry']).write_text(html)
print(dest)
