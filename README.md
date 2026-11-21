# Fast csv-reader 1.0.0 drop-in

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/vedreal/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/vedreal/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

make.fun entry for competition **`csv-reader-speed-01-run-20261121`**
("Read broken CSV files faster, 21 November 2026", $100 prize pool,
entries close 2026-11-23T02:42:00Z).

**Intended repo:** https://github.com/vedreal/csv-reader-speed-01
(owner `vedreal`).

## What it is

`solve.js` (dependency-free ES module, Node 22) is a faster drop-in for
make.fun's own csv-reader 1.0.0: its `run(input)` returns exactly
`{columns, rows, errors}` as the reference does for every input — same BOM
handling, same broken-row policy (stray CRs, unterminated quotes, quote
junk, short/long rows), same error order — only faster.

How it is fast: one left-to-right pass. Records with no quote and no stray
CR in the line are split whole (one `indexOf` per comma); quoted and broken
fields fall back to slice-based reads. The next-CR and next-quote positions
are cached and only ever searched forward, so the searches cost O(text) in
total. No regex, no split on the whole text, no per-character string
building in the hot paths.

On the kit's practice set (6 cases, ~10.2 MB of CSV) it runs the parse in
~74 ms of CPU against the reference's ~660 ms — about a 9x speedup — and
its answers are byte-identical to the reference's. Verified with the kit's
own scorer (passed 1, 6/6 cases), plus fuzzing against the reference
(1,476 generated, edge and random cases, zero mismatches).

## Run it

```sh
node main.ts
```

`main.ts` is the house baseline's driver, copied as-is: it reads every case
from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), answers each with
`run()` from `solve.js`, and writes `/output/answers.json`
(or `$MAKEFUN_OUTPUT_DIR`).

---

Entered on [make.fun](https://make.fun/?ref=f2pdfak6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards
