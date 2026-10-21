# Development

## Files and state

| Files | Role |
|---|---|
| `server.py`, `sb`, `sbconfig.py` | HTTP API, CLI, configuration; Python standard library only |
| `newdeck.py`, `templates/` | Deck creation, engine, layouts, themes |
| `static/` | Dashboard, review shell, save bridge, sharing |
| `library.py`, `static/library.js` | Safe extraction and loading of large slide libraries |
| `tools/browser*.mjs` | Serialized Chrome jobs; fresh context per job |
| `tools/importdeck.py`, `tools/pptx2native.py`, `tools/proposals.py` | Import conversion and proposal baking |

Each deck's `.slidebuilder/state.json` holds edits/order/comments; `review.json` holds
replies/rounds. Write through the app or `sb`. Network saves send changed leaves;
localStorage and disk still store full snapshots. Existing HTML retains its own engine.
Client work is hidden with registry `client` / `clientVersions` fields, not access control.
Keep `sb`, `SB_*`, `decks`, `.slidebuilder/`, service names, and legacy `claude` keys compatible.

New engines virtualize interactive decks at 80 slides. Data-only library blocks with
256+ entries split into 64-slide chunks; unsupported expressions stay embedded.
Raw/readonly exports remain eager. Await `SlideBuilder.go()`, `SlideBuilder.setView()`,
`SlideBuilder.clientCopy()`, and `SBGuides.scan()`; load cold bodies with `DeckData.load([id])`
before `DeckRenderer.preview()`/`ensure()`. Use `DeckRenderer.ids()` and
`SlideBuilder.comment(id[, text])` for offscreen slides; DOM queries see mounted slides only.

## API

Paths below follow `/api/decks/<slug>/` unless shown otherwise.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/decks`, `/api/decks/<slug>`, `/api/templates` | Lists and metadata |
| GET / PUT | `state` | Saved browser state |
| GET / POST | `review` | Replies, status, rounds, proposal decisions |
| GET | `comments`, `pulse` | Feedback and live changes |
| POST | `manage`, `bundle`, `upload`, `pdf` | Hide/show/delete, sharing, assets, PDF |
| POST | `/api/new-deck`, `/api/upload-source`, `/api/check-updates` | Creation, import upload, release check |

## Tests

Fixture generation rewrites decks; tests clear saved state. Use a new scratch directory.
Requires `./setup.sh` and Poppler (`pdftotext`). From the checkout:

```bash
python3 -m unittest discover -s tests
export SB_DECKS_DIR=$(mktemp -d) SB_PORT=8799 SB_CHECK_UPDATES=0
BENCH_SIZES=100,500,1000,10000 python3 tests/prepare-performance.py "$SB_DECKS_DIR"
export SB_URL=http://127.0.0.1:$SB_PORT SB_CHROME=$(node tools/browser.mjs chrome)
python3 server.py > "$SB_DECKS_DIR/server.log" 2>&1 &
until ./sb templates > /dev/null 2>&1; do sleep 0.2; done
node --test --test-concurrency=1 tests/*.test.mjs
for t in blank talk workshop proposal consulting; do ./sb audit "bench-$t"; ./sb export "bench-$t"; done
kill $!  # stop the scratch server
```

[Benchmark methodology](PERFORMANCE.md). Consulting's `sample-2x2` has a text-size advisory.

## Diagnostics and imports

Worker: `node tools/browser.mjs worker-status` / `worker-stop`; idle timeout is two minutes.
`SB_BROWSER_WORKER=0` disables reuse; `SB_BROWSER_IDLE_MS` changes timeout. Custom charts
can set `window.__DECK_READY`; headless readiness times out after 30 seconds.
Diagnostic query switches: `?lazy=0`, `?lists=0`, `?wrappers=0`, `?library=0`, `?raw=1`.
Server switches: `SB_SPLIT_LIBRARY=0`, `SB_GZIP=0`.

For PowerPoint/PDF: `python3 -m pip install python-pptx lxml Pillow PyMuPDF`, then
`python3 tools/importdeck.py --check`. LibreOffice or a companion PDF supplies PPTX previews.
`./sb new "Name" --from file.pptx` starts an import; `--rebuild` requests native layouts.
`./sb import <deck> file.html` brings back a reviewer copy. Follow the generated `BRIEF.md`.
Login services: replace `__APP__` in `contrib/decks.service` or `contrib/decks.plist`;
macOS also needs `__HOME__`. Report issues with a reproduction and checks run.
