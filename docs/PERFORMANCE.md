# Performance measurements and tradeoffs

These measurements were recorded during development of this fork on the provided
Linux VM. They describe the tested workloads and commits, not every installation.
No new benchmark run is implied by a documentation or branding update.

[User guide](../README.md) · [Development and API](DEVELOPMENT.md)

## Scope

This fork combines a persistent headless-browser worker, incremental network saves,
virtual slide wrappers and lists, and on-demand slide data. The earlier measurements
below document each step; they are not multiplicative claims about the entire app.

### On-demand slide libraries

Newly generated engines support serving large data-only `LIBRARY` declarations and
`Object.assign(LIBRARY, ...)` blocks as a metadata index plus content-addressed JSON
chunks of 64 definitions. Blocks under 256 entries and blocks containing functions,
references or other unsupported JavaScript expressions remain embedded. The first
chunk and copyable basic layouts stay available immediately; later bodies, tables,
pictures and notes load when navigation or a visible thumbnail needs them. Metadata
still grows with library size, so startup is not constant-time.

The server derives these resources without executing deck code or changing the deck
file. Its cache holds eight files, checks nanosecond timestamps/inodes/sizes, and drops
old revisions. Chunk requests use SHA-256 URLs; an unavailable revision returns 409.
Requests share in-flight work, use at most six concurrent fetches, and retry after
failures. Late requests, stale Scroll timers and rapid keyboard steps preserve the
latest requested selection. Gzip reduces large HTML/JSON transfer sizes.

Whole-deck operations wait for their definitions. App printing awaits data, fonts and
images; native browser-menu printing has a synchronous `beforeprint` fallback because
that event cannot await a promise. Editable copies fetch and bundle the complete
original source, including edits, for offline use. Raw/readonly exports remain eager.
Existing files retain their embedded engine; newly generated files receive this loader.

Agent integrations should `await SlideBuilder.go(id)`, `await SlideBuilder.setView('checks')`,
`await DeckRenderer.all()`, `await SBGuides.scan()` and `await SlideBuilder.clientCopy()`.
These work with both immediate and asynchronous results. For a cold preview or direct
mount, first `await DeckData.load([id])`, then call `DeckRenderer.preview(id)` or
`DeckRenderer.ensure(id)`. The logical-order and offscreen-comment APIs still work
without loading a body. `?library=0` disables data splitting; `SB_SPLIT_LIBRARY=0`
disables it for a scratch server, and `SB_GZIP=0` disables compression.

Five interleaved trials against `7543103`, using matching mixed-layout fixtures,
fresh browser contexts, 1600×1000 viewports and equal external-font blocking on the
provided Linux VM (24 logical CPUs, 61 GiB RAM). Startup fixtures have no saved edits;
the edit/save exercise runs afterward. The table has a warm server transform
cache and cold browser HTTP caches. Startup ends at `sb-ready` plus two frames;
browser/server process launch is excluded. Navigation measurements now await the
actual target body and assert that it is displayed.

| Slides | Startup before → after | HTML body transferred | Decoded HTML |
|---:|---:|---:|---:|
| 1,000 | 227 → 208 ms | 758 → 109 kB | 0.76 → 0.50 MB |
| 5,000 | 318 → 254 ms | 2488 → 141 kB | 2.49 → 1.08 MB |
| 10,000 | 455 → 276 ms | 4652 → 177 kB | 4.65 → 1.82 MB |

At 10,000 slides this is **1.65× faster startup** and
**96.2% fewer HTML transfer bytes**.
Complete definitions at startup fall from 10,077 to 141
(the latter includes starter/basic layouts). The first distant jump costs
4.9 → 14.3 ms, including its cold data fetch;
repeat navigation reuses the loaded group. DOM remains bounded at two startup wrappers.

**Cold cache cost matters.** Invalidating the server transform cache before each open
measured 416 → 401 ms at 10,000 slides,
and 285 → 228 ms at 1,000 slides. Small cold opens
can be slower; cache construction is not hidden in the warm figures. Under 4× browser
CPU throttling, 10,000-slide startup measured 1694 → 940 ms.
A separate 15-trial small-deck check measured blank: 199 → 206 ms; workshop: 225 → 226 ms.
Absolute timings vary across VM passes; compare paired figures from the same pass.
These results do not establish 100× overall application performance.

### Rust assessment

No Rust rewrite is included. The separate 10,000-slide sample reduced source compile
time from 63.5 to 11.0 ms by removing work.
Warm scripting in the timed run takes about 54 ms of 276 ms total;
even making all of it free would only imply roughly 1.24× in that simplified model.
That is an inference, not a measured Rust speedup. Browser layout and PDF rendering
would still run in Chromium. WebAssembly calls browser APIs through JavaScript/bindings,
as described by [MDN](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Concepts)
and the [wasm-bindgen guide](https://wasm-bindgen.github.io/wasm-bindgen/web-sys/index.html).

Cold index construction is the plausible native-code candidate, but it is paid once
per changed/evicted file or server restart. Parsing, JSON encoding and hashing
already use native standard-library routines. A persisted generated index/chunk cache is the next
lower-complexity experiment. Large imports or geometry batches would need their own
profile before adding a Rust boundary. Complete title/order metadata and populated
saved-state bootstrap data remain further measurement targets. The current evidence
supports reducing data and DOM work rather than rewriting the UI language.

### Reproduce and validate

Generate disposable fixtures in both the baseline and current checkouts with
`BENCH_SIZES=100,500,1000,5000,10000 python3 tests/prepare-performance.py /tmp/decks-perf`.
Start separate scratch servers with different ports and `SB_DECKS_DIR` values. Set
`SB_URL`, `BASELINE_URL` and `SB_CHROME` for:

```sh
node tests/benchmark-library.mjs
BENCH_FIXTURES=1000,10000 CPU_RATE=4 node tests/benchmark-library.mjs
node tests/benchmark-library-cold.mjs
BENCH_FIXTURES=blank,workshop BENCH_TRIALS=15 node tests/benchmark-library.mjs
PROFILE_SLUG=bench-large-10000 node tests/profile-startup.mjs
python3 -m unittest discover -s tests
node --test --test-concurrency=1 tests/browser.test.mjs tests/lazy.test.mjs tests/lists.test.mjs tests/wrappers.test.mjs tests/library.test.mjs
node tests/stress-wrappers.mjs
```

The cold-cache script touches fixture files and must run on the machine hosting the
scratch servers. Tests clear fixture state. Keep functional stress, profiling and
export checks separate from timed runs. Historical synchronous-navigation benchmark
scripts should use `SB_SPLIT_LIBRARY=0`; the library benchmark awaits cold navigation.

Validation: 64 distinct automated tests, focused Scroll-race rechecks, eight parallel
10,000-slide viewport/CPU scenarios, five template audit/export runs, 52 matching
PDF pages, identical text for the 100-slide PDF with three raster spot checks, eight
matching viewport frames, and a real 1,000-page live print containing an edited final
slide and returning to seven wrappers. Consulting's existing `sample-2x2` text-size
advisory remains. The new tests also cover offline editable copies, retry behavior,
stale chunks, request ordering, rapid keys, default notes and gzip negotiation.

Raw samples, source hashes and validation are in
[`library-linux.json`](../tests/benchmarks/library-linux.json), and diagnostic CPU samples
are in [`library-profile-linux.json`](../tests/benchmarks/library-profile-linux.json).

### Earlier iterations
<!-- library-performance:end -->

Regression checks: `python3 -m unittest discover -s tests` tests state merges and library extraction/cache behavior.
With a scratch server and `Bench blank`, `Bench talk`, and `Bench workshop` decks, run
`SB_URL=http://127.0.0.1:8799 SB_CHROME=/path/to/chrome node --test tests/browser.test.mjs`.
The browser tests clear the blank scratch deck's saved state and need Poppler's `pdftotext`. `tests/benchmark.mjs`
compares real CLI jobs and save requests against an unmodified checkout; its header
lists the required environment variables.

For large-deck tests, `python3 tests/prepare-performance.py /tmp/decks-perf` creates
disposable standard templates and mixed-layout 100/500/1000-slide fixtures. Start the
server with that `SB_DECKS_DIR`, then run `node --test tests/lazy.test.mjs` with `SB_URL`
and `SB_CHROME`. These tests clear the 500-slide fixture's saved state. To benchmark,
run `node tests/benchmark-lazy.mjs` with `BASELINE_URL` pointing at the previous version's
matching fixtures. External font requests are blocked equally during that benchmark
to isolate rendering work; startup and navigation samples are recorded separately.

For the 1,000-slide mixed-layout fixture, five-run medians against the prior worker /
incremental-save version were:

| Operation | Before | Lazy rendering |
|---|---:|---:|
| Page ready | 2,275 ms | 694 ms |
| Engine render and restore | 1,434 ms | 174 ms |
| First save-state collection + JSON | 228.4 ms | 2.1 ms |
| Warm save-state collection + JSON | 5.4 ms | 0.9 ms |
| Main-deck bodies at startup | 1,000 | 2 |

The first-save result has cold default hashes in the baseline; it is not a claim of
100x overall application speed. Navigation remained similar in that step. Save
collection excludes debounce, network and disk time. Raw samples and source hashes are in
[`tests/benchmarks/lazy-linux.json`](../tests/benchmarks/lazy-linux.json).


The next iteration profiles and windows the lists. Generate matching fixtures from
both checkouts and run `node tests/benchmark-lists.mjs` with `BASELINE_URL`, `SB_URL`,
and `SB_CHROME`. Set `ORIGINAL_URL` to include an unmodified upstream checkout.
The benchmark reverses run order on alternate trials, uses fresh contexts in an
existing Chrome process, and blocks Google font CSS equally. It excludes browser
launch and server startup. `node tests/profile-startup.mjs` captures a separate CPU
profile; `node --test tests/lists.test.mjs` exercises the virtual lists and clears the
1,000-slide scratch fixture's saved state.

Five-run medians against `1a31d1a` (the previous lazy-slide version), at 1,000 slides:

| Operation | Previous fork | Windowed lists |
|---|---:|---:|
| Page ready + two frames | 619 ms | 301 ms |
| Engine render and restore | 161.3 ms | 55.6 ms |
| Synchronous navigation | 17.0 ms | 7.5 ms |
| Navigation + two frames | 33.5 ms | 33.3 ms |
| Layout work during startup | 169.2 ms | 57.2 ms |
| DOM elements at startup | 33,059 | 9,669 |
| Filmstrip rows at startup | 1,000 | 8 |

Startup improves another **2.06x**, and **6.45x** against fresh runs of upstream
`8a5179b` (1,942 ms). At 500 slides the previous fork's 429 ms becomes 256 ms;
at 100 slides, 256 ms becomes 223 ms. Small decks remain roughly unchanged
(blank: 200 to 206 ms; workshop: 240 to 226 ms). The two-frame navigation measure
remains near the display's frame cadence, even though synchronous work drops.
These results do not establish 100x overall performance.

That iteration left 9,099 elements inside the main deck. Wrapper/comment
construction, slide numbering, initial layout, and loading/parsing the full embedded
library remain costs that grow with deck size. The visible lists were bounded; main-deck wrappers still scaled with the deck.
Raw samples, source hashes and validation are in
[`lists-linux.json`](../tests/benchmarks/lists-linux.json); sampled function costs are in
[`lists-profile-linux.json`](../tests/benchmarks/lists-profile-linux.json).


The wrapper iteration moves the full logical order, edited fields, and feedback into
a model independent of mounted DOM. Focus keeps the current wrapper and neighbors;
Scroll keeps a viewport window, using estimated heights corrected by observed sizes.
Prefix sums provide logarithmic offset lookup and updates, and height corrections
preserve the visible anchor. Numbering touches only mounted wrappers; indexes rebuild on structural or width
changes rather than on every navigation. Review counts scan metadata once, and layout
avoids resetting widths or rewriting unchanged transforms on every navigation.

`SlideBuilder.slides()` and `__DECK_STATE()` still return the complete deck.
Use `SlideBuilder.comment(id)` to read a comment and `SlideBuilder.comment(id, text)`
to update one, including an unmounted slide. `DeckRenderer.ids()` returns a read-only
logical order; querying `#deck` sees only mounted wrappers. `?wrappers=0` retains the
previous body-only lazy mode for diagnosis. Raw/readonly exports and standalone
copies remain eager. Existing files retain their embedded engine; these changes
apply to newly generated files. Sorter cards and whole-deck checks/exports still do
work proportional to deck size; leaving bulk views releases their extra DOM.

Five-run medians against `0d14a67`, with matching mixed-layout fixtures:

| Slides | Startup before → after | Navigation JS before → after | Enter Scroll before → after |
|---:|---:|---:|---:|
| 1,000 | 320 → 242 ms | 9.2 → 4.4 ms | 107 → 35 ms |
| 5,000 | 759 → 374 ms | 27.5 → 5.1 ms | 532 → 35 ms |
| 10,000 | 2,007 → 705 ms | 77.3 → 6.4 ms | 1,601 → 34 ms |

At 10,000 slides, startup improves **2.85x**, synchronous navigation **12.1x**,
and entering Scroll **46.9x**. Settled main-deck scroll jumps fall from 391 to 33 ms.
Startup DOM elements fall from 90,669 to 687; mounted wrappers fall from 10,000 to 2
at startup and stay at seven in these scroll samples. Serialized state sizes match.
These are specific operations, not a claim of 100x overall application performance.

Small-deck timings varied in the first five-run sweep. A separate 15-run follow-up
measured blank startup at 212 → 217 ms and workshop at 230 → 235 ms, roughly unchanged.
With equal 4x CPU throttling at 1,000 slides, startup is 872 → 620 ms and entering
Scroll is 363 → 55 ms. Both versions use fresh contexts, equally blocked Google font
CSS, reversed run order on alternate trials, and an already running browser/server.
Engine initialization timing excludes useful layout deferred to the shell; total
startup and browser layout metrics are recorded separately.

The final 10,000-slide profile removes the large wrapper-construction/numbering
costs. Full-library transfer and compilation, initial shell/layout work, and metadata
scans remain. The sampled source compile time was about 58 ms in both versions;
wrappers do not make loading the full embedded library constant-time.

Reproduce with this version's `tests/prepare-performance.py` in both checkouts (copy
only that fixture helper into the baseline checkout), using
`BENCH_SIZES=100,500,1000,5000,10000`. Start separate scratch servers, then run
`node tests/benchmark-wrappers.mjs` with `BASELINE_URL`, `SB_URL`, and `SB_CHROME`.
`BENCH_FIXTURES=1000 CPU_RATE=4` runs the throttled case. Run the browser suites with
`node --test --test-concurrency=1 tests/browser.test.mjs tests/lazy.test.mjs tests/lists.test.mjs tests/wrappers.test.mjs`;
they clear disposable fixture state and need Poppler. Separately run
`node tests/stress-wrappers.mjs` for eight parallel viewport/CPU scenarios, and
`PROFILE_SLUG=bench-large-10000 node tests/profile-startup.mjs` for diagnostic samples.

Validation includes 41 automated tests, eight parallel 10,000-slide scenarios across
four viewports and normal/4x CPU throttling, all five template audit/export runs,
52 matching template PDF pages, eight matching focus frames across resizes, and a
real 1,000-page print from virtual Scroll with an edited final slide. A print-only
banner padding bug found by that check is fixed; printing then releases the bulk DOM.
Raw samples, hashes, follow-up runs and validation are in
[`wrappers-linux.json`](../tests/benchmarks/wrappers-linux.json); sampled function costs
are in [`wrappers-profile-linux.json`](../tests/benchmarks/wrappers-profile-linux.json).

