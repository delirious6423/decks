# Decks Performance Fork: instructions for coding agents

This folder is Decks Performance Fork: HTML slide decks reviewed in the browser, where the
user comments under each slide and you edit the deck file and reply on the slide.

For any deck work ("process changes", "read my feedback", a pasted "Ask agent" prompt
from a deck, a new deck, a PDF), read and follow
`.claude/skills/decks/SKILL.md`. It has the round procedure, the `sb` commands,
how a deck file is organized, and the slide style rules.

Every slide follows the method in that file: action titles, vertical and horizontal flow, the
five- and ten-second tests, and charts that prove the title.

Quick reference:

- Start the server if it isn't running: `python3 server.py` (port 8790 unless
  `config.json` or `SB_PORT` says otherwise).
- `./sb decks`, `./sb comments <deck>`, `./sb edits <deck>`: what to act on.
- `./sb reply <deck> <slide> done|question|skipped "<text>"`: answer on the slide.
- `./sb shot`, `./sb audit`, `./sb export`, `./sb round`, `./sb commit`: check and finish.

Working on the app itself (not a deck):

- `server.py` and `sb` use only the Python standard library. Keep it that way.
- `tools/browser.mjs` needs `playwright-core` (`./setup.sh` installs it).
- Check a change by starting the server on a spare port with a scratch decks folder,
  `SB_PORT=8799 SB_DECKS_DIR=/tmp/sb-test python3 server.py`, then `sb new` a deck from
  each template and run `sb audit` and `sb export` on it.

Fork identity: Decks Performance Fork, maintained at https://github.com/delirious6423/decks.
Keep upstream license and template attribution. Use “Ask agent” in product copy; the
`decks` skill name, `sb`, `SB_*`, `.slidebuilder/`, and legacy `claude` API fields stay compatible.
Run destructive fixture tests only against a scratch server and scratch decks folder.
