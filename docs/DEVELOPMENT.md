# Development and API

Decks Performance Fork is maintained in [delirious6423/decks](https://github.com/delirious6423/decks).
The original project is [paulmil11/decks](https://github.com/paulmil11/decks).

Keep `server.py` and `sb` on the Python standard library. Headless jobs use the
existing `playwright-core` dependency. Read [AGENTS.md](../AGENTS.md) for the local
workflow and the [performance notes](PERFORMANCE.md) for benchmark methodology.

## How it works

| File | What it does |
|---|---|
| `server.py` | Serves the dashboard and the decks, saves state, and runs the JSON API `sb` uses (Python standard library only) |
| `sbconfig.py` | Port, address, and decks folder, from `config.json` and `SB_*` variables |
| `sb` | The agent's command line |
| `newdeck.py` | Themes, templates, and new decks (used by the server and `sb new`) |
| `library.py` | Safe data-literal extraction, chunk generation and bounded serving cache |
| `templates/` | `_engine/engine.html` (the deck engine), `_engine/basics.js`, and one folder per template |
| `static/` | The browser shell: `boot.js`, `shell.js`, `shell.css`, `library.js` (embedded in new engines), `guides.js`, `addslide.js`, `pictures.js`, `clientcopy.js`, and `dashboard.html` |
| `tools/browser.mjs` | CLI and private local worker for headless Chrome jobs |
| `tools/browser-jobs.mjs` | Titles, edits, shots, audit, PDF, and thumbnail jobs, with a fresh browser context per job |
| `tools/pptx2native.py` | Converts PowerPoint slides into editable native slides (how the consulting starter was made) |

When the server serves a deck page, it adds a small boot script that loads the deck's
saved state and mirrors later saves back to disk, then removes its own tags before the
deck runs. The deck file itself never changes, so a saved copy is still a clean file.
`?raw=1` serves the file without the shell around it. (In a browser that has edited the
deck, it still shows those saved edits.)

Headless commands start a private worker automatically and reuse its Chrome process.
Jobs are serialized and get fresh browser contexts, keeping saved edits separate from
raw exports. Export checks, PDF generation, and the dashboard thumbnail run in one job.
The worker closes Chrome after two idle minutes; `SB_BROWSER_IDLE_MS` changes that
timeout. `node tools/browser.mjs worker-status` reports its state and `worker-stop`
closes it. `SB_BROWSER_WORKER=0` runs without the worker for diagnostics.

Jobs wait for page load, fonts, image decoding, and two animation frames instead of
fixed sleeps. A deck with asynchronous chart work can publish a promise as
`window.__DECK_READY`; readiness has a 30-second timeout.

New decks cache unchanged editable fields and default hashes while saving. Existing
deck files keep their embedded engine; they still get smaller network saves through
the shared boot script. Saves send changed object leaves (slide fields, individual
comments, or the order), and the server merges them into the existing `state.json`
format. Full localStorage snapshots and pending-save backups remain available for
offline recovery and portable copies. Local snapshots and disk writes still serialize
the complete saved state; this is not a new incremental database format.

Interactive decks with at least 80 slides render slide bodies on demand. Focus keeps
the current slide and its neighbors; Scroll renders near the viewport and releases
distant bodies. Thumbnail bodies are released when they leave the thumbnail viewport.
The logical model retains order and comments while wrappers are unmounted, and edited fields survive eviction,
undo, version switches, and reload. Untouched slide defaults need no saved field copy.
Whole-deck checks, printing, client copies, and headless raw/saved exports still render
all required slides. Add `?lazy=0` to compare with eager rendering. Existing deck files
keep their embedded engine; newly generated decks get this behavior.

Large filmstrips and excluded-slide shelves mount just their visible rows plus a small
buffer. Keyboard focus, drag reorder, filters, and distant slide jumps use the full
logical order. Large interactive decks skip the hidden legacy sidebar and use the
same library selection model for the filmstrip, sorter, and Add slide picker. Empty
review controls and insertion buttons are created where needed, and the first layout
waits for the shell's view classes. `?lists=0` disables list windowing for diagnosis;
`?lazy=0&lists=0` also restores eager slide bodies.

Saved next to each deck, in `.slidebuilder/`:

- `state.json`: the reviewer's edits, comments, and slide order, mirrored from the page.
- `review.json`: the agent's replies, rounds, history, and "changed" badges, written
  through `sb`.

**Hide client work** (dashboard) is for recording or screen sharing. Mark a deck
`"client": true` in `decks.json`, or list client versions in `"clientVersions"`. With
the switch on, the server leaves them out of everything it serves.

API (what `sb` uses):

- `GET /api/decks`, `GET /api/decks/<slug>`: summaries.
- `GET /api/decks/<slug>/comments`: open comments, with the agent's reply if there is one.
- `GET|PUT /api/decks/<slug>/state`: the deck's saved browser state.
- `GET /api/decks/<slug>/review`, `POST /api/decks/<slug>/review`: replies, live status,
  and rounds. The agent posts `{op: 'reply' | 'claude' | 'round'}`; the page posts
  `{op: 'comment-state' | 'resolve' | 'reopen' | 'seen'}`.
- `GET /api/decks/<slug>/pulse`: modified times, polled by the page for live updates.
- `GET /api/templates`, `POST /api/new-deck`: templates and new decks.
- `POST /api/decks/<slug>/manage`: `{op: 'hide' | 'show' | 'delete'}`.
- `POST /api/decks/<slug>/bundle`: a copy of the deck with its pictures and scripts embedded.
- `POST /api/decks/<slug>/upload`: a picture for a slide, saved in the deck's `img/uploads/`.

## Compatibility identifiers

The UI uses “Ask agent” and “Agent” for any coding agent. Existing JSON still uses
`claude` for live status and `{op: 'claude'}` to update it. DOM IDs such as
`sb-claude` are also retained. These are compatibility identifiers, not a requirement
to use Claude. Do not rename persisted keys as a wording cleanup.

The `decks` skill, `sb` command, `SB_*` variables, `decks.json`, `.slidebuilder/`,
default `~/slide-decks` directory, and optional service names retain their existing
names. New decks get the current embedded engine. Existing deck files keep their
own engine and content, while the server supplies the updated app shell.

## Validation on disposable fixtures

Do not point these tests at a folder containing work you want to keep. Fixture
creation rewrites fixture decks, and browser tests clear their saved state.

```bash
python3 -m unittest discover -s tests
BENCH_SIZES=100,500,1000,10000 python3 tests/prepare-performance.py /tmp/decks-fork-test
SB_PORT=8799 SB_DECKS_DIR=/tmp/decks-fork-test SB_CHECK_UPDATES=0 python3 server.py
```

In another terminal, from the same checkout:

```bash
export SB_URL=http://127.0.0.1:8799
export SB_DECKS_DIR=/tmp/decks-fork-test
export SB_CHROME=/path/to/chrome
node --test --test-concurrency=1 tests/browser.test.mjs tests/lazy.test.mjs tests/lists.test.mjs tests/wrappers.test.mjs tests/library.test.mjs
for template in blank talk workshop proposal consulting; do
  ./sb audit "bench-$template"
  ./sb export "bench-$template"
done
```

Browser integration tests need Poppler (`pdftotext`) for PDF assertions. Choose an
unused port and a new scratch directory for concurrent runs. For benchmark commands,
reference commits, raw samples and limits, see [PERFORMANCE.md](PERFORMANCE.md).

## Changes and contributions

File fork issues and proposed changes in [this repository](https://github.com/delirious6423/decks/issues).
Include a reproduction, expected behavior and relevant validation. Performance
changes should include paired measurements with the same fixtures and environment.
Keep upstream copyright notices and template attribution. Changes intended for the
original project should follow its own contribution policy.
