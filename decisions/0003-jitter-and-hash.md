# 0003 -- jitter range + the cell hash (C1, v1.0.0)

Status: accepted, 2026-08-08. Implemented in v1.0.0 (C1); the golden pins the exact
  draw and the Measured table below is filled from the built kernel.
Anchor: D-03 (ROADMAP.md section 2)
Owner: C1 (mechanics stood up in C0)
Depends on: C0 (the euclidean kernel that first placed feature points)
Depended on by: 0001-metric-selection (all three metrics share this placement),
  0004-cell-id (the id is a by-product of the same hash), and D-06 tileability
  (the wrap is exact only because the hash is a pure function of integer cell coords)

Forward-dated on purpose (see 0001). This record fixes two things the whole
package's determinism rests on: how far a feature point may move off its cell,
and how the cell decides where its point goes.

## Problem

Cellular noise scatters one feature point per grid cell and answers queries from
the 3x3 neighbourhood of cells around the query point. Two decisions inside that
sentence are load-bearing and easy to get silently wrong:

1. **How far the point moves (`jitter`).** If a point can leave its home cell,
   the 3x3 neighbourhood is no longer guaranteed to contain the true nearest
   point -- a query near a cell corner could have its real F1 owner two cells
   away, unscanned. The result is a wrong `f1` on some fraction of queries, with
   nothing to detect it. So `jitter` is not a free knob; its range is a
   **correctness precondition of the fixed-size loop**.

2. **How the cell places its point (the hash).** The point must be a
   deterministic, well-distributed, allocation-free function of the integer cell
   coordinates and the seed. A weak hash produces visible axis-aligned streaks
   and cell-to-cell correlation (the classic bad-Worley look); a non-deterministic
   or float-position-dependent one breaks goldens and tileability.

## Decision 1: `jitter` in `[0, 1]`, validated once, immutable, fail-closed

`jitter` defaults to `1`, is validated **at construction** (finite and
`0 <= jitter <= 1`, else a library `Error`), stored as a scalar, and is
**immutable** for the instance's life -- symmetric with the metric (0001), and
for the same reason: the feature field is a pure function of `(seed, jitter)`, so
freezing it keeps the instance deterministic. To sweep jitter, create instances,
or use the C2 field baker (which takes `jitter` per bake).

The bound is **not cosmetic clamping -- it is the loop's correctness contract**:

- `jitter <= 1` keeps every feature point inside its home cell (Decision 2), which
  is exactly the condition under which the 3x3 neighbourhood is guaranteed to
  contain the true F1 and F2. `jitter = 1` is the boundary: the point may sit
  anywhere in `[0,1)^2` of its cell, still inside it.
- `jitter > 1` would let points escape their cell, silently voiding the F1/F2
  guarantee for near-corner queries. It **throws** rather than clamps: a caller
  passing `1.5` has a bug, and failing closed surfaces it at setup instead of as a
  rare wrong distance three frames into a bake.
- `jitter < 0` mirrors the offset -- meaningless -- and throws for the same reason.

`jitter = 0` is a deliberately useful control, not a degenerate case: it is a
perfect grid of cell centres (Decision 2), which callers use for regular
patterns and for the T0 grid-distance law.

## Decision 2: placement convention -- centre plus jittered offset

The feature point of cell `(cx, cy)` is:

```
fx = cx + 0.5 + jitter * (u - 0.5)
fy = cy + 0.5 + jitter * (v - 0.5)      with u, v in [0, 1) from the hash
```

- `jitter = 0`  -> `(cx + 0.5, cy + 0.5)`: the exact cell centre. A regular grid.
- `jitter = 1`  -> `(cx + u, cy + v)`: uniform anywhere in the cell. Full Worley.
- in between: a linear interpolation from centre-grid to full-scatter, the point
  always within `[cx, cx+1) x [cy, cy+1)`.

Centre-anchored (`0.5 + jitter*(u-0.5)`), not corner-anchored (`jitter*u`), so
that `jitter = 0` is a centred grid rather than all points collapsing onto cell
corners -- the centred grid is the one callers actually want as the "no jitter"
reference, and it keeps the point maximally inside its cell at low jitter.

## Decision 3: the hash -- integer cell coords + seed, two decorrelated draws, no table

```
u = (_hash (cx, cy, seed, axis U) >>> 0) / 4294967296     // in [0, 1)
v = (_hash (cx, cy, seed, axis V) >>> 0) / 4294967296
```

Locked properties (the coder picks the exact constants; the golden pins the
result, so a constant change is a breaking change):

- **Over integer cell coords, never the float query position.** `cx = floor(x)`,
  `cy = floor(y)`. This is what makes the point per-cell and the field stable
  under sub-cell query motion.
- **Seed folded into the mix**, not held in a permutation table. lite-noise owns
  a 512-byte `Uint8Array` perm table per instance because it permutes a fixed
  lattice; cellular scatters one point per cell **on demand**, so there is no
  lattice to permute and **no per-instance table** -- the instance holds only the
  scalar seed. This is a deliberate divergence from the lite-noise shape, and it
  is why a `Cellular` instance's only owned allocation is its reused out-struct.
- **Two decorrelated 32-bit draws** for `u` and `v` (distinct salts/constants per
  axis), so the point is not pinned to a diagonal. Integer-only mixing
  (`Math.imul` + xorshift, modelled on `Noise.js` `_seedPerm`), allocation-free.
- **Deterministic and bit-for-bit stable**: same `(seed, cx, cy)` always yields
  the same `(u, v)`. This is THE anchor -- goldens, instance-vs-module equality
  (C1), reseed reproducibility, and the exact tileable wrap (D-06) all reduce to
  it.
- **Correct for negative cell coords.** Near and below the origin `cx`/`cy` are
  negative; the int32 mixing must distribute them as well as positives (no sign
  artefact along the axes). T0 samples straddling zero assert it.

Non-finite query coords are rejected at the door before `floor` (the C0 guard);
`floor` is never handed a `NaN`.

## Why not the rejected shapes

- **Unbounded / clamped `jitter`** -- clamping `> 1` down to `1` hides a caller
  bug and still risks the near-corner miss at exactly the clamp boundary if the
  clamp is applied loosely. Throwing is the fail-closed choice the Law requires.
- **Corner-anchored placement** (`jitter * u`) -- makes `jitter = 0` collapse all
  points to cell corners, a useless reference grid, and biases low-jitter fields
  toward the lower-left. Rejected for the centred form.
- **A permutation table like lite-noise** -- would add a per-instance allocation
  and a table lookup per neighbour for zero benefit; there is no lattice to
  permute. Rejected.
- **Hashing the float position** -- would make the point move continuously with
  the query, which is not cellular noise at all. Rejected (it is the bug, not an
  option).

## Hot path

Per neighbour: two integer hashes (or one hash yielding two draws), two divides to
`[0,1)`, the placement arithmetic, one distance term (0001). No branch on
`jitter`, no table lookup, no allocation. `jitter` is a loop-invariant scalar
argument; the validation that bounds it ran once at construction and is not on the
query path. Provable by reading the kernel and by T6.

## Measured

Greenfield: no before. The binding contract is the alloc gate
(`maxBytesPerCall: 0` via `measureAllocs`, `maxArrayBuffersGrowth: 0`; the design
lock's `bytesPerOp: 0` shorthand is not a real profiler rule) plus two
**distribution** checks the golden alone does not give. Measured at v1.0.0 over
640,000 cells (`cx, cy` in `[-400, 400)`, seed 42, 16 bins):

- **Uniformity.** `mean(u) = 0.50038`, `mean(v) = 0.50042` (ideal 0.5).
  Chi-square (16 bins, df=15, 0.05 critical ~25.0): `u = 16.8`, `v = 13.8` -- both
  well under the critical value, i.e. no rejection of uniform. The 2D joint
  chi-square (256 cells, df=255, 0.05 critical ~293) is `235.8`: also under, so the
  join is uniform, not banded.
- **Decorrelation.** `corr(u, v) = 0.00034` (ideal 0) -- the two draws are
  independent, so the feature point is not pinned to a diagonal and there is no
  axis-aligned streaking at low jitter.

Throughput (best-of-5, indicative; the alloc gate is the contract) -- the same
placement runs under all three metrics, so the figures are per 0001:
`cellular2` euclidean ~14.7 Mops/s, manhattan ~9.5, chebyshev ~8.5, module ~14.7;
`bytesPerCall = 0` on all four. See `bench/BASELINE.md`.

## Consequences

- `createCellular` validates `jitter` at construction and can throw there;
  `jitter` is immutable per instance (no `setJitter`), mirroring the metric.
- A `Cellular` instance owns exactly one allocation: its reused out-struct. No
  perm table. This is the retention surface T7 gates.
- `jitter = 0` is a supported, tested regular grid (T0 grid-distance law), not an
  edge case.
- The hash constants, once chosen, are pinned by the goldens; changing them is a
  breaking change with a CHANGELOG note.
- Placement is metric-independent (0001) and the sole basis of the cell id (0004)
  and the exact tileable wrap (D-06, C2).

*Anchor D-03 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
