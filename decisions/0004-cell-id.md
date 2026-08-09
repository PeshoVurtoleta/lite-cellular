# 0004 -- the cell id: F1 owner's hash, SMI-safe (C1, v1.0.0)

Status: accepted, 2026-08-08. Implemented in v1.0.0 (C1); the golden pins `id`.
Anchor: D-04 (ROADMAP.md section 2)
Owner: C1 (produced by the C0 kernel)
Depends on: 0003-jitter-and-hash (id is a by-product of that hash),
  0001-metric-selection (the F1 owner is metric-dependent)

Forward-dated on purpose (see 0001). This record fixes what the third return
value of `cellular2` -- `id` -- means, how it is derived, and its integer type.

## Problem

`cellular2(x, y, out)` returns `{ f1, f2, id }`. `f1`/`f2` are settled (distances,
0001). `id` exists so a caller can flat-shade Voronoi regions -- assign one colour
per cell -- **without a second query**. For that to work `id` must be:

- **stable per region**: identical for every query point whose nearest feature
  point is the same cell's, and different across cells; and
- **cheap**: free of any extra hashing or a second neighbourhood scan; and
- **a clean integer key**: usable directly as a `Map` key or a colour seed without
  boxing into a heap double (the AR-01 lesson from the remediation roadmap: an
  unsigned handle above 2^31 leaves the SMI range and allocates).

The open question is what integer identifies the owner cell.

## Decision 1: `id` = the F1 owner's primary hash, coerced to signed int32

The 3x3 loop already computes, for each neighbour cell, the primary hash used for
that cell's `u` (0003). When a neighbour becomes the new nearest (the `f1`
compare-and-swap), its primary hash is captured. At the end:

```
out.id = hOwner | 0;      // signed int32, SMI-safe, allocation-free
```

`| 0` (not `>>> 0`): the signed int32 form stays inside V8's small-integer range,
so `id` is a fast integer both as a return value and as a `Map`/`Set` key. Its
sign carries no meaning -- it is an **opaque, stable tag**, compared only for
equality. This is the same signedness discipline AR-01 settled for lite-arena's
handles: prefer the SMI-safe signed form over an unsigned value that boxes.

It costs **nothing extra**: the hash is already in a local from the placement
step, so `id` is one capture on the swap and one `| 0` at the end -- no second
hash, no second scan.

## Decision 2: semantics -- opaque tag, metric-dependent owner, deterministic ties

- **Opaque, not coordinates.** `id` is the owner's hash, not its packed
  `(cx, cy)`. Callers use it as a region tag / colour seed, not to recover cell
  coordinates. Recovering coordinates is a separate feature (a future `cellOf`
  returning `cx, cy`), deliberately out of scope here.
- **Stable within a region, changes at boundaries.** Because the hash is a pure
  function of the owner cell (0003), `id` is constant across every query point in
  that F1 region and flips exactly at the Voronoi boundary. T0 asserts this
  directly (many samples inside one cell -> one `id`; across cells -> differing).
- **The owner is metric-dependent.** The nearest cell under manhattan can differ
  from the nearest under euclidean for the same query, so two instances with the
  **same seed but different metrics** may report different `id` at the same point.
  That is correct: `id` names the F1 owner *under this instance's metric* (0001),
  not a metric-free cell identity. Pinned so it is a documented property, not a
  surprise.
- **Ties are broken by scan order.** When two feature points are exactly
  equidistant (an `f1` tie -- reachable at `jitter = 0` on a boundary), the loop's
  strict `d < f1` keeps the **first** cell in the fixed `gy = -1..1, gx = -1..1`
  scan order. The tie-break is therefore deterministic and stable, so `id` (and
  `f1`) are reproducible on boundaries and the golden is exact. This is a property
  of the scan order, so the scan order is itself now load-bearing and must not be
  reordered without regenerating goldens.

## Why not the rejected shapes

- **Packed cell coordinates** `((cx & 0xFFFF) << 16) | (cy & 0xFFFF)` -- reversible
  and collision-free, but only within a +/-32768 cell window; at world scale the
  coords exceed 16 bits and two distant cells collide, or the pack wraps. It also
  trades the free hash for extra arithmetic. Rejected: the hash is free, full
  32-bit range, and the use case (a colour/region tag) does not need reversibility.
- **`>>> 0` (unsigned)** -- values above 2^31 leave the SMI range and box as heap
  doubles, so `id` as a `Map` key could allocate. Exactly the AR-01 trap. Rejected
  for `| 0`.
- **A dedicated id hash** (hash the owner again with different constants) -- a
  second mix per swap for no benefit; the primary hash is already a good,
  well-distributed 32-bit value. Rejected as invented cost.
- **F2 owner or a combined id** -- `id` names the region a point belongs to, which
  is the F1 cell by definition. F2's owner is not a region identity. Rejected.

## Hot path

`id` adds, per query: one local capture inside the existing `f1` swap branch, and
one `| 0` after the loop. Zero allocation, no extra hash, no extra branch beyond
the swap that already exists. Provable by diff against the id-free C0 kernel: the
loop gains a single assignment on the already-taken swap path. T6 gates it.

## Measured

Greenfield: no before. Contract is the alloc gate (`maxBytesPerCall: 0` via
`measureAllocs`; the design lock's `bytesPerOp: 0` shorthand is not a real profiler
rule) -- the `id` capture and `| 0` must not perturb it, and measured at v1.0.0 it
does not: 0 bytes/call on all three metrics (see `bench/BASELINE.md`). The `| 0`
keeps `id` a signed int32 inside V8's SMI range (T7's boundary sweep observes
negative ids, confirming `| 0` is not a no-op cast). All three goldens (0001/C1)
include the `id` stream, so any drift in owner selection or derivation is a golden
break. No throughput claim is made for a single field write.

## Consequences

- `cellular2` returns `{ f1, f2, id }` with `id` a signed int32, SMI-safe, opaque,
  stable per Voronoi region.
- The neighbourhood **scan order is load-bearing** (tie-break); reordering it is a
  breaking change requiring golden regeneration.
- `id` is metric-dependent by design; documented, not a bug.
- Cell-coordinate recovery (`cellOf`) is explicitly deferred, not precluded.
- `cellular3` (C3) carries the identical rule with the 3x3x3 scan order as its
  tie-break.

*Anchor D-04 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
