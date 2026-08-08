# Changelog

All notable changes to `@zakkster/lite-cellular` are documented here.
The format follows Keep a Changelog; this package adheres to SemVer.

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
- **v1.0.0 (C1):** manhattan + chebyshev metrics fixed at instance creation via
  integer id (branch-free hot loop); the module free-function surface
  (`seedCellular`, bare `cellular2`) with the dev-warn-once isolation discipline;
  the executable NS-01 isolation test; goldens for all three metrics.
- **v1.1.0 (C2):** `fillCellField2` (zero-alloc field bake, `combo` resolved once
  before the loop) and `tileableCell2` (exact seam wrap); composability recipes
  with `@zakkster/lite-noise` and `@zakkster/lite-gradient-studio`.
- **v1.2.0 (C3):** `cellular3` / `fillCellField3` -- the 3x3x3 = 27-cell loop on
  the same zero-alloc bar.

[0.1.0]: https://github.com/PeshoVurtoleta/lite-cellular/releases/tag/v0.1.0
