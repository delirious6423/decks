# Benchmarks

Historical Linux VM results: 24 logical CPUs, 61 GiB RAM. These are operation-specific
measurements, not a whole-app speedup or a benchmark of the latest upstream merge.

## Slide-data loading

Five interleaved trials against `7543103`; medians, matching fixtures, fresh browser
contexts, 1600×1000 viewport, equal font blocking. Server transform cache is warm;
browser HTTP caches are cold. Startup ends at `sb-ready` + two frames; process launch
is excluded. Navigation waits for the target body.

| Slides | Startup, before → after | HTML transferred | Decoded HTML |
|---:|---:|---:|---:|
| 1,000 | 227 → 208 ms | 758 → 109 kB | 0.76 → 0.50 MB |
| 5,000 | 318 → 254 ms | 2,488 → 141 kB | 2.49 → 1.08 MB |
| 10,000 | 455 → 276 ms | 4,652 → 177 kB | 4.65 → 1.82 MB |

At 10,000 slides: startup is 1.65× faster; transfer is 96.2% smaller. The first distant
jump is slower (4.9 → 14.3 ms) because it fetches data. Cold server-cache startup:
416 → 401 ms. Separate 15-trial checks: blank 199 → 206 ms; workshop 225 → 226 ms.
Metadata, saved-state serialization, Sorter, and whole-deck exports still grow with size.

## Earlier steps

Each row compares a separate implementation step; gains must not be multiplied.
Five-run medians; fresh contexts and equal font blocking; browser/server launch excluded.

| Change | Baseline | Slides | Startup | Other result |
|---|---|---:|---:|---|
| Lazy bodies | `98ee6e2` | 1,000 | 2,275 → 694 ms | First save collection + JSON: 228.4 → 2.1 ms; excludes debounce, network, disk |
| Windowed lists | `1a31d1a` | 1,000 | 619 → 301 ms | Startup DOM: 33,059 → 9,669 elements |
| Virtual wrappers | `0d14a67` | 10,000 | 2,007 → 705 ms | Navigation JS: 77.3 → 6.4 ms; enter Scroll: 1,601 → 34 ms |

Raw samples and source hashes: [libraries](../tests/benchmarks/library-linux.json),
[lazy bodies](../tests/benchmarks/lazy-linux.json), [lists](../tests/benchmarks/lists-linux.json),
[wrappers](../tests/benchmarks/wrappers-linux.json). Matching `*-profile-linux.json`
files in [benchmarks](../tests/benchmarks/) contain diagnostic CPU samples.
No Rust rewrite is included; browser layout and PDF rendering remain in Chromium.

## Reproduce

Use [scratch-server setup and tests](DEVELOPMENT.md#tests) in both checkouts, with
separate ports/directories and matching fixtures; add `5000` to `BENCH_SIZES`.
Set `BASELINE_URL`, `SB_URL`, and `SB_CHROME`, then run from the current checkout:

```bash
node tests/benchmark-library.mjs
node tests/benchmark-library-cold.mjs
BENCH_FIXTURES=1000,10000 CPU_RATE=4 node tests/benchmark-library.mjs
```

The cold-cache script touches fixture files: run on the servers' machine. Optional:
`BENCH_TRIALS=15 BENCH_FIXTURES=blank,workshop` for small-deck checks; `BENCH_OUT` for output.
Earlier steps use `benchmark-lazy.mjs`, `benchmark-lists.mjs`, or `benchmark-wrappers.mjs`
against the baselines above, with `SB_SPLIT_LIBRARY=0` on both servers.
`benchmark.mjs` additionally needs `BASELINE_DIR`. Run profiles (`profile-startup.mjs`),
stress (`stress-wrappers.mjs`), and export checks separately from timing.
