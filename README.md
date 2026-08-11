# @zakkster/lite-cellular

> Zero-GC Worley/cellular noise for 2D and 3D -- `f1`/`f2` feature-point distances and a per-region `id`, written into a caller-owned out-struct, no allocation on the query path.

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
[![status](https://img.shields.io/badge/status-v1.2.0-brightgreen.svg)](./CHANGELOG.md)
[![tests](https://img.shields.io/badge/torture-node%20--expose--gc-success.svg)](#testing)

## The cellular half the noise ecosystem was missing

`@zakkster/lite-noise` gives you gradient (Simplex/Perlin) noise -- smooth, band-limited value fields. It does not give you the OTHER canonical procedural primitive: **cellular / Worley noise**, the distance-to-nearest-feature field that makes cells, cracks, scales, stone, and Voronoi region masks. `lite-cellular` is that half, built to the same bar: zero runtime dependencies, single file, and **zero allocation on every query** -- the result is written into a struct you own, and the neighbourhood scan never touches the heap.

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
- **A zero-alloc field baker** -- `fillCellField2(dst, w, h, opts?)` writes a whole
  `w*h` texture into a typed array you own (`combo` resolved once; opt-in normalize),
  and **`tileableCell2`** gives an EXACTLY-seamless tile (integer-cell wrap, not
  epsilon) -- proven near-zero by `@zakkster/lite-patternforge` `seamlessScore`.
- **Zero allocation on the query path** -- proven, not asserted: the torture gate
  measures `maxBytesPerCall: 0` retained bytes and `maxArrayBuffersGrowth: 0`.
- **Instance isolation (NS-01)** -- two instances never cross-contaminate; a module
  free surface (`cellular2` / `seedCellular`) for zero-config use.
- **Deterministic and reproducible** -- pure function of `(seed, cell coords)`,
  pinned by three committed goldens.

<details>
<summary><b>The core surface</b> -- what a query actually does</summary>

A query at `(x, y)` finds the integer cell `(floor(x), floor(y))` and scans a fixed
neighbourhood of cells around it. Each cell deterministically scatters one feature
point at `cell + 0.5 + jitter*(u - 0.5)`, where `u`/`v` in `[0,1)` come from a hash
of the integer cell coordinates and the seed. For each point in the neighbourhood the
kernel computes the distance under this instance's metric and keeps the two smallest
(`f1`, `f2`) plus the primary hash of the F1 owner (`id`).

The neighbourhood radius is EXACT per metric (`decisions/0008`), and this is the one
subtlety worth internalising. Under **chebyshev** (L-inf) the true nearest and
second-nearest always lie in the immediate 3x3 / 3x3x3 block, so that is what the
chebyshev kernel scans. Under **euclidean** (L2) or **manhattan** (L1) a feature point
up to TWO cells away can be nearer -- an L1/L2 ball reaches past the immediate ring
where an L-inf ball never does -- so those kernels scan the wider 5x5 / 5x5x5 block,
which is provably sufficient. `jitter <= 1` is the precondition that ties it together:
it keeps every feature point inside its home cell, the condition under which the fixed
neighbourhood (3x3 for chebyshev, 5x5 for euclid/manhattan) is guaranteed to contain
the true `f1`/`f2`. `jitter > 1` throws (fail-closed) rather than silently voiding that
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
  // Exactly-tileable sample: cellular2 with the integer cell coords wrapped mod an
  // integer period. periodX/periodY are required positive integers (else throw).
  // Seamless by construction. Zero allocation. See decisions/0006.
  tileableCell2(x: number, y: number, periodX: number, periodY: number, out?: CellularResult): CellularResult;
  // Bake a w*h field into a caller-owned typed array (length >= w*h), row-major,
  // allocation-free; returns dst. combo resolved once; optional normalize; set
  // periodX/periodY for a seamless tile. Fail closed on bad dst/w/h/combo. See 0005.
  fillCellField2<T extends Float64Array | Float32Array>(dst: T, w: number, h: number, opts?: FillCellFieldOptions): T;

  // --- 3D (v1.2.0): the volumetric lift of the three methods above. See decisions/0007, 0008.
  // Sample the 3D field at (x, y, z). Same {f1,f2,id} shape; chebyshev scans 3x3x3 = 27
  // cells, euclid/manhattan the exact 5x5x5 = 125 (0008), same zero-alloc shape. Throws on non-finite x/y/z.
  cellular3(x: number, y: number, z: number, out?: CellularResult): CellularResult;
  // Exactly-tileable 3D sample: cellular3 with the integer cell coords wrapped mod the
  // period on ALL THREE axes. periodX/periodY/periodZ are required positive integers.
  // Seamless by construction. Zero allocation.
  tileableCell3(x: number, y: number, z: number, periodX: number, periodY: number, periodZ: number, out?: CellularResult): CellularResult;
  // Bake a w*h*d VOLUME into a caller-owned typed array (length >= w*h*d), row-major
  // with z outermost, allocation-free; returns dst. combo resolved once; optional
  // normalize; set periodX/periodY/periodZ for a seamless tile. Fail closed.
  fillCellField3<T extends Float64Array | Float32Array>(dst: T, w: number, h: number, d: number, opts?: FillCellField3Options): T;
  // Re-seed in place. Setup only. Returns this.
  reseed(seed: number): this;
}

interface FillCellFieldOptions {
  scale?: number;                               // coord step per pixel (px += scale); default 0.01
  combo?: 'f1' | 'f2-f1' | 'cracks' | 'f2';     // which texture; default 'f1'; unknown throws
  jitter?: number;                              // override instance jitter for this bake
  ox?: number; oy?: number;                     // world-space origin; default 0
  normalize?: boolean;                          // opt-in in-place remap to [0,1]; default false
  periodX?: number; periodY?: number;           // set BOTH (positive ints) for a seamless tile
}

interface FillCellField3Options {               // fillCellField3 (v1.2.0): as above, plus depth
  scale?: number;                               // coord step per voxel on every axis; default 0.01
  combo?: 'f1' | 'f2-f1' | 'cracks' | 'f2';     // which texture; default 'f1'; unknown throws
  jitter?: number;                              // override instance jitter for this bake
  ox?: number; oy?: number; oz?: number;        // world-space origin; default 0
  normalize?: boolean;                          // opt-in in-place remap to [0,1]; default false
  periodX?: number; periodY?: number; periodZ?: number; // set ALL THREE for a seamless tile
}

// Module free surface: euclidean, jitter 1, shared module seed. Zero-config.
function cellular2(x: number, y: number, out?: CellularResult): CellularResult;
// Re-seed the shared module field. Warns once in dev on a 2nd call; silent in prod.
function seedCellular(seed?: number): void;
```

### Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `VERSION` | `'1.2.0'` | In lockstep with `package.json` + `llms.txt` (three-place sync). |
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

The field baker is where cellular meets the rest of the `@zakkster` ecosystem: it
writes a whole texture into a buffer you own, and every downstream step (colour,
displacement, tiling) is a pure per-pixel function of that buffer. Three recipes,
each a runnable, CI-asserted file in [`examples/`](./examples):

**1. Weathered stone -- cellular cracks x lite-noise fbm** ([`examples/weathered-stone.mjs`](./examples/weathered-stone.mjs)).
Bake the Voronoi wall field (`combo: 'f2-f1'`, normalized: ~0 on the mortar lines)
and multiply it into a `@zakkster/lite-noise` fbm heightfield -- the cracks darken
the height where they run:

```js
import { createCellular } from '@zakkster/lite-cellular';
import { createNoise } from '@zakkster/lite-noise';

const w = 128, h = 128;
const cracks = new Float64Array(w * h);     // ~0 on Voronoi walls
const fbm = new Float64Array(w * h);
const stone = new Float64Array(w * h);

createCellular(1337).fillCellField2(cracks, w, h, { combo: 'f2-f1', scale: 0.05, normalize: true });
createNoise(99).fillField2(fbm, w, h, { scale: 0.03, octaves: 5, normalize: true });
for (let i = 0; i < stone.length; i++) stone[i] = fbm[i] * cracks[i]; // zero-alloc combine
```

**2. F1 through a gradient LUT** ([`examples/f1-through-gradient-lut.mjs`](./examples/f1-through-gradient-lut.mjs)).
Bake `combo: 'f1'`, find ONE global lo/span, then map every pixel through a
`@zakkster/lite-gradient-studio` LUT (`bakeGradientToLut` once, `sampleLut` per pixel)
into a packed RGBA-LE `Uint32Array` -- ImageData-ready, zero allocation in the paint
loop:

```js
import { createCellular } from '@zakkster/lite-cellular';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';

const w = 128, h = 128;
const field = new Float64Array(w * h);
createCellular(42).fillCellField2(field, w, h, { combo: 'f1', scale: 0.05 });

let lo = Infinity, hi = -Infinity;
for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
const span = (hi - lo) || 1;
const lut = bakeGradientToLut(gradientOcean, 256);
const texture = new Uint32Array(w * h);
for (let i = 0; i < field.length; i++) texture[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;
```

**3. A seamless tile, proven** ([`examples/seamless-tile.mjs`](./examples/seamless-tile.mjs)).
A tiling bake (`periodX`/`periodY` set, `scale = period / w`) scored by
`@zakkster/lite-patternforge` `seamlessScore` -- see the tileability note below.

For the zero-config per-query case, the module free functions share one seed:

```js
import { cellular2, seedCellular } from '@zakkster/lite-cellular';
seedCellular(42);
const c = cellular2(3.5, 7.25);             // euclidean, jitter 1, shared seed
```

### Tileability -- exact, not epsilon

`tileableCell2(x, y, periodX, periodY)` and a tiling `fillCellField2` wrap the
**integer cell coordinate** modulo an **integer period**. Because the reduction is
integer modulo -- no float period, no grid-alignment precondition -- the wrapped cells
are the *same cells* with the *same feature points*, so the tile is seamless **by
construction**: the seam step equals a normal interior step, and `tileableCell2(x,.)`
is bit-identically periodic with `tileableCell2(x + periodX, .)` on representable
coordinates (the `id` region tag is periodic on any coordinate). Contrast a gradient
lattice tile, which wraps only to float epsilon and carries a small seam-contrast
floor.

The claim is tested, not asserted. A 256x256 period-4 cellular tile, coloured through
`gradientOcean` and scored with `@zakkster/lite-patternforge` `seamlessScore`, reads
**~0.012 overall** (imperceptible, `< 0.02`) -- materially below a `@zakkster/lite-noise`
`tileableField2` fbm tile scored the same way (**~0.024**). For a seamless bake, set
`periodX`/`periodY` and `scale = periodX / w` so the `w` columns span exactly the tile:

```js
import { createCellular } from '@zakkster/lite-cellular';
const W = 256, P = 4;
const tile = new Float64Array(W * W);
createCellular(42).fillCellField2(tile, W, W, { combo: 'f1', scale: P / W, periodX: P, periodY: P });
```

## 3D -- the same surface, in a volume

v1.2.0 lifts the whole 2D surface into 3D over the 27-cell neighbourhood (widened to
the exact **5x5x5 = 125-cell** block for euclid/manhattan in v1.3.0; chebyshev stays 27).
`cellular3(x, y, z)`, `tileableCell3(x, y, z, periodX, periodY, periodZ)`, and
`fillCellField3(dst, w, h, d, opts)` are a **verbatim lift** of the 2D methods -- the
same `{f1,f2,id}` shape, the same three metrics bound once, the same jitter and `id`
rules, the same combo convention, and the same EXACT integer-cell tile wrap (now on all
three axes). Nothing is new design; the volumetric use cases are 3D caustics, voxel
terrain masks, animated 2D-over-time (bake a slab per frame), and marble solids.

It costs what the cell count says: 27 cells is ~3x the 9-cell 2D work, and `cellular3`
euclidean measures ~4.8 Mops/s against the 2D ~14.3 -- a 3.0x ratio -- with **zero
allocation on the query path**, proven by the same torture T6 gate as 2D (incl.
`maxArrayBuffersGrowth: 0` and a `dst.buffer.byteLength` assert on the volume bake).

```js
import { createCellular, METRIC_EUCLIDEAN } from '@zakkster/lite-cellular';

const cell = createCellular(42, { metric: METRIC_EUCLIDEAN });
const out = { f1: 0, f2: 0, id: 0 };
cell.cellular3(3.5, 7.25, 1.5, out);            // { f1, f2, id }, zero-alloc

// Bake a whole volume (z outermost: idx = (z*h + y)*w + x), allocation-free:
const w = 32, h = 32, d = 32;
const vol = new Float64Array(w * h * d);
cell.fillCellField3(vol, w, h, d, { combo: 'f2-f1', scale: 0.05 });

// A seamless 3D tile -- exact on all three axes, set all three periods:
cell.fillCellField3(vol, w, h, d, { combo: 'f1', scale: 4 / w, periodX: 4, periodY: 4, periodZ: 4 });
```

3D is **instance-only** (a volume wants metric + jitter control), consistent with the
2D baker. There is deliberately **no module 3D surface and no 4D** -- 81 cells is a
different cost regime a 3D field plus a time offset already serves (`decisions/0007`).

<details>
<summary><b>Zero-GC design notes</b> -- the allocation table and how it is proven</summary>

Every owned allocation of a `Cellular` instance:

| Allocation | When | Per query? |
| --- | --- | --- |
| the instance object + its scalars | `createCellular` | no |
| one reused out-struct `{ f1, f2, id }` | `createCellular` | no (reused) |
| (no permutation table) | -- | cellular scatters on demand |
| the query itself | `cellular2` / `tileableCell2` / `cellular3` / `tileableCell3` | **0 bytes** |
| a whole `w*h` field bake | `fillCellField2` | **0 bytes** (writes caller-owned `dst`) |
| a whole `w*h*d` volume bake | `fillCellField3` | **0 bytes** (writes caller-owned `dst`) |

`fillCellField2` is the case the `maxArrayBuffersGrowth: 0` gate exists for: `dst` is
an ArrayBuffer-backed store the V8-heap gate is blind to, so torture T6 also asserts
`dst.buffer.byteLength` is unchanged across the window. The bake resolves `combo` to a
small int once, binds the metric once, and scans into one reused scratch struct -- no
per-pixel object, no per-pixel string parse.

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
| `cellular2` euclidean | ~13.6 | 0 |
| `cellular2` manhattan | ~8.2 | 0 |
| `cellular2` chebyshev | ~8.4 | 0 |
| module `cellular2` | ~13.9 | 0 |
| `tileableCell2` euclidean | ~10.8 | 0 |
| `fillCellField2` 64x64 (plain) | ~11 K fields/s (~45 Mpx/s) | 0 |
| `fillCellField2` 64x64 (tiling) | ~6 K fields/s (~24 Mpx/s) | 0 |

</details>

## Design decisions worth knowing

The decisions this package implements are committed in `decisions/`:

- **[0001](decisions/0001-metric-selection.md)** -- the metric is an integer id
  bound to one inlined kernel per metric; the loop is monomorphic and branch-free.
  Euclidean returns true distance, not squared, for unit coherence.
- **[0002](decisions/0002-combination-is-callers.md)** -- the kernel returns exactly
  `{ f1, f2, id }`; combinations (`f2 - f1`, ...) are the caller's one op, never a
  per-query `combo` parameter (`combo` lives only in the bake, 0005).
- **[0003](decisions/0003-jitter-and-hash.md)** -- `jitter` in `[0, 1]` is the 3x3
  scan's correctness contract; the hash is an allocation-free integer mix of the
  cell coords + seed, with two decorrelated draws (measured uniform, `corr ~ 0`).
- **[0004](decisions/0004-cell-id.md)** -- `id` is the F1 owner's hash coerced with
  `| 0` (SMI-safe), opaque, stable per region, metric-dependent owner.
- **[0005](decisions/0005-field-baker-ownership.md)** -- `fillCellField2` owns
  nothing (caller-owned `dst`, written in place); `combo` is resolved to a small-int
  selector ONCE before the loop; `normalize` is an allocation-free opt-in.
- **[0006](decisions/0006-tileability.md)** -- `tileableCell2` wraps the integer cell
  mod an integer period, for an EXACT (`===`) seam, not epsilon; three tiling kernels
  bound as `this._tileKernel`, so the plain path pays nothing.

## Testing

```bash
npm test          # node --expose-gc --test test/*.test.js
npm run torture   # node --expose-gc test/torture.mjs   -> prints exactly "ok"
npm run verify    # both
```

85 `node:test` assertions across `Cellular.test.js` (incl. the Field bake / Combo /
Normalize / Tileable / Seam groups), `boundary.test.js`, `boundary-c1.test.js`,
`bundle.test.js`, and `examples.test.js` (the three composability recipes), plus an
8-tier torture gate:

| Tier | What it proves |
| --- | --- |
| T0 | metamorphic laws (determinism, `f1 <= f2`, metric-sanity, jitter=0 grid, id-within-cell, three goldens) + exact tile periodicity, bake==per-query, combo algebra |
| T1 | degenerate values across three metrics (0/-0, non-finite throws, subnormal, f32-max, 2^24 boundary) |
| T3 | world-scale precision walk per metric (pinned limit) + bake/tile parameter extremes (1x1 & large bakes, period 1 & huge, world-scale ox/oy, unknown combo throws) |
| T5 | NS-01 isolation (instance/module, reseed, interleave) + bake determinism & two-instance / module isolation |
| T6 | the zero-alloc gate: `maxBytesPerCall: 0` + `maxArrayBuffersGrowth: 0` for three metrics, the module surface, the field bake (plain + tiling, each combo, `dst.buffer.byteLength` asserted), and `tileableCell2` |
| T7 | dropped instances of every metric are collectable (lite-leak) |
| T8 | the seamlessScore proof: a cellular tile near-zero and below a gradient tile |
| T9 | controls -- every gate proven able to fail |

Five break controls exit non-zero on purpose: `CELLULAR_TORTURE_BREAK=1` (retained
allocation into T6), `CELLULAR_TORTURE_SHARED_SEED=1` (shared-seed build through T5),
`CELLULAR_TORTURE_BREAK_BAKER=1` (per-pixel out-struct baker), `CELLULAR_TORTURE_BREAK_COMBOPARSE=1`
(per-pixel combo string parse), and `CELLULAR_TORTURE_BREAK_FLOATWRAP=1` (a
raw-cell-hash tiling kernel that is not exactly periodic).

## What this is not

- **Not a Voronoi diagram.** No edges, vertices, adjacency, or Lloyd relaxation --
  that is a geometry structure, a different library. This is the noise field.
- **Not gradient noise.** Simplex/Perlin/value noise is `@zakkster/lite-noise`.
- **Not a flow-field source.** `f1` has derivative discontinuities at cell
  boundaries by construction; it cannot feed an analytic curl/flow field.
- **Not cryptographic.** The hash is for reproducible scatter, not security.
- **Not 4D, ever.** 2D and 3D ship (chebyshev 9 / 27 cells, euclid/manhattan the exact
  25 / 125); 4D is a different cost regime a 3D field plus a time offset already serves
  -- permanently out of scope (`decisions/0007`). `combo` lives ONLY in the bake, never per query.
- **Not precise past ~2^52.** Beyond the float64 integer limit the neighbourhood
  degenerates (the pinned world-scale limit) -- per axis, in 2D and 3D alike.

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
