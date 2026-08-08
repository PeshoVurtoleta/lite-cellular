# @zakkster/lite-cellular

> Zero-GC Worley/cellular noise for 2D -- F1/F2 feature-point distances written into a caller-owned out-struct, no allocation on the query path.

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-cellular.svg)](https://www.npmjs.com/package/@zakkster/lite-cellular)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-cellular?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-cellular)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-cellular?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-cellular)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-cellular?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-cellular)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![zero-GC](https://img.shields.io/badge/allocations-0%20on%20hot%20path-brightgreen.svg)](#zero-gc-design-notes)
[![ESM](https://img.shields.io/badge/module-ESM-f7df1e.svg)](./Cellular.js)
[![types](https://img.shields.io/badge/types-included-blue.svg)](./Cellular.d.ts)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](./package.json)
[![single file](https://img.shields.io/badge/source-single%20file-informational.svg)](./Cellular.js)
[![status](https://img.shields.io/badge/status-v0.1.0%20scaffold-orange.svg)](./CHANGELOG.md)
[![tests](https://img.shields.io/badge/torture-node%20--expose--gc-success.svg)](#testing)

## The cellular noise the zero-GC ecosystem was missing

`@zakkster/lite-noise` owns gradient (Simplex) noise. Worley/cellular noise shares
**zero machinery** with it -- folding it in would blur the one thing that library
is. So it lives here, as its own single-file, zero-dependency, zero-allocation
module. The two compose at the app layer (a cellular `f2 - f1` crack mask times a
Simplex fbm is canonical), never in the same file.

> **v0.1.0 is the scaffold.** This release ships the euclidean, instance-only
> kernel and the torture harness every later session extends. The manhattan and
> chebyshev metrics, the module free-function surface, the field baker and the
> exact tileable wrap are on the roadmap below. Sections marked **(expanded in
> v1.0.0)** are stubs until then.

```bash
npm i @zakkster/lite-cellular
```

```js
import { createCellular } from '@zakkster/lite-cellular';

const cell = createCellular(42);           // euclidean, jitter 1
const c = cell.cellular2(3.5, 7.25);        // { f1, f2, id }

const blobs  = c.f1;                         // distance to nearest feature point
const cracks = c.f2 - c.f1;                  // Voronoi edges -- one subtraction
const region = c.id;                         // stable per-cell tag (flat-shade)
```

## Contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [How it works: feature points and jitter](#how-it-works-feature-points-and-jitter)
- [API reference](#api-reference)
- [Composability](#composability-expanded-in-v100)
- [Zero-GC design notes](#zero-gc-design-notes)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Testing](#testing)
- [What this is not](#what-this-is-not)
- [Ecosystem](#ecosystem)
- [License](#license)

## Why this exists

Cellular noise scatters one feature point per grid cell and answers a query from
the nearest points around it: `f1` (nearest distance) makes blobs/cells, `f2 - f1`
makes cracks and cell walls, `f2` makes a softer field. The two distances are a
strict superset of every texture combo, so the kernel returns the raw pair and
lets the caller do the one subtraction they want -- no lossy `combo` enum on the
hot path.

Most Worley snippets allocate a result object per query and branch on a mode
string. This one writes `{ f1, f2, id }` into a struct you own, over a fixed 3x3
scan of scalar math, allocating nothing after construction. That is the whole
point: it runs in a per-pixel or per-particle loop without feeding the GC.

## What you get

- **`createCellular(seed, opts?)`** -- an isolated instance owning one reused
  out-struct and nothing else (no permutation table).
- **`cellular2(x, y, out?)`** -- the euclidean F1/F2 kernel, zero-alloc,
  fail-closed on non-finite coords.
- **`reseed(seed)`** -- change the field in place at setup time.
- **True euclidean distance** -- squared in the loop, two sqrts at the end, so
  `f2 - f1` is in world units.
- **A stable, SMI-safe `id`** for flat-shading Voronoi regions without a second
  query.
- **A torture gate** proving the query path allocates nothing, and an euclidean
  golden pinning the field bit-for-bit.

## How it works: feature points and jitter

Each grid cell `(cx, cy)` places one feature point at:

```
fx = cx + 0.5 + jitter * (u - 0.5)
fy = cy + 0.5 + jitter * (v - 0.5)      with u, v in [0, 1) from a hash of (cx, cy, seed)
```

- `jitter = 0` -> the exact cell centre: a regular grid (a useful control).
- `jitter = 1` -> anywhere in the cell: full Worley.
- in between: a linear blend, the point always inside its own cell.

`jitter` in `[0, 1]` is not cosmetic clamping -- it is the correctness precondition
of the fixed 3x3 loop. As long as every feature point stays inside its cell, the
3x3 neighbourhood around the query is guaranteed to contain the true `f1` and `f2`.
`jitter > 1` would let a point escape its cell and silently void that guarantee, so
it throws rather than clamps.

`cellular2` accumulates **squared** distance across the nine cells and takes one
`sqrt` for `f1` and one for `f2` at the very end -- no `sqrt` inside the loop, and
the result is true euclidean distance so cross-metric comparisons (v1.0.0) and
`f2 - f1` stay in the same linear units.

## API reference

```ts
const VERSION: string;             // '0.1.0'
const METRIC_EUCLIDEAN: 0;         // the default and only accepted id in v0.1.0

interface CellularResult { f1: number; f2: number; id: number; }
interface CellularOptions { metric?: number; jitter?: number; }

function createCellular(seed?: number, opts?: CellularOptions): Cellular;

class Cellular {
    constructor(seed?: number, opts?: CellularOptions);
    cellular2(x: number, y: number, out?: CellularResult): CellularResult;
    reseed(seed: number): this;
}
```

| Constant | Value | Meaning |
| --- | --- | --- |
| `VERSION` | `'0.1.0'` | package version (two-place sync with `package.json`) |
| `METRIC_EUCLIDEAN` | `0` | euclidean metric id; the default. `1`/`2` reserved for v1.0.0 and rejected until then |

**Fail-closed contract.** An unknown metric id (anything but `0` in v0.1.0), a
`jitter` outside `[0, 1]` or non-finite, and non-finite query coords each throw a
library `Error`. `null` is not zero.

**`out` semantics.** Pass an out-struct and it is written in place and returned;
omit it and the instance's own reused struct is returned (a caller that retains it
across calls is holding scratch the next call overwrites). No allocation either
way.

> **Metrics (expanded in v1.0.0).** manhattan and chebyshev, fixed at instance
> creation via integer id so the hot loop stays branch-free, with the pointwise
> law `chebyshev <= euclidean <= manhattan`. The full metrics-and-jitter deep-dive
> and its allocation/quality tables land with the v1.0.0 core.

## Composability (expanded in v1.0.0)

The money surface -- `fillCellField2` (a zero-alloc field bake) and `tileableCell2`
(an exact seam wrap) -- plus the end-to-end recipes with `@zakkster/lite-noise`
(a `f2 - f1` crack mask times a Simplex fbm -> weathered stone) and
`@zakkster/lite-gradient-studio` (F1 through a LUT) land in v1.1.0. Until then the
composition is caller-side: sample `cellular2` in your own loop and combine the
raw `f1`/`f2` with whatever else you are drawing.

## Zero-GC design notes

- The query path (`cellular2`) allocates **nothing** after construction: a fixed
  3x3 loop of scalar math writing into a caller-owned struct, no temporaries, no
  closures.
- A `Cellular` instance owns exactly one allocation -- its reused out-struct.
  There is no permutation table: cellular scatters one point per cell on demand,
  so there is no lattice to permute.
- Zero-alloc here is **not** a heap heuristic. The T6 torture tier gates
  `maxArrayBuffersGrowth: 0` alongside `maxMajor: 0` with `stabilize: 'deep'`, so a
  regression that allocated a typed-array backing store -- invisible to a plain
  `heapUsed` gate -- fails the gate. Every gate ships a T9 control proven able to
  fail, and `CELLULAR_TORTURE_BREAK=1` makes the run exit non-zero.

| Path | Allocations |
| --- | --- |
| `createCellular` / `new Cellular` | 1 (the reused out-struct) |
| `cellular2(x, y, out)` | 0 |
| `cellular2(x, y)` (omitted out) | 0 (returns the reused struct) |
| `reseed(seed)` | 0 |

## Design decisions worth knowing

- **Combination is the caller's.** The kernel returns exactly `{ f1, f2, id }`;
  `f2 - f1` is one subtraction you do. `{f1, f2}` is a strict superset of every
  combo, so a pre-combined single number would be lossy.
- **`id` is the F1 owner's hash, `| 0` (signed int32).** SMI-safe so it never
  boxes as a heap double when used as a `Map` key; opaque and stable per Voronoi
  region. `>>> 0` would push large values out of the small-integer range.
- **The metric and jitter are immutable per instance.** The feature field is a
  pure function of `(seed, jitter, metric)`; freezing them keeps the instance
  deterministic. `reseed` changes the seed only -- to change metric or jitter,
  create another instance.

The full decision records live under `decisions/` (`0001`..`0004`).

## Testing

```bash
npm test          # node --expose-gc --test test/*.test.js
npm run torture   # node --expose-gc test/torture.mjs  -> prints exactly "ok"
npm run verify    # test + torture
```

| Group | What is tested |
| --- | --- |
| Construction | valid seed/metric/jitter; a bad metric id throws; jitter `-0.1`/`1.1`/`NaN`/`Infinity` throw; boundaries `0`/`1` accepted |
| cellular2 | non-finite coords throw at the door; jitter=0 hand-pinned exact distances; `f1 <= f2 >= 0`; `out` written in place and returned; omitted `out` returns the reused struct |
| Determinism | same seed+coord -> identical `f1`/`f2`/`id`; `reseed` changes the field and reproduces |
| Golden | `goldens/euclidean.json` re-derives bit-for-bit (a change is breaking) |

The torture suite (T0 laws, T6 zero-alloc, T7 retention, T9 controls; T1/T5
reserved) is the DONE-WHEN of every session. `CELLULAR_TORTURE_BREAK=1
node --expose-gc test/torture.mjs` exits non-zero -- the proof the gate can fail.

## What this is not

- **Not full Voronoi topology** (edges, vertices, adjacency, Lloyd relaxation) --
  that is a geometry structure, a different library. This ships the noise field
  (F1/F2 distances), not the diagram.
- **Not gradient/Simplex/Perlin noise** -- that is `@zakkster/lite-noise`.
- **Not a flow-field source.** `f1` has derivative discontinuities at cell
  boundaries by construction (the creases are the point), so it cannot feed an
  analytic curl/flow field. Use lite-noise for flow.
- **Not cryptographic.** The hash is for reproducible scatter, not security.

## Ecosystem

- **`@zakkster/lite-noise`** -- gradient (Simplex) noise, zero-GC. The sibling this
  package composes with at the app layer.
- **`@zakkster/lite-gc-profiler`** / **`@zakkster/lite-leak`** -- the torture gate
  and retention gate (devDependencies only; `Cellular.js` has zero runtime deps).

## License

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
