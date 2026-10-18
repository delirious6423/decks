const PITCHES = {
  day:  { name:'The day', default:true, blocks: CATS.flatMap(byCat) },
  all:  { name:'Everything — every slide, for cutting', blocks: CATS.flatMap(allCat) },
  facilitator: { name:'Facilitator pack — agenda and run sheet (print, do not project)', blocks: facPack() },
};
