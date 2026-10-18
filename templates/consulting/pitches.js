const PITCHES = {
  starter: { name:'Starter: a guided storyline', default:true, blocks: ['sample-cover', 'exec-summary-numbered', 'storyline-flow', 'hypothesis-tree', 'ghost-chart', 'sample-2x2', 'sample-process', 'sample-next-steps'] },
  all:     { name:'Everything — every slide, for cutting', blocks: CATS.flatMap(allCat) },
};
