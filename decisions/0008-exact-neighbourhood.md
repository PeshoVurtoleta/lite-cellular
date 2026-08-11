# 0008 -- exact per-metric neighbourhood: widen euclid/manhattan to 5x5, keep chebyshev at 3x3 (C4, v1.3.0)

Status: accepted, 2026-08-10. Implemented in v1.3.0 (C4). Supersedes the "the fixed
  3x3 / 3x3x3 neighbourhood is guaranteed to contain the true f1/f2" claim carried by
  0001, 0002, 0003 and 0007 -- that claim is true only for chebyshev. The T-ORACLE
  torture tier proves the widened kernel bit-for-bit against a radius-3 brute scan.
Anchor: D-08 (ROADMAP.md section 2)
Owner: C4
Depends on: 0001 (metrics), 0003 (jitter/placement), 0007 (the 3D lift this widens too)

This record fixes a real correctness finding that C4's own sufficiency oracle
surfaced, and pins the fix: the neighbourhood radius is now EXACT per metric, not a
uniform "one ring".

## Problem

Every prior record stated that `jitter <= 1` -- which keeps each feature point inside
its home cell -- makes the fixed 3x3 (2D) / 3x3x3 (3D) neighbourhood scan sufficient:
guaranteed to contain the TRUE nearest and second-nearest feature point. That claim is
FALSE for euclidean and manhattan.

The reason is geometric, not a coding bug. A feature point confined to its cell can
still be the true nearest to a query in a cell TWO away, because an L1 or L2 ball can
reach past the immediate ring of neighbours. An L-inf (chebyshev) ball cannot -- its
reach along every axis is bounded by the same radius -- so chebyshev is exactly
sufficient at radius 1, but euclid/manhattan are not.

Measured miss-rate of the shipped 3x3 / 3x3x3 kernel against a wide brute-force oracle
(verbatim hashes + `cell + 0.5 + jitter*(u-0.5)` placement, jitter = 1, the tightest
case), f1/f2/id compared bit-for-bit:

| metric | 2D f1 miss-rate | manhattan worst |  3D f1 miss-rate | chebyshev |
| --- | --- | --- | --- | --- |
| euclidean | ~2e-6 | -- | ~1e-5 (3D) | -- |
| manhattan | ~2e-4 | up to ~0.43 cell | ~5e-3 (3D) | -- |
| chebyshev | 0 | -- | 0 | exact at radius 1 |

A concrete replay (manhattan, seed 1337, jitter 1): query
`(529.9067201604814, -172.90110998990917)` -> the shipped 3x3 kernel returns
`f1 = 1.192461487806213`, but the true nearest feature (in a cell outside the 3x3)
is at `f1 = 1.132218858956548`. The kernel silently reported a farther point as
nearest. Rare, but wrong, and the docs promised it could not happen.

## Decision: widen euclid/manhattan to radius 2 (5x5 / 5x5x5); leave chebyshev at radius 1

The exact radius is PROVEN, not guessed -- a verbatim-hash brute force comparing scan
radii 1 vs 2 vs 3 vs 4 over 2,000,000 ops (2D) and 400,000 ops (3D) at jitter 1, with
f1/f2/id all compared:

| metric | R1 vs R2 diffs | R2 vs R3 | R3 vs R4 | exact radius |
| --- | --- | --- | --- | --- |
| euclidean 2D | 233 | 0 | 0 | 2 (5x5) |
| manhattan 2D | 6919 | 0 | 0 | 2 (5x5) |
| chebyshev 2D | 0 | 0 | 0 | 1 (3x3) |
| euclidean 3D | 12 | 0 | 0 | 2 (5x5x5) |
| manhattan 3D | 1927 | 0 | 0 | 2 (5x5x5) |
| chebyshev 3D | 0 | 0 | 0 | 1 (3x3x3) |

Radius 2 is not merely "better than radius 1" -- it is STABLE (R2 == R3 == R4), i.e.
the true answer never sits farther than two cells for L1/L2 under `jitter <= 1`. So:

- **The eight euclid/manhattan kernels** (`_cellular2Euclid`, `_cellular2Manhattan`,
  `_tileableCell2Euclid`, `_tileableCell2Manhattan`, and the four 3D counterparts)
  widen from a `-1..1` loop to `-2..2`: 9 -> 25 cells (2D), 27 -> 125 (3D). Placement,
  scan order, the `id` tie-break, the tileable local frame, and the integer-cell
  `_wrap` are otherwise byte-for-byte the same -- only the loop bounds grow.
- **The four chebyshev kernels stay at radius 1**, byte-unchanged. Widening them would
  cost speed and move their goldens for zero correctness gain. Their two goldens
  (`chebyshev` `5e5cbfa6`, `chebyshev3` `1682d095`) re-derive byte-identical -- a
  positive signal that only the intended kernels changed.
- The bakers (`fillCellField2/3`) call the bound kernel (`this._kernel` / `_kernel3`),
  so they inherit the fix with no separate edit.

The neighbourhood is now EXACT for every metric: chebyshev in 3x3 / 3x3x3, euclid and
manhattan in 5x5 / 5x5x5. The docs (README, llms.txt, `Cellular.d.ts`) are corrected
to state this per metric; the false uniform "3x3 is sufficient" claim is retired.

## Why not the rejected shapes

- **Leave the kernel, reframe the docs to "bounded approximation".** Honest, and the
  3x3 Worley scan is the common convention -- but the library's entire value is
  correctness at zero allocation, and an exact answer was one loop-bound away. Pinning
  a known-wrong result when the fix is cheap is the wrong trade. Rejected: fix it.
- **Widen ALL metrics to 5x5 uniformly.** Simpler code, but pays euclid/manhattan's
  cost on chebyshev for nothing, and needlessly moves the two chebyshev goldens.
  Rejected: widen only where the geometry requires it.
- **An opt-in exact mode (new API), fast 3x3 default.** New surface, a C4 non-goal,
  and it leaves the default silently wrong. Rejected: exact IS the default.
- **4D.** Still out, permanently (0007). This record does not reopen it.

## Hot path

Each query is still one bound-kernel indirect call OFF a fixed, scalar-only,
zero-alloc loop with no metric or combo branch inside it -- the loop is simply larger
for euclid/manhattan (25 / 125 iterations instead of 9 / 27). Chebyshev is unchanged.
T6 gates `maxBytesPerCall: 0` and `maxArrayBuffersGrowth: 0` across every surface,
2D and 3D, after the widening; the alloc contract is untouched.

## Measured

The cost is the cell-count ratio: euclid/manhattan pay 25/9 = ~2.78x (2D) and
125/27 = ~4.63x (3D) more distance evaluations per query; chebyshev is unchanged. Both
paths remain zero-alloc. Real best-of-5 throughput across the whole surface is in
`bench/BASELINE.md` (node version + machine noted there) and backfilled into the
Measured tables of 0001 and 0007. The binding contract is not the throughput -- it is
(a) `maxBytesPerCall: 0` on every surface and (b) the T-ORACLE tier: the shipped
kernel equals a radius-3 brute-force scan bit-for-bit over 100k+ mixed ops, all
metrics, `jitter` swept `[0,1]`, ZERO divergences. The T9 `CELLULAR_TORTURE_BREAK_
PRECISION` control narrows the kernel back to radius 1 and MUST make the oracle fail --
proving the oracle actually tests sufficiency rather than tautologically passing.

## Consequences

- Exact `f1`/`f2`/`id` for all three metrics in both dimensions; the 3x3-sufficiency
  claim in 0001/0002/0003/0007 is superseded (a pointer added to each, history intact).
- v1.3.0 is a MINOR bump: the euclid/manhattan kernels change behaviour in the rare
  cases, so it is not a patch. The four euclid/manhattan goldens re-derive from the
  widened kernel; their committed digests happen to be unchanged because the golden
  COORDS sample does not land on a rare miss -- the goldens pin the common case, the
  ORACLE proves the rare one. The two chebyshev goldens are byte-identical.
- euclid/manhattan queries and bakes are ~2.78x (2D) / ~4.63x (3D) slower by cell
  count; chebyshev throughput is unchanged. Zero allocation everywhere, still.
- The decision set closes at 0008. It adds no API, no metric, no dimension -- only the
  correct radius for the metrics that needed it.

*Anchor D-08 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
