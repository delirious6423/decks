# Changelog

What changed in each version of Decks. To update, run `git pull` in your Decks folder, then
restart the server. To hear about new versions, watch this repository on GitHub
(Watch › Custom › Releases).

## 0.4.0 (October 20, 2026)

- **Watch mode.** Say "watch my deck" once in Claude Code. In the deck, Ask Claude turns into
  **Process now**, and each click starts a round in that chat without typing anything. A click
  while Claude is busy is queued. Behind it is a new command, `sb watch <deck>`.
- The server accepts changes only from its own pages. Before, another website you visited could
  have sent requests to it (depending on your browser).
- **Send feedback** on the dashboard and in each deck's ⋯ menu opens an email to Paul at
  paul@strategyu.co (and copies the address, in case your mail app doesn't open).

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
- The README explains why I built this, the setup I use, and the method, with screenshots.

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
