# Changelog

Changes to Decks Performance Fork are maintained in
[delirious6423/decks](https://github.com/delirious6423/decks). Update this fork's
checkout and restart the server. Release notifications follow this repository.

## 0.4.0 (October 20, 2026, fork)

This fork builds on upstream Decks 0.3.0. The changes below belong to the independently
maintained performance fork, not an upstream release.

- Persistent headless-browser worker with fresh contexts for each job.
- Incremental network saves, with the existing merge and offline-recovery format.
- Lazy slide bodies, virtual slide wrappers, and virtual sidebar/filmstrip lists.
- On-demand chunks for supported large slide libraries, plus gzip responses.
- Decks Performance Fork identity across the dashboard, app menu, generated prompts
  and export provenance. User-facing controls say “Ask agent” and “Agent”.
- Fork release checks and changelog links point to `delirious6423/decks`.
- Rewritten README, separate development/API guide and preserved benchmark history.
- Template draft notes and companion-version placeholders use agent-neutral wording.

No Rust rewrite is included. Operation-specific measurements and their limitations
are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). Existing deck files, storage keys,
CLI commands and API compatibility fields keep their format.

## Upstream history

The entries below describe Paul Millerd's original Decks releases. Their historical
UI labels and original release behavior are retained here for provenance.

## 0.3.0 (October 19, 2026)

- The dashboard tells you when a new version is out, with a link to what's new. Once a day the
  server asks GitHub which release is newest (one small request; nothing about your decks is
  sent). Hide the notice until the next version with ×, or turn the check off with
  `"check_updates": false` in `config.json` or `SB_CHECK_UPDATES=0`.

## 0.2.0 (October 19, 2026)

**Checks**

- Vertical flow and Titles only find a slide's title wherever its layout puts it, including
  inside a column or a panel. Before, a custom layout could hide its own title along with
  the body. Thanks to William Fitzpatrick for reporting it.
- **Help me choose** asks what you want to know and opens the check that answers it, with
  an order for going through a whole deck.
- You can comment without leaving Checks: the comment box stays under the slide, except
  during the timed tests.
- Guides: **Ask Claude to fix** turns what a slide breaks into a comment for the next round,
  and **Comment on all** does it for every flagged slide.

**Reviewing**

- Each slide keeps its history in the side panel: every comment, the agent's reply, and how
  it ended.
- The Changed badge sits above the slide instead of covering the title.

**The agent**

- The bundled skill carries the StrategyU method: answer first, ghost deck first, action
  titles, vertical and horizontal flow, the five- and ten-second tests, "so what?", charts
  that prove the title, and how to give feedback on a deck.
- Custom layouts should give their titles the class `h-title`, so every check finds them.

**Other**

- The dashboard footer shows the version you're running, with a link to this file.
- The dashboard links to StrategyU and to the free consulting PowerPoint templates the
  consulting template is built from.
- The upstream README explains the original author’s motivation, setup and method, with screenshots.

## 0.1.0 (October 18, 2026)

The first public release.

- Comment under a slide, or edit its text, and your agent (Claude Code or Codex) changes the
  deck and replies on the slide.
- Four views (Focus, Scroll, Sorter, and Checks) and five checks: the five- and ten-second
  tests, horizontal flow, vertical flow, and Guides.
- Templates for a consulting storyline, a talk, a workshop, a proposal, and a blank deck,
  with six color themes and your own logo.
- Add a slide with Help me choose, basic layouts, and picture layouts.
- **Client copy** sends one file with only the slides. `sb export` makes PDFs.
- Saves merge across tabs and survive a dropped connection.
- Hide or delete decks from the dashboard.
- Code under MIT, templates under CC BY 4.0.
