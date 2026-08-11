# Changelog

All notable changes to `@zakkster/lite-cellular` are documented here.
The format follows Keep a Changelog; this package adheres to SemVer.

## [1.3.0] - 2026-08-10

Exact per-metric neighbourhood + exhaustive hardening + the live demo (session C4).

### Changed -- BEHAVIOUR (the headline; `decisions/0008`)

- The fixed neighbourhood is now EXACT per metric. C4's own sufficiency oracle
  uncovered that the 3x3 / 3x3x3 scan is NOT sufficient for euclidean or manhattan --
  an L1/L2 ball can reach a feature point two cells away, so the true nearest was
  rarely missed (measured miss-rate vs a wide brute-force oracle at jitter 1:
  euclid ~2e-6, manhattan ~2e-4 and up to ~0.43 cell off). Only chebyshev (L-inf) was
  ever sufficient at radius 1.
- FIX: the eight euclidean/manhattan kernels (2D + 3D, plain + tileable) widen from a
  radius-1 loop to radius 2 -- 9 -> 25 cells (2D), 27 -> 125 (3D). This is PROVEN
  exact: scan radius 2 == radius 3 == radius 4 bit-for-bit over millions of ops, so
  the true nearest never sits farther than two cells for L1/L2 under `jitter <= 1`.
  The miss-rate goes to 0. The four chebyshev kernels are BYTE-UNCHANGED (radius 1 is
  already exact); their two goldens (`5e5cbfa6`, `1682d095`) re-derive byte-identical.
- COST: euclid/manhattan queries and bakes are ~2.78x (2D) / ~4.63x (3D) slower by
  cell count; chebyshev is unchanged; every path is still zero-allocation. See
  `bench/BASELINE.md`.
- MINOR, not patch: the euclid/manhattan kernels change behaviour in the rare cases.
  The four euclid/manhattan golden digests re-derive from the widened kernel (their
  committed values are unchanged only because the sample COORDS miss the rare cases --
  the goldens pin the common case, the new T-ORACLE tier proves the rare one).

### Fixed -- docs

- Corrected the "the fixed 3x3 neighbourhood is guaranteed to contain the true f1/f2"
  overclaim in the README, `llms.txt`, `Cellular.d.ts`, and decisions 0001/0002/0003/
  0007 (each now points to 0008). The accurate statement is per metric: chebyshev
  exact in 3x3 / 3x3x3, euclid/manhattan in 5x5 / 5x5x5. The tileable exact-`===`
  periodicity claim (0006) is a different property and is unchanged.

### Added -- hardening, benchmark, demo (no API)

- `test/torture/t-matrix.mjs` -- the full metric x combo x surface x dim cross-product
  edge-case matrix; every cell a decided outcome (throw / documented value / limit).
- `test/torture/t-oracle.mjs` -- the sufficiency proof: the shipped kernel equals a
  radius-3 brute-force scan bit-for-bit over 100k+ ops, all metrics, jitter swept
  `[0,1]`. The `CELLULAR_TORTURE_BREAK_PRECISION` control narrows the kernel back to
  radius 1 and must make it fail.
- T3 world-scale precision limit pinned + documented; T7 soak extended to 65536
  build/drop cycles (heap flat across cycles, no retained instance); four new T9
  break controls, each exits non-zero.
- `bench/BASELINE.md` -- best-of-5 across the whole surface, `bytesPerOp: 0` on every
  steady-state probe; the decision Measured tables backfilled.
- `demo/cellular-lab.html` -- a live, zero-allocation-per-frame showcase (metric,
  combo, jitter, seed, exact 3x3 tiling, animated 3D slice). Repo-only, NOT in the
  published tarball (`files[]` unchanged; `npm pack` still 7 files).

## [1.2.0] - 2026-08-09

The 3D lift (session C3): the whole 2D texture surface carried into three dimensions
over the 3x3x3 = 27-cell neighbourhood -- a verbatim lift of decisions 0001..0006, no
new design (`decisions/0007` closed). The entire 2D surface is BYTE-UNCHANGED: all
three 2D goldens re-derive (`33a16e9e` / `fa25dafd` / `5e5cbfa6`), and no 3D code
leaked into the per-query 2D hot loop.

### Added
- **`cellular3(x, y, z, out?) -> {f1,f2,id}`** (instance method) -- the 27-cell scan;
  the 2D `{f1,f2,id}` shape plus depth, in this instance's metric. A verbatim lift of
  `cellular2` (`decisions/0007`), ~3x the per-query cost by cell count, same zero-alloc
  shape. Throws on non-finite `x`, `y`, or `z`.
- **`fillCellField3(dst, w, h, d, opts?) -> dst`** (instance method) -- bake a `w*h*d`
  VOLUME into a caller-owned `Float64Array`/`Float32Array`, row-major with z outermost
  (`idx = (z*h + y)*w + x`), ALLOCATION-FREE. Combo decoded to a small int ONCE, metric
  bound once, one reused scratch struct, `opts?.k ?? default` (no `opts = {}`), opt-in
  in-place `normalize`. Fail closed: non-positive-integer `w`/`h`/`d`, an undersized or
  non-typed-array `dst`, and an unknown `combo` each throw. `oz` joins `ox`/`oy`.
- **`tileableCell3(x, y, z, periodX, periodY, periodZ, out?) -> {f1,f2,id}`** (instance
  method) -- `cellular3` with each neighbour's INTEGER cell coordinate reduced mod its
  period on ALL THREE axes, so the volume is EXACTLY periodic (`===`, not epsilon) and
  seamless by construction (`decisions/0006` lifted). All three periods are required
  positive integers (`0`, negatives, non-integers, `NaN`, `Infinity` throw). With
  `opts.periodX`/`periodY`/`periodZ` set, `fillCellField3` bakes a seamless tile.
- **Six 3D kernels** (`_cellular3Euclid` / `_Manhattan` / `_Chebyshev` + the three
  `_tileableCell3*`) plus `_hash3` / `_hash3b` / `_hash3c` (a third decorrelated draw
  `w` for the z placement, `decisions/0003`), fully inlined with the metric dropped and
  bound once as `this._kernel3` / `this._tileKernel3` -- twelve kernels across 2D+3D,
  NEVER a dimension-parameterised loop (`decisions/0007` Decision 3). The tiling kernels
  compute distance in the query cell's LOCAL frame so the `===` wrap is real, not
  epsilon. Instance-only: no module 3D surface, no 4D (`decisions/0007` Decision 4).
- **Three 3D goldens** `goldens/euclidean3.json` / `manhattan3.json` / `chebyshev3.json`
  -- seed-42 FNV-1a digests (`7bac7c6f` / `f1b621b5` / `1682d095`) over a fixed 64-coord
  3D corpus. The unit suite and torture T0 re-derive all three; the 2D goldens are
  unchanged.
- **Torture extended** (2D lanes untouched): T0 (3D determinism / range / metric-sanity
  for f1 AND f2 / jitter=0 nearest-3D-centre grid / id-within-3D-cell / exact tile
  periodicity on all three axes / 3D bake==per-query / three 3D goldens), T3 (the
  world-scale limit PER AXIS -- large `z` degenerates like large `x` -- extreme
  `periodZ`, `d=1` slab, large volume, fail-closed guards), T5 (3D instance isolation
  into NS-01, 3D bake reseed-reproducible + module-independent), T6 (`cellular3` /
  `tileableCell3` / `fillCellField3` plain + tiling each combo at
  `maxArrayBuffersGrowth: 0` with a `dst.buffer.byteLength` assert + the zero-retention
  lane), T7 (dropped instances that ran the 3D surfaces are collectable), T9 (the two
  new 3D controls proven able to fail). New break controls
  `CELLULAR_TORTURE_BREAK_ALLOC3=1` and `CELLULAR_TORTURE_BREAK_FLOATWRAP3=1` each exit
  non-zero.
- **`bench/bench.mjs`** extended with `cellular3` (per metric), `tileableCell3`, and
  `fillCellField3` (per combo, plain + tiling); `bench/BASELINE.md` updated. `cellular3`
  euclidean measures ~4.8 Mops/s against the 2D ~14.3 -- the 3.0x cell-count ratio the
  decision forecast. All 3D probes read `bytesPerCall: 0`.

### Changed
- `VERSION` -> `1.2.0` (in lockstep with `package.json` and `llms.txt`).
- **`CELLULAR_BYTE_CEILING` raised 33792 -> 61440** to seat the six 3D kernels, the
  three 3D hashes, and the three 3D methods with their doc comments (Cellular.js is
  ~54 KB). A deliberate bump, noted here.
- **`opts.jitter` override is now bounds-validated in BOTH bakers** (`fillCellField2`
  and `fillCellField3`) -- fail-closed, matching the constructor: `NaN`, `Infinity`,
  a value outside `[0, 1]`, `null`, and non-numbers throw the same `Error` instead of
  silently baking an Infinity field or letting feature points escape the neighbourhood.
  Validated once at setup, off the hot loop; an omitted jitter still falls back to the
  instance default with no throw.
- Decision record `0007` closed (`Status: accepted, 2026-08-09`) with its Measured
  table filled from the built 3D kernels and the bench run.

### Planned
- **v1.3.0 (C4):** the full 2D-vs-3D cross-product baseline and the
  3x3x3-sufficiency-vs-oracle proof; `bench/BASELINE.md` consolidation.

## [1.1.0] - 2026-08-09

The texture surface (session C2): the zero-alloc field baker and the exactly-seamless
tile -- the money surface -- plus the proven sibling relationship with `lite-noise`.
The plain `cellular2` path is BYTE-UNCHANGED from 1.0.0: all three goldens re-derive
(`33a16e9e` / `fa25dafd` / `5e5cbfa6`), and no modulo or branch leaked into the
per-query hot loop.

### Added
- **`fillCellField2(dst, w, h, opts?) -> dst`** (instance method) -- bake a `w*h`
  cellular field into a caller-owned `Float64Array`/`Float32Array`, row-major,
  ALLOCATION-FREE (`decisions/0005`). The baker owns nothing: it validates `dst` (a
  typed array, `length >= w*h`) and `w`/`h` (positive integers) and throws otherwise
  (fail closed -- no silent short write). `combo` (`'f1'` / `'f2-f1'` alias `'cracks'`
  / `'f2'`) is decoded to a small-int selector ONCE before the loop -- never a
  per-pixel string parse; the metric is the instance's, bound once -- no per-pixel
  branch; the scan writes one reused scratch struct -- no per-pixel object. `normalize`
  is an opt-in in-place two-pass remap to `[0,1]` (a constant field maps to all-zero,
  never NaN). `opts` uses `opts?.k ?? default` (no `opts = {}`), so the omitted-opts
  path allocates nothing. An unknown `combo` throws with a did-you-mean hint.
- **`tileableCell2(x, y, periodX, periodY, out?) -> {f1,f2,id}`** (instance method) --
  `cellular2` with each neighbour's INTEGER cell coordinate reduced mod an integer
  period, so the field is EXACTLY periodic (`===`, not epsilon) and seamless by
  construction (`decisions/0006`). `periodX`/`periodY` are required positive integers
  (`0`, negatives, non-integers, `NaN`, `Infinity` throw). With `opts.periodX`/
  `periodY` set, `fillCellField2` bakes a seamless tile (the same wrap in the bake
  loop).
- **Three tiling kernels** (`_tileableCell2Euclid` / `_Manhattan` / `_Chebyshev`)
  bound once as `this._tileKernel` alongside `this._kernel` -- six kernels total, the
  duplication deliberate (monomorphism, `decisions/0001`/`0006`). They compute the
  distance in the query cell's LOCAL frame so the `===` wrap is real, not epsilon; the
  absolute-frame variant (the 0006 anti-pattern) is the T9/T0 float-wrap control.
- **The seamlessScore proof** -- a 256x256 period-4 cellular tile scores ~0.012
  (`@zakkster/lite-patternforge` `seamlessScore`, imperceptible), materially below a
  `lite-noise` `tileableField2` gradient tile scored the same way (~0.024). Run in
  torture T8 and `examples/seamless-tile.mjs`.
- **Three composability examples** (`examples/`, CI-asserted via
  `test/examples.test.js`, OUT of `files[]`): `weathered-stone.mjs` (cellular cracks x
  lite-noise fbm), `f1-through-gradient-lut.mjs` (F1 through a lite-gradient-studio
  LUT), `seamless-tile.mjs` (the seam proof as a user-facing recipe).
- **Torture extended**: T0 (exact-periodicity all metrics, bake==per-query plain +
  tiling each combo, combo algebra), T5 (bake determinism + two-instance / module
  isolation), T6 (the field bake + `tileableCell2` at `maxArrayBuffersGrowth: 0` with
  a `dst.buffer.byteLength` assert + the zero-retention lane), T3 (bake/tile parameter
  extremes: 1x1 and large bakes, period 1 and huge, world-scale ox/oy, unknown combo
  throws), T8 (the seam proof), T9 (three new controls: a per-pixel out-struct baker,
  a raw-cell-hash tiling kernel, a per-pixel combo string parse). New break controls
  `CELLULAR_TORTURE_BREAK_BAKER=1`, `CELLULAR_TORTURE_BREAK_COMBOPARSE=1`,
  `CELLULAR_TORTURE_BREAK_FLOATWRAP=1` each exit non-zero.
- **`bench/bench.mjs`** extended with `fillCellField2` (per combo, plain + tiling) and
  `tileableCell2`; `bench/BASELINE.md` updated. All bakes read `bytesPerCall: 0`.

### Changed
- `VERSION` -> `1.1.0` (in lockstep with `package.json` and `llms.txt`).
- **`CELLULAR_BYTE_CEILING` raised 17408 -> 33792** to seat the three tiling kernels
  and the two new methods with their doc comments (Cellular.js is ~31 KB). A
  deliberate bump, noted here.
- Decision records `0005` and `0006` closed (`Status: accepted, 2026-08-09`) with
  their Measured tables filled from the built baker/tile.
- devDeps added: `@zakkster/lite-patternforge`, `@zakkster/lite-noise`,
  `@zakkster/lite-gradient-studio` (examples + the seam proof only; Cellular.js keeps
  zero runtime dependencies).

### Planned
- **v1.2.0 (C3):** `cellular3` / `fillCellField3` -- the 3x3x3 = 27-cell loop, and
  `tileableCell3` carrying the identical integer-cell wrap.

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

[1.2.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v1.2.0
[1.1.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v1.1.0
[1.0.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v1.0.0
[0.1.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v0.1.0
