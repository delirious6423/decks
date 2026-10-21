---
name: decks
description: Build, import, review, and export HTML decks in Decks Performance. Use for process changes, pasted Ask agent prompts, new decks, PowerPoint/PDF imports, returned review copies, or watch mode.
---

# Deck workflow

Run `./sb` from the app checkout. Start `python3 server.py` if unreachable; default
URL is `http://localhost:8790`, overridden by config/`SB_PORT` or CLI `SB_URL`.
Decks live in `~/slide-decks` (or `SB_DECKS_DIR`); `./sb decks` lists them.
Open `/d/<slug>/<entry>#v=<version>&s=<id>`. Each deck has its own git history.
Never edit `.slidebuilder/state.json` by hand; write `review.json` through `sb`.

## Feedback rounds

A pasted **Ask agent** prompt means process that deck's changes. New-slide prompts
identify the entry/position to fill. Read Checks comments like any other feedback.

1. Read `./sb comments <deck>`, `./sb edits <deck>`, and `./sb proposals <deck>`.
   Skip drafts; ask about incomplete comments. Set `./sb status <deck> "Reading feedback" --done 0 --total N`; update progress.
2. For each comment, run `./sb working <deck> <id>`, edit the HTML, then
   `./sb reply <deck> <id> done|question|skipped "What changed, or why not"`.
3. Run `./sb proposals <deck> --bake`. Bake inline edits/order too: reviewer edits win.
   Proposal-driven removals are handled by the bake; don't move those slides manually.
4. Run `./sb shot <deck> <ids…>` and inspect each touched slide; run `./sb audit <deck>`.
   Re-read comments before finishing; handle any new ones.
5. `./sb export <deck>` writes a numbered PDF and archives older exports. Bake outstanding
   edits first, or use `--with-edits` to export saved browser edits explicitly.
6. Record `./sb round <deck> --summary "…" --changed id="What changed" --export vN`,
   then `./sb commit <deck> "Round N: …"` and `./sb idle <deck>`.
   Give the PDF path and unresolved decisions in a brief chat reply.

Let the page reload itself; never clear/reload the reviewer's tab. They clear handled
comments with **Looks good**. `DONE_FB` is only for copies opened outside the app.
**Hide client work** excludes registry `client` decks / `clientVersions`: don't show hidden client names.

Returned file: `./sb import <deck> <file.html> [--dry-run] [--keep-mine]`, then process
changes. Comments merge; changed file text/order wins unless `--keep-mine` protects
conflicts. Notes/facilitator slides are restored for review copies. Report skipped
stale slides and reviewer edits; don't silently recreate them. Wrong-deck files are refused.

Watch mode: on request, run `./sb watch [deck]` in the background, process the named
deck when it returns, then restart the watcher. No slug watches all decks; clicks during
rounds queue. Continue until stopped; report watcher errors instead of restarting them.

## Editing and proposals

`LIBRARY` holds slides (`cat`, `layout`, `title`, `notes`); `CATS`/`CAT_LABELS` group them.
`FIGS` draws inline SVG; `PITCHES` defines versions. Default order follows entries within
parts. Retire originals with `alt:true`; don't delete the user's slides. Put sources in `src`.
Restyle via `deck-theme` and `LOGO`, not individual slides. Show mockups/options before big redesigns.

For an unsolicited alternative, keep the original unchanged and add a plain object
immediately after it: `'id-2': {cat, layout, title, notes, prop:true, replaces:'id'}`.
Explain the difference in notes; use the same `replaces` for real alternatives and
inherit `alt:true` when proposing an extra. Edit a commented proposal in place.
The reviewer alone accepts/keeps proposals; Space flips, A accepts, K keeps, U undoes.
`--bake` retires accepted originals, promotes replacements, removes rejected proposals,
and updates explicit version lists. Reply `skipped` on comments belonging to rejected proposals.
For NOT BAKED/rollback, resolve manually and rerun; conflicting accepted options require the user's choice.

Build charts from supplied numbers and cite source/range. Consulting 2x2 geometry in
`ct-slides.js` / `sp6`: plot x=105–661, y=131–477; thresholds x=383, y=304. Scale each
axis half from its threshold; higher scores go right/up. Center 20px dots on scores;
labels start at dot x+23,y−2, or x−3−labelWidth with right alignment at the right edge.
Use accent for the recommended quadrant, gray elsewhere; match option/callout counts.

**Client copy** shares only the current version's slides with images, no notes/comments.
**Editable copy** contains all versions and private review material; never send it to clients.
Hide/show via `sb hide` / `sb show`; delete only when requested (`sb delete <deck> --yes`).
Ask before each image/logo download; state filename, source, size, license, and credit the footer.

## Slide method

Inherited from Paul Millerd / StrategyU; use `strategy-slides` if installed.

- Draft titles as a paragraph before bodies. Lead with the answer; use situation/complication first for skeptical audiences.
- Titles are full sentences stating the finding, two lines max; body proves title, titles alone tell the story.
  Covers/section/appendix dividers are exempt; closing slides still ask for a concrete decision.
- One idea per slide. Five seconds for presented slides, ten for reading; separately test “so what?”.
  Presented bodies stay under 20 words; reading decks stand alone with evidence and bold lead words.
- Charts prove the title: bars/columns/lines, no pies; emphasize the relevant number, remove distractions.
  Label uncertain data “Illustrative” and record assumptions. Quotes/numbers require sources opened this session and exact attribution.
- Executive summary: recommendation + three insights with evidence. Use section dividers for distinct parts in 20+ slide decks.
- Review the whole deck before feedback: storyline, specific slides with fixes/new titles, then the three priorities. Story before styling.
- Write plain active sentences; avoid vague claims, forced metaphors, comma-pivot fragments, bottom takeaway strips, and filler.
  No more than one em dash per slide. Use the user's words/diagrams before invented frameworks; cut invented slides first and preserve setup/payoff pairs.
- Draw relationships instead of identical card grids. Avoid tiny/muted/italic card footnotes; use plain instructions/questions and five-minute agenda blocks.
- Mark drafted text in notes. Give custom titles `h-title` or `h2`; dividers need a `short` label.
  Pass Guides: protected border, two-line titles, minimum 12px, at most four text sizes; explain justified exceptions.

## New decks and imports

Read the deck's `BRIEF.md`; adapt audience, use, structure, density, length, theme, and
logo before building. Choose unspecified details and disclose choices briefly.
`./sb new "Name" --template <id>` accepts brief flags (`./sb help`); templates are
consulting, talk, workshop, proposal, blank. Build, then follow round steps 4–6.
Companion pieces are versions: build the main deck first, then derive them. Replace
piece placeholders; `only:true, in:['piece']` marks exclusive slides, `in` shares them.

New import: `./sb new "Name" --from file.pptx|file.pdf [--rebuild]`; follow `BRIEF.md`.
Keynote/Google Slides/old PPT need PPTX export. This differs from returned-file `sb import`.
Check `python3 tools/importdeck.py --check`; ask before installing missing
python-pptx, lxml, Pillow, PyMuPDF. PPTX previews/chart cutouts need a companion PDF
in `source/` or LibreOffice. Otherwise request an exported PDF; explain that `--no-pdf`
omits charts, SmartArt, icons, and original previews.

- **Keep look:** `python3 tools/importdeck.py <deck>`. Preserve words/layout/notes;
  user reviews before rewriting. Sections become parts, hidden slides extras; PDF text is
  editable by line without reflow or speaker notes. Compare first/last and chart/table/photo/
  diagram screenshots with `img/imp-NNN.jpg`; audit clipping, report inherited Guide warnings
  without restyling. Fix geometry in `ct-slides.js`; derive missing titles from existing words.
- **Rebuild:** run the tool with `--outline`; use `source/outline.md` and `source/pages/`.
  Preserve words/order/titles/notes. Split overcrowded slides or move details to notes and
  disclose it. Rebuild charts from numbers; suggest better titles in notes. Dense diagrams
  can stay converted via `--slides N --no-wire`. Compare screenshots; pass Guides.

Reruns replace imported slides; `--force` overrides changed-deck protection, so use deliberately.
Finish with export/commit; report editable vs image slides, differences, splits, and omitted material.
