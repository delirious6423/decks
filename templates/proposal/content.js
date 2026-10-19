const CATS = ['open', 'why', 'how', 'who', 'next'];
const CAT_LABELS = { open: 'Opening', why: 'Why this work', how: 'How we would do it', who: 'Team and fees', next: 'Next steps' };
const CAT_SHORT = { open: 'Open', why: 'Why', how: 'How', who: 'Who', next: 'Next' };
const FIGS = {};
const DRAFT = 'Draft placeholder text for your agent to replace.';

const LIBRARY = {
  'title': { cat:'open', layout:'title', title:'{{NAME_JS}}', date:'Prepared for the client · the date',
    notes:'Name the decision the client is making, not the service you sell.' },

  'situation': { cat:'why', layout:'plain', title:'Write the client’s situation as one sentence they would agree with',
    body:['What they are trying to do, and what stands in the way.', 'Use their words from the first conversation where you can.'], notes: DRAFT },
  'success': { cat:'why', layout:'twocol', title:'Say what will be different when the work is done, and how everyone will know',
    cols:[{ h:'What changes', body:['The outcome, in the client’s terms.'] }, { h:'How we will know', body:['What you will measure or see.'] }], notes: DRAFT },

  'approach': { cat:'how', layout:'flow', title:'Lay out the work as three or four steps, each ending in something the client gets',
    steps:[ { wk:'Weeks 1–2', lbl:'Understand', sub:'What you will learn and from whom' }, { wk:'Weeks 3–4', lbl:'Design', sub:'What you will build with them' },
            { wk:'Weeks 5–6', lbl:'Deliver', sub:'What they walk away with', accent:true } ], notes: DRAFT },
  'timeline': { cat:'how', layout:'data', numeric:false, title:'A week-by-week plan shows the client exactly what arrives and when',
    cols:['When', 'Work', 'What you get'], rows:[['Weeks 1–2', 'Interviews and data review', 'A one-page summary of what we heard'], ['Weeks 3–4', 'Working sessions with your team', 'A draft answer to react to'], ['Weeks 5–6', 'Final design and handover', 'The final deliverable and a plan to use it']], notes: DRAFT },

  'team': { cat:'who', layout:'twocol', title:'Introduce the people who will do the work and why they fit this client',
    cols:[{ h:'Name, role', body:['One line on relevant experience.'] }, { h:'Name, role', body:['One line on relevant experience.'] }], notes: DRAFT },
  'fees': { cat:'who', layout:'data', numeric:false, title:'Two or three options let the client choose the scope that fits',
    cols:['Option', 'What is included', 'Fee'], rows:[['Focused', 'The core work only', '$'], ['Recommended', 'The core work plus working sessions', '$$'], ['Extended', 'Everything, plus support after handover', '$$$']], em:2,
    notes:'Placeholder fees: fill in real ones before this leaves the building.' },

  'next-steps': { cat:'next', layout:'plain', title:'Agree on the next step and a date before the meeting ends',
    body:['<b>This week:</b> a call to confirm scope.', '<b>Next week:</b> a signed statement of work and a start date.'], notes: DRAFT },
  'closing': { cat:'next', layout:'closing', dark:true, title:'Thank you', contacts:['Your name', 'your-site.com'], site:'', notes:'Replace with your name and where people can reach you.' },
};
