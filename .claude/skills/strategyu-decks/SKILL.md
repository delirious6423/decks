---
name: strategyu-decks
description: Run feedback rounds and build slides in StrategyU Decks, HTML slide decks reviewed in the browser at http://localhost:8790 (or the configured port). Use when the user says "process changes", "read my feedback", "check my comments", pastes an "Ask Claude" prompt from a deck, asks to find, open, or export a deck, or wants a new deck built. Covers the round procedure, the sb command line, the deck file, and slide style rules.
---

# StrategyU Decks

The user reviews a deck in the browser. They type a comment under a slide (or edit text right on it), then say "process changes" or click **Ask Claude** in the deck, which copies a prompt naming the deck file and the `sb` steps below; treat that prompt as "process changes" for that deck. You act on every comment, reply on the slide itself, check your work, and export. Keep the chat summary short: the replies on the slides carry the detail.

## Where things are

- The app folder is the StrategyU Decks repository: the folder this skill ships in (`.claude/skills/strategyu-decks/` inside it), or, for a copy of this skill in `~/.claude/skills/`, wherever the user cloned it. The Ask Claude prompt names it. It has `server.py`, the `sb` command line, the browser shell in `static/`, templates in `templates/`, and headless tools in `tools/`. Run `sb` from there: `./sb ...`.
- The server: `python3 server.py`, at http://localhost:8790/ unless `config.json` or `SB_PORT` says otherwise. If `sb` says the server is not reachable, start it (in the background) and try again. `sb` finds it at `SB_URL`, or at the configured port.
- Decks live in the decks folder (default `~/slide-decks`), one folder per deck, listed in `decks.json` there. `./sb decks` lists them with their addresses.
- Open a deck at `http://localhost:<port>/d/<slug>/<entry>`. `#s=<slide-id>` jumps to a slide, and `#v=<version>&s=<id>` picks a version.
- Saved state lives next to each deck in `.slidebuilder/`:
  - `state.json`: the reviewer's edits, comments, and slide order, mirrored from the page. Never write to it by hand.
  - `review.json`: your replies, rounds, and changed badges. Write it through `sb`.
- Every deck folder is a git repo. PDFs, zips, and PPTX files are ignored.

## The page

- Four views: Focus (F), Scroll (S), Sorter (G), and Checks (C). The filmstrip on the left reorders by drag.
  - In Focus and Scroll, the comment box sits under each slide, with your reply below it. The right bar holds the slide's notes and what changed.
  - Checks has five checks, keys 1 to 5: the 5-second test (first impression), the 10-second test (legibility; a miss leaves a comment on the slide for the next round), horizontal flow (the titles alone, editable in place), vertical flow (the title first, the body hidden until revealed), and Guides.
  - H hides everything but the titles. ? lists every shortcut.
- **Add a slide** (N, "+ Slide", or the + between slides) suggests layouts and can add one the deck carries. Its Copy prompt gives you the deck file, the position, and what the slide should say. When a prompt says "I just added a … slide (LIBRARY['id'])", fill that slide in; when it says "add a new slide …", build it in the deck file at that position.
- When the reviewer edits a title in Checks, that is an inline edit: bake it like any other.
- **Hide client work** (a dashboard switch, `settings.json` in the decks folder) is for recording or screen sharing. With it on, the server leaves out decks marked `client` and versions listed in `clientVersions`. Never show client names on screen when it is on.

## A round ("process changes")

1. `cd` to the app folder.
2. `./sb comments <deck>` lists the comments to act on, numbered like the deck. Drafts are skipped. `./sb edits <deck>` shows the reviewer's inline text edits and slide moves. Both read from disk, so you don't need their browser tab.
3. `./sb status <deck> "Reading your 9 comments" --done 0 --total 9`. The reviewer sees this live in the top bar. Update it as you go.
4. For each comment:
   - `./sb working <deck> <slide>`.
   - Make the change in the deck file.
   - `./sb reply <deck> <slide> done "one plain sentence on what changed"`.
   - If you need the reviewer's call, use `question` instead of `done`. For something you deliberately left alone, use `skipped` and say why.
   - A half-typed comment gets a `question` reply, not a guess.
5. Bake the reviewer's inline edits into the deck file (their edit wins). Git has the old version.
6. Check every slide you touched:
   - `./sb shot <deck> <ids…>`, then look at each image.
   - `./sb audit <deck>` finds overflow, overlapping labels, and anything the Guides flag.
   - `./sb comments <deck>` should show nothing new and unhandled.
7. Finish:
   - `./sb export <deck>` writes the next numbered PDF from the deck file and moves older ones to `_archive/`. If the browser still holds edits that aren't baked in, it says so: bake them first. `--with-edits` exports exactly what the browser shows instead.
   - `./sb round <deck> --summary "…" --changed id="what changed" … --export vN`.
   - `./sb commit <deck> "Round N: …"`.
   - `./sb idle <deck>`.
   - Tell the user where the PDF is.
8. The page reloads itself once the reviewer stops typing. Don't reload or clear their tab. In chat: a few lines, plus anything that needs their decision.

New comments can arrive while you work. Run `./sb comments` again before finishing.

The reviewer clears handled comments with "Looks good". Don't add them to `DONE_FB`; that list is only for copies opened outside StrategyU Decks, such as a file sent to someone else.

## The deck file

- One self-contained HTML file per deck, with three parts you edit:
  - content: `LIBRARY` entries (`'id': { cat, layout, title, …, notes }`), grouped into parts by `cat` (the parts are `CATS`, named in `CAT_LABELS`)
  - figures: `FIGS` functions returning inline SVG
  - versions: `PITCHES` (each a name and a list of slide ids)
- The default version is LIBRARY order within each part. To reorder, move LIBRARY entries. A saved order that equals an old default follows the file.
- Retire a slide with `alt:true` (it goes to the Sorter's shelf), and put its replacement just before it. Don't delete the user's slides. An alternative version of a slide gets `prop:true, replaces:'…'` (tagged "Proposed").
- A source line goes in the footer via `src:'Source: …'`, not a subtitle.
- Colors, title font, and logo: a `<style id="deck-theme">` block in the deck file, and `LOGO` for the deck's logo in `img/`. Restyle by editing that block, not individual slides. Without `LOGO`, slides have no logo.
- Big visual changes (a new layout, a redesign): show the user a mockup or two options first, then build.
- When the user wants a file to send someone, that is the ⋯ menu's **Client copy**: the version on screen as slides only (no notes, comments, facilitator slides, other versions, or editing), pictures inside, with a Present button. **Editable copy** is the whole deck with notes and comments: never send that one to a client.
- Decks come off the dashboard with `./sb hide <deck>` (back with `./sb show`). `./sb delete <deck> --yes` moves a deck this app made to the Trash and only unregisters a deck in a folder of the user's own. Only delete when the user asks.
- Downloading images or logos needs the user's OK each time. Tell them the filename, source, size, and license, and put the credit in the footer.

## Slide style rules

- Titles are plain full sentences that say the point, two lines at most. No comma-pivot fragments ("One mode of thinking, when the work needs two"), no slogans.
- The title is the takeaway; the body proves it. No takeaway line under a chart, list, or picture: the point goes in the title or the notes.
- No small, muted, or italic lines at the bottom of cards or boxes. Fold anything important into the item it belongs to.
- No grids of identical cards. Draw the relationship instead: a process, spectrum, ladder, chart, or map.
- Instructions are one plain sentence. Reflection questions are plain and about the audience's own work.
- Agenda times in round 5-minute blocks.
- Use the user's own material, diagrams, and wording before inventing frameworks. When cutting, cut invented slides first, and keep builds and setup/payoff pairs whole.
- Mark text you drafted in the notes, so the user can replace it.
- Quotes and numbers come only from sources you opened in the session, quoted exactly and attributed to who actually said them.
- Everything passes Checks › Guides: the protected border, two-line titles, nothing under 12 px, at most four text sizes on a slide. These are guidelines, not rules; fix what `sb audit` lists, or say why a slide is an exception.

## Starting a new deck

The user starts decks from the dashboard's **New deck** form, in two steps. Step 1: a name, what they're building (a presentation, a training, a talk, a proposal, or a blank deck), and the pieces to build alongside it. Step 2: who it's for, what they know and care about, the one point, and optional length, kind of audience, structure, density, colors, title font, logo, and notes. Create deck makes the folder, gives it its own storage prefix, adds it to `decks.json`, starts its git history, writes the brief to `BRIEF.md`, copies a prompt to their clipboard, and opens the deck. When they paste that prompt:

1. Read `BRIEF.md` in the deck folder and shape the template to it before writing slides. The template is a starting point, not a fixed form:
   - **How it will be used.** Presented: one idea per slide, big type, little text; it must pass the 5-second test. Sent to read: each slide stands on its own with a fuller body; it must pass the 10-second test. Presented, then sent: presentable slides, with the detail in the notes or an appendix.
   - **Audience and what they know.** Pitch the vocabulary, the examples, and how much you explain; executives get the answer first.
   - **Structure.** Answer first: the recommendation, then the reasons. Situation, complication, resolution: in that order. A story in a few parts: sections with dividers. Teach, practice, reflect: modules with exercises and reflection questions.
   - **Density.** Sparse, balanced, or detailed, as the words say.
   - Anything left blank is your call. Say what you chose in the chat summary.
   - **Pieces** (`## What to build` in BRIEF.md). Each piece is a version in the same deck file (the version menu), so pieces share slides. The first is the main deck: build it first, then derive the others from it. A piece other than the main one starts as one placeholder slide (`only:true, in:['<piece>']`); replace it. A slide that belongs only to a piece gets `only:true, in:['<piece>']`; a main-deck slide that also belongs in a piece adds the piece to `in`.
     - Presentation: **Final presentation** reads on its own (full story, evidence, sources). **Live presentation**: the same story with fewer words, built to present. **CEO deck**: the same story in five or six slides, answer first. **Check-in doc**: a progress update partway through (what we set out to answer, what we've learned, what's next, open questions).
     - Training: **Training content** is what's projected. **Facilitator pack** is the facilitator version (the agenda plus `fac:true` slides: run sheet, timings, notes). **Participant pack**: handouts and exercises to print.
     - Talk: **Leave-behind** is a fuller version to send afterward. Proposal: **Short version** is a few slides for the decision maker.
   - Length follows the kind: trainings in hours or days, talks in minutes, presentations and proposals in slides.
2. Build the first draft in the deck file (replace the template's placeholder slides; keep its layouts where they fit).
3. Follow the round steps from 6 on: shots, audit, export, `sb round`, commit.

When the user asks in chat instead, run `./sb new "<name>" --template <id>` with whatever brief they gave (`--audience`, `--audience-type`, `--knows`, `--use`, `--length`, `--point`, `--structure`, `--density`, `--style`, `--notes`; `./sb templates` lists the templates), then build as above.

- Templates live in `templates/<id>/` (`template.json`, `content.js`, `pitches.js`, assets). They fill the engine `templates/_engine/engine.html`.
- `consulting` (a presentation: a guided eight-slide storyline), `workshop` (a training), `talk`, `proposal`, and `blank`. Every new deck also carries the basic guided layouts in `templates/_engine/basics.js` (big number, points, two columns, process, table, quotes, divider, question, exercise) for Add a slide. Dividers show "Part N of M" with every part along the bottom; give each divider a `short` label.
