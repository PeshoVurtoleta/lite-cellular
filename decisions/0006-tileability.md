# 0006 -- tileability: wrap integer cell coords mod period, exactly (C2, v1.1.0)

Status: accepted, 2026-08-09.
Anchor: D-06 (ROADMAP.md section 2)
Owner: C2
Depends on: 0003-jitter-and-hash (the wrap changes ONLY the hash's coord inputs;
  placement, distance, jitter, id are unchanged), 0001-metric-selection (a tiling
  kernel per metric), 0005-field-baker-ownership (a tileable bake is this wrap in
  that loop)

Forward-dated (see 0001). Contrast model: `../LiteNoise/Noise.js` `_tileableField2`,
whose gradient wrap is algebraic-but-not-bit-exact (a float-period, grid-alignment
precondition, seamless only to ~1e-14). Cellular does strictly better.

## Problem

A tiling texture must repeat with no visible seam. lite-noise's gradient tile
wraps by sampling a periodic lattice; it is seamless to float epsilon, and
`lite-patternforge.seamlessScore` still reads a ~0.06 floor on it from local
contrast at the seam column. Cellular can do better **by construction** -- but only
if the wrap is decided correctly, and it is easy to botch into the same epsilon
regime (e.g. by wrapping the float query coordinate instead of the integer cell).

## Decision 1: wrap the integer CELL coordinates, mod an integer period

`tileableCell2(x, y, periodX, periodY, out?) -> { f1, f2, id }` is `cellular2`
with exactly one change: before hashing, each neighbour's integer cell coordinate
is reduced modulo the period, with a positive modulo so negative cells near the
origin wrap correctly:

```
function _wrap(c, P) { return ((c % P) + P) % P; }        // integer in [0, P)
// in the tiling kernel's 3x3 loop:
const h = _hash2(_wrap(cx, periodX), _wrap(cy, periodY), seed);
```

`periodX`/`periodY` are the tile size **in cells** and must be **positive
integers**. `_hash2` already keys on integer cell coords (0003), so the reduced
coord is still an exact integer and the hash of cell `P` equals the hash of cell
`0` **bit-for-bit**. Everything downstream -- feature-point placement, the distance
metric, `jitter`, `id` -- is unchanged (0003/0001/0004).

## Decision 2: the wrap is EXACT, and that is the whole point

Because the reduction is integer modulo (no float period, no grid-alignment
precondition), the feature points wrap with `===`, not with epsilon. Two
consequences, both stronger than the gradient tile:

- **Exact periodicity.** The field at `x` and at `x + periodX` cells is
  bit-identical: the wrapped cells are the same cells, the same points, the same
  distances.
- **Seamless, not merely near-seamless.** At the seam, the 3x3 neighbourhood on
  each side shares the same wrapped feature points, so `f1`/`f2` are continuous
  across it. `lite-patternforge.seamlessScore` should read **genuinely near-zero**
  -- limited by its own metric, not by an epsilon floor. C2 proves this and the
  README documents the contrast with the gradient tile's ~0.06 (0003's determinism
  anchor is what makes it possible: the hash is a pure function of integer cell
  coords, so reducing those coords is lossless).

`id` also wraps: the region tag at cell `0` equals the tag at cell `P` (0004), so
every tile copy flat-shades identically. Correct and useful, documented.

## Decision 3: fail closed on the period; it is required

`periodX`/`periodY` are validated at the call boundary and **throw** a library
`Error` unless each is a **positive integer** (`Number.isInteger(p) && p >= 1`).
This rejects `0`, negatives, non-integers, `NaN`, and `Infinity`. There is no
default -- a tile with no size is meaningless (the same "period is required,
no sensible default" stance as `_tileableField2`, made stricter: cellular's tile
is a whole number of cells, so a non-integer period is a caller error, not a
grid-alignment caveat).

## Decision 4: a tiling kernel per metric, bound like the plain ones (0001)

The wrap lives in **three tiling kernels** (`_tileableCell2Euclid` /
`_Manhattan` / `_Chebyshev`), parallel to C1's three plain kernels, differing only
by the `_wrap` on the two hash inputs. The instance binds `this._tileKernel`
(metric-selected) at construction alongside `this._kernel`. So the **plain
`cellular2` path pays nothing** for tileability (no modulo, no branch -- 0001's
clean hot loop is untouched), and `tileableCell2` / a tiling bake run a monomorphic
loop with the modulo inlined. Six inlined kernels total; the duplication is
deliberate, for the same monomorphism reason 0001 keeps three.

## Why not the rejected shapes

- **Wrap the float query position** (`x mod period`) -- reintroduces float epsilon
  at the seam and lands cellular back in the gradient tile's ~0.06 regime, throwing
  away the one advantage. Rejected: wrap the integer cell, not the float coord.
- **A float period + grid-alignment precondition** (the `_tileableField2` shape) --
  necessary for the lattice noise, unnecessary and weaker here; cellular's cells are
  integers, so an integer period gives an unconditional exact wrap. Rejected.
- **A `wrap` flag inside the plain kernels** -- puts a modulo + branch in the
  per-query hot loop for every non-tiling caller. Rejected: separate tiling kernels
  keep the plain path free (0001).
- **Clamp/round a non-integer period** -- hides a caller bug and makes the tile
  size not what was asked. Rejected: throw (fail closed).

## Hot path

`tileableCell2` and a tiling bake: per neighbour, two integer `_wrap` reductions
feeding the same `_hash2`/`_hash2b`, then the unchanged placement + distance. No
allocation, no string, one bound-kernel indirect call per query (off the loop).
The plain `cellular2` path is byte-for-byte unchanged from C1. T6 gates the tiling
bake at `maxArrayBuffersGrowth: 0`; T0 gains the exact-wrap laws.

## Measured

Greenfield: no before. Contract is the alloc gate plus a **seam proof**, not
throughput.

**Exact periodicity (torture T0).** `tileableCell2(x,y,P,Q)` is bit-identical to
`(x+P,y,P,Q)` and `(x,y+Q,P,Q)` for f1/f2/id, all three metrics, across a dyadic
corpus (integer part + j/64 fraction, bases straddling zero). `===`, not epsilon.
Implementation note that made this real: the tiling kernels compute the distance in
the query cell's LOCAL frame (`rx = x - floor(x)`, feature offset `gx + 0.5 +
jitter*(u-0.5)`), not the absolute frame `fx - x` -- the absolute frame loses the low
bits at the shifted magnitude and would wrap only to float epsilon (the anti-pattern
this record rejects). `id` is exactly periodic on ANY coord (a pure integer-cell hash).
The T9 float-wrap control (a kernel that hashes the UNWRAPPED cell) is NOT periodic,
so the law can fail.

**Seam proof (torture T8 / `examples/seamless-tile.mjs`).** A 256x256 period-4
cellular tile, coloured through `gradientOcean`, scored by
`@zakkster/lite-patternforge` `seamlessScore` (lower better; < 0.02 imperceptible):

| tile | seamlessScore overall |
| --- | --- |
| cellular `fillCellField2` (exact integer-cell wrap) | ~0.012 |
| lite-noise `tileableField2` fbm (lattice wrap, same paint) | ~0.024 |

Genuinely near-zero and materially below the gradient tile: the exact wrap makes the
seam step equal a normal interior step. Throughput (best-of-5, node v26.3.1):
`tileableCell2` euclidean ~10.8 Mops/s; a tiling 64x64 bake ~5.8-6.0 K fields/sec
(~24 Mpx/s), ~half the plain rate -- the two `_wrap` reductions per neighbour.
`bytesPerCall: 0` throughout.

## Consequences

- `tileableCell2(x, y, periodX, periodY, out?)` returns `{ f1, f2, id }`, exactly
  periodic and seamless; periods are required positive integers (throw otherwise).
- Three tiling kernels + `this._tileKernel`; the plain path is unaffected.
- `fillCellField2` with `opts.periodX`/`periodY` bakes a seamless tile (0005's loop
  running the tiling kernel); without them, a plain field.
- The seamlessScore contrast with the gradient tile is a documented, tested claim,
  not marketing.
- `tileableCell3` (C3) carries the identical wrap over the 27-cell scan.

*Anchor D-06 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
