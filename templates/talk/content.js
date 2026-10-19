const CATS = ['open', 'p1', 'p2', 'p3', 'close'];
const CAT_LABELS = { open: 'Opening · 0:00 (5 min)', p1: 'Part 1 · 0:05 (15 min)', p2: 'Part 2 · 0:20 (15 min)', p3: 'Part 3 · 0:35 (15 min)', close: 'Close · 0:50 (10 min)' };
const CAT_SHORT = { open: 'Open', p1: '1', p2: '2', p3: '3', close: 'Close' };
const FIGS = {};
const DRAFT = 'Draft placeholder text for your agent to replace.';

const LIBRARY = {
  'title': { cat:'open', layout:'title', title:'{{NAME_JS}}', date:'Who it is for · the date',
    notes:'Replace the title with the question the talk answers, or with the answer itself.' },
  'question': { cat:'open', layout:'reflect', q:'The question this talk answers, the way the audience would ask it',
    subq:'Open with their problem, not your credentials.', notes: DRAFT },
  'agenda': { cat:'open', layout:'agenda', title:'What we’ll cover',
    rows:[
      { t:'1', m:'15', k:'practice', b:'<b>Part 1.</b> What the first part shows' },
      { t:'2', m:'15', k:'practice', b:'<b>Part 2.</b> What the second part shows' },
      { t:'3', m:'15', k:'practice', b:'<b>Part 3.</b> What the third part shows' },
      { t:'', m:'10', k:'intro', b:'<b>Questions,</b> and what to try this week' },
    ], notes:'Agenda times in round 5-minute blocks.' },

  'p1-section': { cat:'p1', layout:'section', dark:true, n:'1', short:'The first part', mod:'Part 1', title:'The first part of the argument', able:'One line on what this part shows.' },
  'p1-point': { cat:'p1', layout:'plain', title:'Each title says the point of its slide as one plain sentence',
    body:['The body proves the title. Keep only what the audience needs to believe the sentence above.',
          'A title takes two lines at most. Checks › Guides (key 5) shows that limit and the protected border.'], notes: DRAFT },
  'p1-compare': { cat:'p1', layout:'twocol', title:'Put two things side by side when the difference is the point',
    cols:[{ h:'Today', body:['What happens now.'] }, { h:'Proposed', body:['What changes, and why it is better.'] }], notes: DRAFT },

  'p2-section': { cat:'p2', layout:'section', dark:true, n:'2', short:'The second part', mod:'Part 2', title:'The second part of the argument', able:'One line on what this part shows.' },
  'p2-process': { cat:'p2', layout:'flow', title:'Show a process as a few steps, with the one that matters highlighted',
    steps:[ { wk:'Step 1', lbl:'What happens first', sub:'One line of detail' }, { wk:'Step 2', lbl:'What happens next', sub:'One line of detail' },
            { wk:'Step 3', lbl:'The step that matters', sub:'Why it is the one to watch', accent:true } ], notes: DRAFT },
  'p2-data': { cat:'p2', layout:'data', title:'A small table can carry the numbers, with the column that matters highlighted',
    cols:['', 'Before', 'After'], rows:[['First measure', '10', '14'], ['Second measure', '22', '31'], ['Third measure', '5', '9']], em:2,
    notes:'Illustrative numbers: replace them with real ones, and say where they come from.' },

  'p3-section': { cat:'p3', layout:'section', dark:true, n:'3', short:'The third part', mod:'Part 3', title:'The third part of the argument', able:'One line on what this part shows.' },
  'p3-voices': { cat:'p3', layout:'twocol', title:'People’s own words, quoted exactly, carry more than a summary of them',
    cols:[ { h:'Name, role', body:['“Their words, quoted exactly from a source you can cite.”'] },
           { h:'Name, role', body:['“A second voice, ideally one that disagrees.”'] } ],
    notes:'Only real quotes from a source you have open, attributed to who actually said them.' },
  'p3-point': { cat:'p3', layout:'plain', title:'End each part on the sentence you want people to repeat afterward',
    body:['One or two lines that land the part.'], notes: DRAFT },

  'try': { cat:'close', layout:'reflect', q:'What will you try in your own work this week?', subq:'A plain question about the audience’s own work.', notes: DRAFT },
  'closing': { cat:'close', layout:'closing', dark:true, title:'Thank you', contacts:['Your name', 'your-site.com'], site:'', notes:'Replace with your name and where people can reach you.' },
};
