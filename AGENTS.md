# Slide Builder: instructions for coding agents

This folder is the Slide Builder: HTML slide decks reviewed in the browser, where the
user comments under each slide and you edit the deck file and reply on the slide.

For any deck work ("process changes", "read my feedback", a pasted "Ask Claude" prompt
from a deck, a new deck, a PDF), read and follow
`.claude/skills/slide-builder/SKILL.md`. It has the round procedure, the `sb` commands,
how a deck file is organized, and the slide style rules.

Quick reference:

- Start the server if it isn't running: `python3 server.py` (port 8790 unless
  `config.json` or `SB_PORT` says otherwise).
- `./sb decks`, `./sb comments <deck>`, `./sb edits <deck>`: what to act on.
- `./sb reply <deck> <slide> done|question|skipped "<text>"`: answer on the slide.
- `./sb shot`, `./sb audit`, `./sb export`, `./sb round`, `./sb commit`: check and finish.

Working on the Slide Builder itself (not a deck):

- `server.py` and `sb` use only the Python standard library. Keep it that way.
- `tools/browser.mjs` needs `playwright-core` (`./setup.sh` installs it).
- Check a change by starting the server on a spare port with a scratch decks folder,
  `SB_PORT=8799 SB_DECKS_DIR=/tmp/sb-test python3 server.py`, then `sb new` a deck from
  each template and run `sb audit` and `sb export` on it.
