const PITCHES = {
  deck: { name:'The deck', default:true, blocks: CATS.flatMap(byCat) },
  all:  { name:'Everything — every slide, for cutting', blocks: CATS.flatMap(allCat) },
};
