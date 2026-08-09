# Changelog

All notable changes to `@zakkster/lite-cellular` are documented here.
The format follows Keep a Changelog; this package adheres to SemVer.

## [1.0.0] - 2026-08-08

The honest core (session C1): the three distance metrics, the module free-function
surface, and the NS-01 isolation gate that is the reason this package's torture
matters. The euclidean field is BYTE-UNCHANGED from 0.1.0 -- the golden digest is
still `33a16e9e` -- so a caller already on the euclidean skeleton upgrades with no
numeric change.

### Added
- **`METRIC_MANHATTAN` (1) and `METRIC_CHEBYSHEV` (2)** -- fixed at instance
  creation via an integer id, joining `METRIC_EUCLIDEAN` (0). The guard now accepts
  `0`/`1`/`2` and still throws on anything else (`3`, `-1`, `1.5`, `'euclidean'`,
  `null`, ...): it WIDENS the accepted set, never loosens (fail-closed). manhattan
  reports `|dx| + |dy|`, chebyshev `max(|dx|, |dy|)`, both in LINEAR units like
  euclidean's true distance, so the metric-sanity law `cheby <= euclid <= manhattan`
  and the caller's `f2 - f1` stay unit-coherent.
- **Three metric-specific kernels** (`_cellular2Euclid` / `_cellular2Manhattan` /
  `_cellular2Chebyshev`) with the metric param DROPPED and bound once at
  construction as `this._kernel` -- the per-query loop is monomorphic and
  branch-free, zero metric branch per neighbour (`grep -n 'metric'` finds it only
  in the constructor and the binding).
- **Module free-function surface**: a bare `cellular2(x, y, out?)` (euclidean,
  jitter 1, on a shared module seed) and `seedCellular(seed?)` (re-seeds the shared
  field; dev-warn-once on the 2nd call, silent when `NODE_ENV==='production'`) --
  the zero-config convenience, mirroring `@zakkster/lite-noise`'s shared-`_perm`
  free functions. Metric and jitter control remain instance-only, by design.
- **`goldens/manhattan.json` and `goldens/chebyshev.json`** -- seed-42 FNV-1a
  digests (`fa25dafd`, `5e5cbfa6`) over the same 64-coord corpus as the untouched
  `euclidean.json` (`33a16e9e`). The unit suite and torture T0 re-derive all three.
- **Torture tiers filled/widened**: T5 (the NS-01 instance/module isolation fuzz +
  reseed reproducibility + interleaved cross-contamination), T0 (metric-sanity law
  over f1 AND f2, per-metric jitter=0 grid distance, id-within-cell + metric-
  dependent owner, three goldens), T1 (degenerate values across three metrics), T3
  (world-scale precision walk, per metric, with a PINNED limit), T6 (zero-alloc gate
  across three metrics + the module surface), T7 (retention across three metrics),
  T9 (controls: in-loop string-metric branch, shared-seed isolation, escaping
  retained transient -- each proven able to fail). New break control
  `CELLULAR_TORTURE_SHARED_SEED=1` exits non-zero.
- **`test/bundle.test.js`** -- the byte ceiling (`CELLULAR_BYTE_CEILING`),
  zero-import/require, and ASCII-only checks, so growth past the ceiling is an
  intentional bump with a note, not silent drift.
- **`bench/bench.mjs` + `bench/BASELINE.md`** -- best-of-5 `measureOps` throughput
  and the `measureAllocs` `maxBytesPerCall: 0` contract per metric (not shipped in
  `files[]`).

### Changed
- **manhattan/chebyshev use branchless `Math.abs` / `Math.max`.** The zero-alloc
  gate is now the exact `measureAllocs` `maxBytesPerCall: 0` (retained bytes) plus
  `maxArrayBuffersGrowth: 0` -- the design records' `bytesPerOp: 0` shorthand is not
  a real profiler rule (a rate has a self-noise floor and cannot read 0). While
  closing decision 0001's Measured table this exposed that a data-dependent abs
  ternary ran ~2x slower than the branchless intrinsics on scattered coords; the
  switch is digest-identical (`dx` is never `-0`), so all three goldens re-derive
  unchanged.
- `VERSION` -> `1.0.0` (in lockstep with `package.json` and `llms.txt`).
- Decision records 0001-0004 closed (`Status: accepted, 2026-08-08`) with their
  Measured tables filled from the built kernel.

### Planned
- **v1.1.0 (C2):** `fillCellField2` (zero-alloc field bake, `combo` resolved once
  before the loop) and `tileableCell2` (exact seam wrap).
- **v1.2.0 (C3):** `cellular3` / `fillCellField3` -- the 3x3x3 = 27-cell loop.

## [0.1.0] - 2026-08-06

The greenfield scaffold (session C0): the package plumbing, the one torture
command every later session leans on, and the barest honest kernel -- euclidean
F1/F2, one metric, instance-only -- so the metamorphic-law tier has something to
bite. Everything later extends this command.

### Added
- **`createCellular(seed, opts?)` / `class Cellular`** -- an isolated cellular
  (Worley) noise instance. `opts.metric` accepts only `METRIC_EUCLIDEAN` (0) in
  v0.1.0 (any other id throws -- fail-closed; the guard widens in v1.0.0, it never
  loosens); `opts.jitter` defaults to `1` and must be a finite number in `[0, 1]`
  or throws. Both are validated once at construction and immutable thereafter.
- **`cellular2(x, y, out?)`** -- the euclidean kernel: a fixed 3x3 neighbourhood
  scan returning `{ f1, f2, id }` written into a caller-owned out-struct (or the
  instance's reused struct when `out` is omitted). Zero allocation on the query
  path; non-finite coords throw at the door. Squared distance accumulates in the
  loop, with one sqrt for `f1` and one for `f2` at the end -- true euclidean
  distance. `id` is the F1 owner cell's hash coerced with `| 0` (signed int32,
  SMI-safe), a stable opaque per-region tag. `reseed(seed)` changes the seed only.
- **`VERSION`** and **`METRIC_EUCLIDEAN`** named exports; hand-written
  `Cellular.d.ts`.
- **Torture suite** (`test/torture.mjs` + `test/torture/*`): the single command
  `node --expose-gc test/torture.mjs` prints exactly `ok`. Tiers wired now: T0
  (determinism, range `f1 <= f2 >= 0`, jitter=0 grid-distance, id-within-cell, and
  the euclidean golden), T6 (the zero-alloc gate, `maxMajor:0` /
  `maxArrayBuffersGrowth:0` / `stabilize:'deep'`), T7 (dropped-instance retention
  via `@zakkster/lite-leak` with a positive control), T9 (controls -- every gate
  proven able to fail; `CELLULAR_TORTURE_BREAK=1` makes the run exit non-zero). T1
  and T5 are registered as reserved no-op tiers for C1 to fill.
- **`goldens/euclidean.json`** + `goldens/gen.mjs` -- a seed-42 FNV-1a digest over
  a fixed 64-coord corpus; the unit suite and T0 both re-derive and compare.
  Regenerating is intentional (`node goldens/gen.mjs`) and a breaking change.

### Planned
- **v1.1.0 (C2):** `fillCellField2` (zero-alloc field bake, `combo` resolved once
  before the loop) and `tileableCell2` (exact seam wrap); composability recipes
  with `@zakkster/lite-noise` and `@zakkster/lite-gradient-studio`.
- **v1.2.0 (C3):** `cellular3` / `fillCellField3` -- the 3x3x3 = 27-cell loop on
  the same zero-alloc bar.

[1.0.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v1.0.0
[0.1.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v0.1.0
