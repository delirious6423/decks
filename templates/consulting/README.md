# Consulting starter

These slides are converted from the StrategyU [free consulting PowerPoint templates](https://strategyu.co/strategy-consulting-powerpoint-templates/)
(100+ slides). Download those for the full library in PowerPoint.

A guided storyline in eight slides, in the order a consulting-style deck usually runs:

1. Cover: the question the deck answers, or the answer itself
2. Executive summary: the whole answer as one sentence, with three reasons
3. Storyline: every action title in order, so you can check the story reads on its own
4. Hypothesis tree: the few things that must be true for the answer to hold
5. Ghost chart: each page sketched before the data arrives, with [X] for the numbers
6. 2x2: the options placed on two axes that matter
7. Plan: phases, each ending in something you can show or decide
8. Next steps: the decision you need, and who does what by when

Every line on a slide says what goes there, so a person or an agent can replace it.

## Files

- `content.js`: the parts (`CATS`) and the slides (`LIBRARY`). Each slide is
  `ct(key, cat, title, extra)`, where `key` names its entry in `CT`, `title` is its action
  title, and `notes` its speaker notes.
- `pitches.js`: the versions. The default is the eight-slide starter.
- `ct-slides.js`: `const CT`, the shapes of each slide (text, boxes, lines, chevrons, tables),
  drawn by the engine's `pptx` layout. Every word is editable in the browser.

The slides were converted from PowerPoint with `tools/pptx2native.py`. You can convert your
own PowerPoint layouts the same way (see that script's docstring) and add them as a template.

## Known limits

- Converted text is drawn in the engine's font (Lato), so line breaks can fall in slightly
  different places than in PowerPoint.
- Titles keep PowerPoint's 26 pt rather than the engine's 36 pt title size.
- Tables take the engine's table style.

The template content in this folder is licensed CC BY 4.0 (see `LICENSE-templates` at the
top of the repository).
