# @zakkster/lite-cellular

> Zero-GC Worley/cellular noise for 2D -- `f1`/`f2` feature-point distances and a per-region `id`, written into a caller-owned out-struct, no allocation on the query path.

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

## The cellular half the noise ecosystem was missing

`@zakkster/lite-noise` gives you gradient (Simplex/Perlin) noise -- smooth, band-limited value fields. It does not give you the OTHER canonical procedural primitive: **cellular / Worley noise**, the distance-to-nearest-feature field that makes cells, cracks, scales, stone, and Voronoi region masks. `lite-cellular` is that half, built to the same bar: zero runtime dependencies, single file, and **zero allocation on every query** -- the result is written into a struct you own, and the 3x3 neighbourhood scan never touches the heap.

```bash
npm i @zakkster/lite-cellular
```

```js
import { createCellular, METRIC_MANHATTAN } from '@zakkster/lite-cellular';

const cell = createCellular(42, { metric: METRIC_MANHATTAN });
const out = { f1: 0, f2: 0, id: 0 };

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    cell.cellular2(x * 0.05, y * 0.05, out); // zero-alloc: writes into `out`
    const blobs  = out.f1;                    // distance to nearest feature point
    const cracks = out.f2 - out.f1;           // Voronoi edges -- one subtraction
    const region = out.id;                    // stable per-cell tag (flat shading)
  }
}
```

## Contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [The core surface](#the-core-surface)
- [API reference](#api-reference)
- [Metrics, jitter, and the id tag](#metrics-jitter-and-the-id-tag)
- [Composability](#composability)
- [Zero-GC design notes](#zero-gc-design-notes)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Testing](#testing)
- [What this is not](#what-this-is-not)
- [Ecosystem](#ecosystem)
- [License](#license)

## Why this exists

Cellular noise's textures are combinations of the two nearest feature-point distances:

- `f1`      -> blobs / cells (distance to the nearest point)
- `f2 - f1` -> cracks / cell walls (the Voronoi edges)
- `f2`      -> a softer cell field

Most minimal Worley snippets return `f1` only, allocate a fresh result object per
call, and branch on a string metric inside the 9-cell loop. Each of those is a
correctness or performance hazard at scale (a field bake is millions of queries).
`lite-cellular` returns the raw `{ f1, f2, id }` pair-plus-tag (a strict superset of
every combination -- the caller does the one arithmetic op they want), writes it
into a struct you own, and resolves the metric to one inlined kernel **once** at
construction so the loop stays monomorphic and branch-free.

## What you get

- **Three distance metrics**, fixed at instance creation via an integer id:
  euclidean (L2), manhattan (L1), chebyshev (Linf). All report LINEAR units.
- **`{ f1, f2, id }` per query** -- the two nearest distances and the F1 owner's
  stable per-region tag. Combinations (`f2 - f1`, `f1 * f2`, ...) are the caller's.
- **Zero allocation on the query path** -- proven, not asserted: the torture gate
  measures `maxBytesPerCall: 0` retained bytes and `maxArrayBuffersGrowth: 0`.
- **Instance isolation (NS-01)** -- two instances never cross-contaminate; a module
  free surface (`cellular2` / `seedCellular`) for zero-config use.
- **Deterministic and reproducible** -- pure function of `(seed, cell coords)`,
  pinned by three committed goldens.

<details>
<summary><b>The core surface</b> -- what a query actually does</summary>

A query at `(x, y)` finds the integer cell `(floor(x), floor(y))` and scans the
fixed 3x3 neighbourhood of cells around it. Each cell deterministically scatters
one feature point at `cell + 0.5 + jitter*(u - 0.5)`, where `u`/`v` in `[0,1)` come
from a hash of the integer cell coordinates and the seed. For each of the 9 points
the kernel computes the distance under this instance's metric and keeps the two
smallest (`f1`, `f2`) plus the primary hash of the F1 owner (`id`).

`jitter <= 1` is a correctness precondition, not a cosmetic knob: it keeps every
feature point inside its home cell, which is exactly the condition under which the
fixed 3x3 neighbourhood is guaranteed to contain the TRUE nearest and second-nearest
points. `jitter > 1` throws (fail-closed) rather than silently voiding that
guarantee near cell corners.

The metric is dropped from the loop entirely: there are three metric-specific
kernels, and the constructor binds exactly one to `this._kernel`. So the per-query
cost is one indirect call OFF the loop and zero metric branches per neighbour.

</details>

## API reference

```ts
import {
  createCellular, Cellular,
  cellular2, seedCellular,
  VERSION, METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '@zakkster/lite-cellular';

interface CellularResult { f1: number; f2: number; id: number; }
interface CellularOptions { metric?: number; jitter?: number; }

// Create an independent instance. Throws on a bad metric id or out-of-range jitter.
function createCellular(seed?: number, opts?: CellularOptions): Cellular;

class Cellular {
  constructor(seed?: number, opts?: CellularOptions);
  // Sample at (x, y). Writes into `out` (and returns it) or the reused instance
  // struct. Zero allocation. Throws on non-finite x or y.
  cellular2(x: number, y: number, out?: CellularResult): CellularResult;
  // Re-seed in place. Setup only. Returns this.
  reseed(seed: number): this;
}

// Module free surface: euclidean, jitter 1, shared module seed. Zero-config.
function cellular2(x: number, y: number, out?: CellularResult): CellularResult;
// Re-seed the shared module field. Warns once in dev on a 2nd call; silent in prod.
function seedCellular(seed?: number): void;
```

### Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `VERSION` | `'1.0.0'` | In lockstep with `package.json` + `llms.txt` (three-place sync). |
| `METRIC_EUCLIDEAN` | `0` | L2, `sqrt(dx*dx + dy*dy)`. The default. |
| `METRIC_MANHATTAN` | `1` | L1, `|dx| + |dy|`. Diamond cells. |
| `METRIC_CHEBYSHEV` | `2` | Linf, `max(|dx|, |dy|)`. Square cells. |

An unknown metric id (`3`, `-1`, `1.5`, `'euclidean'`, `null`, ...) throws at
construction: the guard accepts `0`/`1`/`2` and never loosens.

## Metrics, jitter, and the id tag

**Metrics.** All three share one feature-point placement and differ only in the
distance line. Euclidean returns TRUE distance (squared in the loop, one sqrt each
for `f1`/`f2` at the end), so it is in the same LINEAR units as manhattan and
chebyshev. That unit coherence is load-bearing: the pointwise inequality
`chebyshev <= euclidean <= manhattan` (`Linf <= L2 <= L1`) holds for BOTH `f1` and
`f2`, and the caller's `f2 - f1` crack width is a real world-space distance in every
metric. The metric is immutable per instance -- to change it, create another.

**Jitter** in `[0, 1]`: `0` is the exact grid of cell centres (a regular pattern, a
useful reference), `1` is full Worley scatter, in between is a linear blend. The
bound is the 3x3 scan's correctness contract (see the core-surface note). Immutable
per instance; validated once at construction; `jitter > 1` throws.

**The `id` tag** is the F1 owner cell's primary hash, coerced with `| 0` (signed
int32, SMI-safe -- NOT `>>> 0`, which would box values above 2^31 into heap doubles
and defeat using `id` as a `Map` key). It is opaque and stable per Voronoi region:
constant for every query whose nearest feature point is the same cell's, and it
flips exactly at the boundary -- so you can flat-shade regions with one query, no
second pass. The owner is metric-dependent by design: the same coord under two
metrics may report different `id`.

## Composability

Cellular composes with `@zakkster/lite-noise` at the app layer -- warp a cellular
field with gradient noise, or multiply a crack mask into an fbm. The combination is
always the caller's arithmetic, in the caller's loop, on caller-owned scratch:

```js
import { createCellular } from '@zakkster/lite-cellular';
import { createNoise } from '@zakkster/lite-noise';

const cell = createCellular(1337);          // euclidean, jitter 1
const warp = createNoise(99);
const out = { f1: 0, f2: 0, id: 0 };

function stoneMask(x, y) {
  // Domain-warp the sample point with gradient noise, then read cracks.
  const wx = x + 0.4 * warp.simplex2(x * 0.3, y * 0.3);
  const wy = y + 0.4 * warp.simplex2(x * 0.3 + 5.2, y * 0.3 + 1.7);
  cell.cellular2(wx, wy, out);
  const cracks = out.f2 - out.f1;           // Voronoi edges
  return cracks < 0.05 ? 0 : 1;             // thin dark mortar between stones
}
```

For the zero-config case, the module free functions share one seed:

```js
import { cellular2, seedCellular } from '@zakkster/lite-cellular';
seedCellular(42);
const c = cellular2(3.5, 7.25);             // euclidean, jitter 1, shared seed
```

<details>
<summary><b>Zero-GC design notes</b> -- the allocation table and how it is proven</summary>

Every owned allocation of a `Cellular` instance:

| Allocation | When | Per query? |
| --- | --- | --- |
| the instance object + its scalars | `createCellular` | no |
| one reused out-struct `{ f1, f2, id }` | `createCellular` | no (reused) |
| (no permutation table) | -- | cellular scatters on demand |
| the query itself | `cellular2` | **0 bytes** |

`cellular2` reads locals only (state is passed as arguments, never `this.*` in the
loop), keeps `f1`/`f2`/`id` in registers, and writes three fields into the struct
you passed (or the reused one). It allocates nothing.

**Zero-alloc is not a heap heuristic here.** The torture gate proves it two ways
with `@zakkster/lite-gc-profiler`:

- `measureAllocs` `maxBytesPerCall: 0` -- per-call RETAINED bytes after a forced
  collection. `0` is the literal zero-retention claim, measured best-of-5 (the
  budget stays 0; best-of-N only sheds the estimator's rare sub-byte fluke). A
  `measureOps` allocation RATE is deliberately NOT used: a rate has a documented V8
  self-noise floor and can never read 0.
- `measureOps` `maxArrayBuffersGrowth: 0` and `maxMajor: 0` (with
  `stabilize: 'deep'`) -- ArrayBuffer backing stores live outside the V8 heap where
  a plain heap gate is blind; this catches any retained typed-array growth.

Both run for all three metrics AND the module surface, and each gate ships a
control that must trip it (a per-query object that escapes, a retained
Float64Array) so the gate is provably able to fail.

Indicative throughput (best-of-5 `measureOps`, node v26.3.1; ~2x run-to-run
variance -- the alloc gate is the contract, not this):

| probe | Mops/s | bytesPerCall |
| --- | --- | --- |
| `cellular2` euclidean | ~14.7 | 0 |
| `cellular2` manhattan | ~9.5 | 0 |
| `cellular2` chebyshev | ~8.5 | 0 |
| module `cellular2` | ~14.7 | 0 |

</details>

## Design decisions worth knowing

The four decisions this release implements are committed in `decisions/`:

- **[0001](decisions/0001-metric-selection.md)** -- the metric is an integer id
  bound to one inlined kernel per metric; the loop is monomorphic and branch-free.
  Euclidean returns true distance, not squared, for unit coherence.
- **[0002](decisions/0002-combination-is-callers.md)** -- the kernel returns exactly
  `{ f1, f2, id }`; combinations (`f2 - f1`, ...) are the caller's one op, never a
  per-query `combo` parameter.
- **[0003](decisions/0003-jitter-and-hash.md)** -- `jitter` in `[0, 1]` is the 3x3
  scan's correctness contract; the hash is an allocation-free integer mix of the
  cell coords + seed, with two decorrelated draws (measured uniform, `corr ~ 0`).
- **[0004](decisions/0004-cell-id.md)** -- `id` is the F1 owner's hash coerced with
  `| 0` (SMI-safe), opaque, stable per region, metric-dependent owner.

## Testing

```bash
npm test          # node --expose-gc --test test/*.test.js
npm run torture   # node --expose-gc test/torture.mjs   -> prints exactly "ok"
npm run verify    # both
```

50 `node:test` assertions across `Cellular.test.js`, `boundary.test.js`, and
`bundle.test.js`, plus a 7-tier torture gate:

| Tier | What it proves |
| --- | --- |
| T0 | metamorphic laws: determinism, `f1 <= f2`, metric-sanity ordering (f1 AND f2), per-metric jitter=0 grid distance, id-within-cell, three goldens (euclidean `33a16e9e` unchanged) |
| T1 | degenerate values across three metrics (0/-0, non-finite throws, subnormal, f32-max, 2^24 boundary) |
| T3 | world-scale precision walk per metric, with a PINNED limit (precise to 1e12; degenerates at 2^52) |
| T5 | NS-01 isolation: instance-vs-instance, module-vs-instance, reseed reproducibility, interleaved cross-contamination fuzz |
| T6 | the zero-alloc gate: `maxBytesPerCall: 0` + `maxArrayBuffersGrowth: 0` for three metrics + the module surface |
| T7 | dropped instances of every metric are collectable (lite-leak) |
| T9 | controls -- every gate proven able to fail |

Two break controls exit non-zero on purpose: `CELLULAR_TORTURE_BREAK=1` (injects a
retained allocation into T6) and `CELLULAR_TORTURE_SHARED_SEED=1` (runs a
shared-seed build through T5's isolation law).

## What this is not

- **Not a Voronoi diagram.** No edges, vertices, adjacency, or Lloyd relaxation --
  that is a geometry structure, a different library. This is the noise field.
- **Not gradient noise.** Simplex/Perlin/value noise is `@zakkster/lite-noise`.
- **Not a flow-field source.** `f1` has derivative discontinuities at cell
  boundaries by construction; it cannot feed an analytic curl/flow field.
- **Not cryptographic.** The hash is for reproducible scatter, not security.
- **Not 3D or a field baker (yet).** `cellular3`, `fillCellField2`, and the exact
  tileable wrap land in v1.1.0 (C2) and v1.2.0 (C3). No `combo`/`mode` per query.
- **Not precise past ~2^52.** Beyond the float64 integer limit the 3x3
  neighbourhood degenerates (the pinned v1.0.0 world-scale limit).

## Ecosystem

- **[@zakkster/lite-noise](https://www.npmjs.com/package/@zakkster/lite-noise)** --
  gradient (Simplex) noise + fbm/ridged/billow. The sibling; composes at the app
  layer.
- **[@zakkster/lite-gc-profiler](https://www.npmjs.com/package/@zakkster/lite-gc-profiler)**
  and **[@zakkster/lite-leak](https://www.npmjs.com/package/@zakkster/lite-leak)**
  -- the zero-GC gate and retention tracker this package's torture suite runs on
  (dev dependencies only).

## License

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
