const CATS = ['open', 'm1', 'm2', 'm3', 'close'];
const CAT_LABELS = { open: 'Welcome · 9:00 (30 min)', m1: 'Module 1 · 9:30 (90 min)', m2: 'Module 2 · 11:15 (90 min)', m3: 'Module 3 · 13:30 (90 min)', close: 'Wrap · 15:15 (30 min)' };
const CAT_SHORT = { open: 'Welcome', m1: '1', m2: '2', m3: '3', close: 'Wrap' };
const FIGS = {};
const DRAFT = 'Draft placeholder text for your agent to replace.';

const LIBRARY = {
  'title': { cat:'open', layout:'title', title:'{{NAME_JS}}', date:'The group · the date',
    notes:'Replace the title with what the group will be able to do by the end of the day.' },
  'agenda': { cat:'open', layout:'agenda', title:'What we’ll cover today',
    rows:[
      { t:'', m:'30', k:'intro', b:'<b>Welcome.</b> Goals for the day and introductions' },
      { t:'1', m:'90', k:'practice', b:'<b>Module 1.</b> The first skill, taught and practiced' },
      { t:'', m:'15', k:'intro', b:'<b>Break</b>' },
      { t:'2', m:'90', k:'practice', b:'<b>Module 2.</b> The second skill, taught and practiced' },
      { t:'', m:'45', k:'intro', b:'<b>Lunch</b>' },
      { t:'3', m:'90', k:'practice', b:'<b>Module 3.</b> Putting it together on a real case' },
      { t:'', m:'30', k:'intro', b:'<b>Wrap.</b> What each team will use first' },
    ], notes:'Agenda times in round 5-minute blocks.' },
  'poll': { cat:'open', layout:'reflect', q:'Where do you get stuck most often?',
    subq:'<b>1.</b> The first option<br><b>2.</b> The second option<br><b>3.</b> The third option', notes: DRAFT },

  'm1-section': { cat:'m1', layout:'section', dark:true, n:'1', mod:'Module 1', title:'The first skill', able:'What the group will be able to do after this module.', when:'9:30 · 90 minutes' },
  'm1-teach': { cat:'m1', layout:'plain', title:'Teach one idea per slide, and say it as a plain sentence in the title',
    body:['The body gives the one example that makes the idea stick.', 'Slow down here: the group should feel each step, not just hear it.'], notes: DRAFT },
  'm1-example': { cat:'m1', layout:'twocol', title:'Show a weak example next to a strong one so the difference is obvious',
    cols:[{ h:'Weak', body:['What most people write first.'] }, { h:'Strong', body:['The same thing, done well.'] }], notes: DRAFT },
  'm1-practice': { cat:'m1', layout:'breakout', lab:'Practice', time:'20', setup:'<b>Pairs</b>Who works with whom.',
    title:'Each pair rewrites one of their own examples using the idea',
    steps:['Each person picks one example from their own work.', 'Rewrite it together using the idea from this module.', 'Then we will hear two or three.'], notes: DRAFT },
  'break-1': { cat:'m1', layout:'lines', maroonBg:true, lines:[{ t:'Break · back at 11:15', size:'3.4rem' }] },

  'm2-section': { cat:'m2', layout:'section', dark:true, n:'2', mod:'Module 2', title:'The second skill', able:'What the group will be able to do after this module.', when:'11:15 · 90 minutes' },
  'm2-steps': { cat:'m2', layout:'flow', title:'Lay out the method as a few steps the group can follow on their own',
    steps:[ { wk:'Step 1', lbl:'Start here', sub:'One line of detail' }, { wk:'Step 2', lbl:'Then this', sub:'One line of detail' },
            { wk:'Step 3', lbl:'The step people skip', sub:'Why it matters', accent:true } ], notes: DRAFT },
  'm2-practice': { cat:'m2', layout:'breakout', lab:'Practice', time:'25', setup:'<b>Teams of four</b>Mixed functions if you can.',
    title:'Each team runs the method on a case from their own work',
    steps:['Pick one live problem from someone on the team.', 'Work through the steps in order.', 'Write the answer on one page to share back.'], notes: DRAFT },

  'm3-section': { cat:'m3', layout:'section', dark:true, n:'3', mod:'Module 3', title:'Putting it together', able:'The whole method on one real case.', when:'13:30 · 90 minutes' },
  'm3-case': { cat:'m3', layout:'plain', title:'Introduce the case with only the facts the group needs to start',
    body:['Who the client is, and what they asked for.', 'What the group has to produce, and by when.'], notes: DRAFT },
  'm3-practice': { cat:'m3', layout:'breakout', lab:'Case', time:'45', setup:'<b>Teams of four</b>The same teams as before.',
    title:'Each team presents its case answer in three minutes',
    steps:['Read the brief and agree on the question.', 'Work the case using both modules.', 'Present the answer first, then the support.'], notes: DRAFT },

  'reflect': { cat:'close', layout:'reflect', q:'What will you use first on Monday?', subq:'One thing, from your own work.', notes: DRAFT },
  'closing': { cat:'close', layout:'closing', dark:true, title:'Thank you', contacts:['Your name', 'your-site.com'], site:'', notes:'Replace with your name and where people can reach you.' },

  'run-sheet': { cat:'close', layout:'plain', fac:true, title:'Run sheet for the facilitator',
    body:['9:00 Welcome and the poll.', '9:30 Module 1, practice at 10:30.', '11:15 Module 2, practice at 12:00.', '13:30 Module 3 case, teams present at 14:45.', '15:15 Wrap.'],
    notes:'Prints in the Facilitator pack version. Never projected.' },
};
