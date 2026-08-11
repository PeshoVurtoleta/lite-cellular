# 0007 -- 3D is a fast-follow lift, not a core feature, not a generic N-D kernel (C3, v1.2.0)

Status: accepted, 2026-08-09. Implemented in v1.2.0 (C3); the three 3D goldens pin
  the exact hashes and each metric's distance line, and the Measured table below is
  filled from the built 3D kernels.
Anchor: D-07 (ROADMAP.md section 2)
Owner: C3
Depends on: 0001..0006 -- 3D lifts ALL of them to the 27-cell neighbourhood
  unchanged; nothing in 3D is new design, which is exactly why it is a fast-follow.

> Superseded in part by 0008 (2026-08-10, v1.3.0): the 3D neighbourhood is exact at
> 3x3x3 = 27 cells only for chebyshev; euclid/manhattan widened to 5x5x5 = 125 cells
> (the 2D radius-2 widening lifted to R^3). The verbatim-lift argument below is
> unchanged -- the widening lifts too. Read "27-cell scan" as "the per-metric exact
> neighbourhood (chebyshev 27, euclid/manhattan 125)".

Forward-dated (see 0001). This record fixes three things about the third dimension:
when it ships, that it is a verbatim lift of the 2D decisions, and that it is NOT a
dimension-parameterised kernel.

## Problem

Cellular noise generalises to 3D by scanning the 3x3x3 = 27-cell neighbourhood
instead of the 3x3 = 9-cell one. The volumetric use cases are real (3D caustics,
voxel terrain masks, animated 2D-over-time, marble solids). Three questions:

1. **When does 3D ship** -- in the v1.0.0 core, or later?
2. **Is 3D new design**, or a mechanical lift of the 2D decisions?
3. **One kernel parameterised by dimension**, or separate 2D and 3D kernels?

## Decision 1: 3D ships as v1.2.0, a fast-follow -- not in the v1.0.0 core

The honest core (v1.0.0) is the 2D kernel with three metrics, jitter, id, the module
surface, and the NS-01 isolation gate. 3D waits for its own session (C3), after the
2D texture surface (C2), for two reasons beyond "smaller releases":

- **Let the 2D API settle before duplicating it.** The out-struct shape, the metric
  ids, the combo convention, the tileable wrap -- once 3D exists, a change to any of
  them is a change in two places. Shipping 2D first, and letting C2 exercise the
  field baker and tile, means 3D lifts a *settled* API, not a provisional one. A
  mistake baked into one dimension is a bug; baked into two, it is twice the
  migration.
- **3D must clear the SAME bar, so it earns a session.** 27 cells is 3x the per-query
  work of 9; it is still a fixed-size, branch-free, zero-alloc loop, but the T6
  alloc gate, the goldens (per metric), and the T3 precision sweep all have to be
  re-proven in 3D. That is a session's worth of gating, not a footnote appended to
  the core.

## Decision 2: 3D is a verbatim lift of 0001..0006, not new design

Everything carries with the coordinate count bumped from 2 to 3:

- **Metrics (0001)**: `cheby <= euclid <= manhattan` holds in 3D (`Linf <= L2 <= L1`
  in R^3); three inlined 3D kernels, bound once. euclidean sums three squared terms,
  one sqrt at the end.
- **Combination (0002)**: `cellular3` returns exactly `{ f1, f2, id }`; `f2 - f1` is
  the caller's. `fillCellField3` carries the resolve-once combo.
- **jitter + hash (0003)**: `_hash3(cx, cy, cz, seed)` with THREE decorrelated draws
  `(u, v, w)`; placement `cell + 0.5 + jitter*(draw - 0.5)` per axis; `jitter in
  [0,1]` is again the correctness bound (a point must stay in its cell for 3x3x3 to
  suffice).
- **id (0004)**: the F1 owner's `_hash3` value `| 0`, SMI-safe; ties break by the
  fixed `gz,gy,gx` scan order.
- **Baker (0005)**: `fillCellField3(dst, w, h, d, opts) -> dst`, caller-owned,
  allocation-free, combo/metric resolved once.
- **Tileability (0006)**: `tileableCell3` wraps integer cell coords mod
  `(periodX, periodY, periodZ)`, exact; three tiling 3D kernels.

Because it is a lift, the record set does not grow: 0007 is the last decision, and it
is mostly a pointer to the other six saying "again, in R^3".

## Decision 3: separate 2D and 3D kernels, never a dimension parameter

Do not write one kernel that loops `for each of D dimensions`. A variable dimension
means variable loop bounds and a coordinate array (`coords[i]`) -- dynamic length,
GC-visible, and polymorphic across call sites. It would trade the entire zero-alloc
monomorphic-loop identity for code-golf. 2D and 3D are **separate, fully-inlined
kernel families** (three plain + three tiling each), exactly as 0001 keeps the three
metrics as separate functions. Twelve kernels total across both dimensions; the
duplication buys monomorphism, which is the package.

## Decision 4: no module 3D surface, no 4D

- The module free surface stays 2D euclidean `cellular2` + `seedCellular` (C1). 3D is
  **instance-only** -- consistent with C2's instance-only baker, and 3D callers want
  metric/jitter control anyway.
- **No 4D, ever.** 81 cells is a different cost regime and there is no texture use
  case that a 3D field plus a time offset does not already serve. Out of scope,
  permanently, not "deferred".

## Why not the rejected shapes

- **3D in v1.0.0** -- bloats the core, doubles the golden surface before the 2D API
  has settled, risks a two-dimension API mistake. Rejected: fast-follow.
- **Never ship 3D** -- the volumetric use cases are real and the lift is cheap and
  mechanical. Rejected: build it, on the same bar.
- **A generic N-D kernel** -- kills monomorphism and zero-alloc (dynamic bounds,
  coord arrays). Rejected: separate inlined 2D/3D families.

## Hot path

`cellular3`/`tileableCell3`/`fillCellField3`: a fixed 27-iteration loop, scalar-only,
one bound-kernel indirect call per query (off the loop), no allocation, no metric or
combo branch in the loop. 3x the 2D work by cell count, same zero-alloc shape. The 2D
path is entirely untouched. T6 gates all 3D surfaces incl. `maxArrayBuffersGrowth: 0`.

## Measured

Greenfield: no before. The binding contract is the alloc gate on every 3D surface
(`maxBytesPerCall: 0` via `measureAllocs` + `maxArrayBuffersGrowth: 0`; the design
lock's `bytesPerOp: 0` shorthand is not a real profiler rule) -- proven in torture T6
across `cellular3`/`tileableCell3`/`fillCellField3`, plain and tiling, each combo,
plus the `dst.buffer.byteLength` assert. Measured at v1.2.0 (best-of-5, node v26.3.1,
Apple Silicon; throughput is INDICATIVE, the alloc gate is the contract):

| probe | Mops/s | bytesPerCall |
| --- | --- | --- |
| `cellular3` euclidean | ~4.8 | 0 |
| `cellular3` manhattan | ~4.1 | 0 |
| `cellular3` chebyshev | ~4.0 | 0 |
| `tileableCell3` euclidean (8x8x8) | ~4.2 | 0 |
| `fillCellField3` plain (24^3, per combo) | ~11.6 Mvoxel/s | 0 |
| `fillCellField3` tiling (24^3, per combo) | ~5.4 Mvoxel/s | 0 |

Backfill (v1.3.0, 0008): widening euclid/manhattan 3D to the 5x5x5 = 125-cell
neighbourhood (chebyshev stays 3x3x3 = 27-cell) re-measures (best-of-5, node v26.3.1;
see `bench/BASELINE.md`):

| probe (v1.3.0) | Mops/s | bytesPerCall |
| --- | --- | --- |
| `cellular3` euclidean | ~1.58 | 0 |
| `cellular3` manhattan | ~1.61 | 0 |
| `cellular3` chebyshev (unchanged, radius 1) | ~3.75 | 0 |
| `tileableCell3` euclidean (8x8x8) | ~1.33 | 0 |
| `fillCellField3` plain (24^3, per combo) | ~2.76 Mvoxel/s | 0 |
| `fillCellField3` tiling (24^3, per combo) | ~1.56 Mvoxel/s | 0 |

The ~3.0x euclid drop is the 125/27 cell-count ratio; chebyshev is untouched and now
the fastest 3D metric. Alloc contract unchanged: 0 bytes/call on every 3D surface.

The prediction held: `cellular3` euclidean at ~4.8 Mops/s against the 2D kernel's
~14.3 is a 3.0x ratio -- exactly the 27/9 cell-count ratio, the "~3x the per-query
work" this record forecast, with no per-query allocation. The 3D goldens are
`euclidean3` `7bac7c6f`, `manhattan3` `f1b621b5`, `chebyshev3` `1682d095`. See
`bench/BASELINE.md`.

## Consequences

- `cellular3`, `fillCellField3`, `tileableCell3` ship in v1.2.0, instance-only,
  returning the 2D shapes plus depth.
- Twelve inlined kernels across 2D+3D; the 2D path is byte-unchanged.
- Goldens gain three 3D-metric digests; T0/T3/T5/T6/T7/T9 gain 3D coverage; C4's
  cross-product includes the 2D-vs-3D axis.
- The decision set closes at 0007 -- 3D added no new design, only a dimension.

*Anchor D-07 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
