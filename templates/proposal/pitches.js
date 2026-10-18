const PITCHES = {
  proposal: { name:'The proposal', default:true, blocks: CATS.flatMap(byCat) },
  all:      { name:'Everything — every slide, for cutting', blocks: CATS.flatMap(allCat) },
};
