# Decks Performance

Create and review HTML slides locally. Edit text, leave comments, then **Ask agent**
to copy a prompt to your coding agent. The app does not call a model API.

Fork of [Decks](https://github.com/paulmil11/decks), synced through upstream 0.9.0.
Adds reusable browser workers, incremental saves, lazy rendering, and slide-data chunks.

## Run

Python 3.9+, Node.js 18+, macOS or Linux:

```bash
git clone https://github.com/delirious6423/decks.git decks-performance
cd decks-performance
./setup.sh
python3 server.py
```

Open [localhost:8790](http://localhost:8790/). Create a deck, paste its brief into your
agent, and review the result. **Share** exports PDFs or client, review, and editable copies.
Templates: consulting, talk, workshop, proposal, blank. Press `?` for shortcuts.

## Settings and updates

Set `SB_DECKS_DIR` (default `~/slide-decks`), `SB_HOST`/`SB_PORT` (`127.0.0.1:8790`),
`SB_URL` (CLI URL), or `SB_CHROME` (browser path); see `config.example.json`.
Update with `git pull`, then restart. Existing decks keep their embedded engine.
Fork release checks run every six hours; `SB_CHECK_UPDATES=0` disables them.
Checks send no deck content. Fonts/assets and your coding agent may use external services.

[Development and imports](docs/DEVELOPMENT.md) · [Benchmarks](docs/PERFORMANCE.md) ·
[Changes](CHANGELOG.md) · [CLI help](sb) · [Agent guide](.claude/skills/decks/SKILL.md)

Original code, method, and templates: Paul Millerd / StrategyU. Fork: delirious6423.
Code: [MIT](LICENSE). Templates: [CC BY 4.0](LICENSE-templates). [Notices](NOTICE).
