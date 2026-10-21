# Decks Performance

For deck work, read [.claude/skills/decks/SKILL.md](.claude/skills/decks/SKILL.md):
feedback rounds, proposals, imports, watch mode, and the StrategyU slide method.
Import prompts also require the deck's `BRIEF.md`. Ask before installing import packages.

For app work:

- Keep `server.py` and `sb` on the Python standard library; Playwright lives in `tools/`.
- Import tools optionally use python-pptx, lxml, Pillow, PyMuPDF; server never imports them.
- Follow [scratch-server checks](docs/DEVELOPMENT.md#tests); create, audit, and export each template.
- Fixture tests rewrite decks and clear state: use a disposable directory and unused port.
- Keep documentation short: commands, results, and limits; avoid repeated explanations.
- Use “Decks Performance” / “Ask agent”; preserve upstream attribution and licenses.
- Keep `decks`, `sb`, `SB_*`, `.slidebuilder/`, legacy `claude` fields, and service names compatible.

Fork: https://github.com/delirious6423/decks.
