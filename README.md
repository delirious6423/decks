# Decks Performance

A performance-focused fork of [Decks](https://github.com/paulmil11/decks) for creating
and reviewing HTML slide decks locally. Synced with upstream 0.9.0, with persistent
browser workers, incremental saves, lazy rendering, and on-demand slide libraries.

Edit slide text, leave comments, and copy a prompt to your coding agent. The app
runs locally; **Ask agent** copies a prompt and does not call a model API.

## Setup

Requires Python 3.9+, Node.js 18+, and macOS or Linux. Git enables deck history.

```bash
git clone https://github.com/delirious6423/decks.git decks-performance
cd decks-performance
./setup.sh
python3 server.py
```

Open [localhost:8790](http://localhost:8790/). Decks and review state are stored in
`~/slide-decks/`. Set `SB_DECKS_DIR` to use another directory. The server and `sb` CLI
use the Python standard library; headless jobs use Playwright and Chromium.

## Workflow

1. Create a deck from a template, or import a PowerPoint/PDF through **New deck**.
2. Paste the copied brief into your coding agent to build or adapt the deck.
3. Edit text and leave comments in the browser. **Ask agent** copies the next round.
4. Review replies and proposed slides. Accept an option, keep the original, or undo.
5. Use **Share** to download a PDF, a client copy, a review copy, or an editable copy.

Templates: consulting, talk, workshop, proposal, and blank. Focus, Scroll, Sorter,
and Checks provide editing, reordering, and layout review. Existing deck files keep
their embedded engine; new decks get the current rendering improvements.

PowerPoint/PDF conversion needs optional Python packages:

```bash
python3 -m pip install python-pptx lxml Pillow PyMuPDF
python3 tools/importdeck.py --check
```

LibreOffice or a companion PDF supplies PowerPoint slide previews. Review copies
return through `./sb import <deck> <file.html>`. `./sb new --from` starts a new import.

## CLI and configuration

Run `./sb` from this checkout while the server is running:

```bash
./sb new "Pricing review" --template consulting
./sb decks
./sb comments <deck>
./sb proposals <deck> --bake
./sb audit <deck>
./sb export <deck> --with-edits
```

Copy `config.example.json` to `config.json`, or set environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `SB_DECKS_DIR` | Decks directory | `~/slide-decks` |
| `SB_HOST` / `SB_PORT` | Server address | `127.0.0.1:8790` |
| `SB_URL` | CLI server URL | Configured local server |
| `SB_CHROME` | Browser executable | Auto-detected |
| `SB_CHECK_UPDATES` | Automatic fork release checks | `1` |

Pull from this fork and restart to update. Existing clones can update their remote:

```bash
git remote set-url origin https://github.com/delirious6423/decks.git
git pull
```

Release checks use this fork's GitHub releases every six hours, with retries after
failures. GitHub receives the request IP, not deck contents. Set `SB_CHECK_UPDATES=0`
to disable automatic checks. Fonts or custom deck assets may use remote services;
your chosen coding agent handles model access under its own settings.

## Development and attribution

[Development](docs/DEVELOPMENT.md) covers architecture, APIs, scratch-server tests,
and optional login services in `contrib/`. [Performance](docs/PERFORMANCE.md) records
benchmarks and their limits. Gains depend on the operation and deck size.
[Changelog](CHANGELOG.md) distinguishes fork changes from upstream history.

Original code, consulting method, and templates: Paul Millerd / StrategyU. Fork
changes: delirious6423. Code: [MIT](LICENSE). Templates: [CC BY 4.0](LICENSE-templates).
See [NOTICE](NOTICE) for third-party attribution.
