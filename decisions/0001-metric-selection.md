# 0001 -- Metric selection: integer id, one kernel per metric, branch-free loop (C1, v1.0.0)

Status: accepted, 2026-08-08. Implemented in v1.0.0 (C1); the Measured table below
  is filled from the built kernel.
Anchor: D-01 (ROADMAP.md section 2)
Owner: C1
Depends on: C0 (the euclidean kernel + torture skeleton this generalises)

> Superseded in part by 0008 (2026-08-10, v1.3.0): the per-query loop is no longer a
> fixed 3x3 (9-cell) scan for every metric -- euclid/manhattan widened to 5x5 (25-cell)
> for exactness, chebyshev stays 3x3. The monomorphic one-kernel-per-metric design here
> is unchanged; only the loop RADIUS moved. Read "3x3 loop" below as "the neighbourhood
> loop at each metric's exact radius".

This record is written before C1 opens, to lock the shape of the hot loop while
it is still one kernel. It is forward-dated on purpose: `Cellular.js` will cite it
when the second and third metrics land, and per ROADMAP.md section 0.4 the cited
file must already be in the tree. The coder implements to this; the reviewer holds
the diff to it.

## Problem

`cellular2` must support three distance metrics -- euclidean, manhattan,
chebyshev -- and the choice must not cost the hot path. The hot path is a fixed
3x3 (9-cell) loop per query; a naive design branches on the metric inside that
loop, so every query pays 9 metric tests, and if the metric is passed as a
string it pays 9 string compares. That is exactly the "instructions in a hot
body" the house Law forbids.

There is a second, quieter trap. If euclidean returns **squared** distance (to
skip the sqrt), then `f1`/`f2` are in squared units for euclidean but linear
units for manhattan and chebyshev. The metric-sanity law (below) and the
caller's `f2 - f1` crack width would then compare and combine incommensurable
units -- a silent correctness hazard dressed as an optimisation.

## Decision 1: the metric is an integer id, fixed at instance creation

```js
export const METRIC_EUCLIDEAN = 0;   // default
export const METRIC_MANHATTAN = 1;
export const METRIC_CHEBYSHEV = 2;
```

`createCellular(seed, { metric })` takes one of these ids. It is validated
**once, at construction**, and stored as a scalar. An unknown id -- including a
string, a float, `null`, or an out-of-range int -- **throws a library `Error`**
that names the valid set (fail closed; null is not zero). The metric is
**immutable** after construction: `reseed(seed)` changes the seed only. To change
metric, create another instance. This keeps the per-instance kernel binding
(Decision 2) constant for the instance's life.

C0 accepts only id `0` and throws on `1`/`2`; C1 opens `1` and `2`. C1 widens the
accepted set -- it never loosens the guard.

## Decision 2: one inlined kernel per metric, bound once -- the loop is monomorphic

Not "branch on the id inside the loop", and not "call a distance function pointer
per neighbour". Both put the metric decision inside the 9-iteration loop -- a
predicted branch nine times, or nine indirect calls that block inlining.

Instead there are **three separate kernels**, each with its metric's distance
expression **inlined** in the loop body:

```js
function _cellular2Euclid(seed, jitter, x, y, out) { /* d2 = dx*dx+dy*dy; sqrt at end */ }
function _cellular2Manhattan(seed, jitter, x, y, out) { /* d = abs(dx)+abs(dy)   */ }
function _cellular2Chebyshev(seed, jitter, x, y, out) { /* d = max(abs(dx),abs(dy)) */ }
```

The constructor resolves the id to exactly one kernel reference, once:

```js
this._kernel = metric === METRIC_MANHATTAN ? _cellular2Manhattan
             : metric === METRIC_CHEBYSHEV ? _cellular2Chebyshev
             : _cellular2Euclid;

cellular2(x, y, out) { return this._kernel(this._seed, this._jitter, x, y, out || this._out); }
```

So the metric decision is **one indirect call per query** -- outside the loop,
dominated by the nine iterations it wraps -- and **zero** metric branches per
neighbour. Each kernel's 3x3 loop is monomorphic: V8 sees one shape, one distance
expression, and inlines it. This is the same "resolve to a function pointer once,
before the loop" pattern D-05 uses for the field baker's combo, and lite-noise's
`_fillField2` uses for its shaping mode.

The three kernels share the feature-point placement verbatim (the same `_hash2`,
the same `cell + 0.5 + jitter*(u-0.5)` from C0) and differ **only** in the one
distance line. Keep them as three functions rather than one metric-parameterised
function even though it repeats the loop scaffold: staying monomorphic is worth
more than the dozen shared lines, exactly as lite-bvh keeps its two rotation
branches written out in full.

## Decision 3: euclidean returns TRUE distance; squared is not a v1 surface

`_cellular2Euclid` accumulates squared distance in the loop (no sqrt per
neighbour) and takes **one sqrt for `f1` and one for `f2` at the end**. It returns
the true euclidean distance, not the squared value.

This is not only simpler -- it is required for correctness of the two things
built on top of the metric:

- **The metric-sanity law** `chebyshev(p) <= euclidean(p) <= manhattan(p)` (the
  pointwise `Linf <= L2 <= L1` inequality) is only meaningful if all three
  metrics report in the same (linear) units. Squared euclidean breaks the chain.
- **The caller's `f2 - f1`** (crack width, the canonical combo) must be in world
  units to be usable as a mask or displacement. Squared units make it meaningless.

A `returnSquared` fast variant that skips the two end-sqrts is a **possible future
addition** (its own decision, its own gate), not a v1 surface. Two sqrts per query
-- off the hot loop, once each -- is not the cost worth trading correctness of the
cross-metric law for.

## Why not the rejected shapes

- **String metric, branched per query** -- 9 string compares per query in the hot
  loop. The thing the Law names explicitly. Rejected.
- **Integer branch inside the loop** -- cheaper than strings, but still 9 branches
  per query and a polymorphic loop body across instances of different metrics.
  Rejected: the branch is avoidable entirely by binding the kernel once.
- **Single distance function pointer called per neighbour** -- moves the branch
  out but replaces it with 9 indirect calls that block inlining of the distance
  math into the loop. Rejected: worse than the branch it removes.
- **Squared euclidean by default** -- see Decision 3. Rejected on unit coherence,
  not on the sqrt cost.

## Hot path

The 3x3 loop of each kernel contains: two `Math.floor`-derived cell coords, the
`_hash2` draws, the feature-point placement, one distance expression, and the
`f1`/`f2`/`id` compare-and-swap. **No string compare, no metric branch, no
allocation.** Provable by reading each kernel and by grep (`grep -n 'metric' `
finds it only in the constructor and the kernel binding, never in a loop body).
The per-query indirect call to `this._kernel` is off the loop and is the only
metric-related instruction on the query path.

T0's metric-sanity law and T6's exact zero-alloc gate enforce this. The gate is
`measureAllocs` `maxBytesPerCall: 0` (per-call RETAINED bytes -- the literal
zero-alloc claim, best-of-5 to shed the rare sub-byte estimator fluke) plus
`measureOps` `maxArrayBuffersGrowth: 0` / `maxMajor: 0`. Note: the design lock's
`bytesPerOp: 0` shorthand is NOT a real profiler rule -- a `measureOps` allocation
RATE has a documented V8 self-noise floor and can never read 0, so C1 uses
`measureAllocs` (`maxBytesPerCall`), the exact tool. T9 ships a control that
branches on a string metric per query and RETAINS the result, so its per-call
allocation must trip the gate (a metric branch that leaks garbage into the hot
body is a measurable regression, so the gate that forbids it must be shown able to
fail).

## Measured

Greenfield: there is no before. The **binding contract is the alloc gate**
(`maxBytesPerCall: 0` via `measureAllocs`, plus `maxArrayBuffersGrowth: 0` /
`maxMajor: 0`) on all three kernels and the module surface, not any ops/sec figure
-- as in the blueprint's records, throughput on a shared box has ~2x run-to-run
variance and is never the contract.

The indicative throughput table (best-of-5, `measureOps({ stabilize: 'deep' })`;
`bytesPerCall` from `measureAllocs`, min-over-batches -- the exact gate), filled
from the built v1.0.0 kernel on node v26.3.1 (see `bench/BASELINE.md`):

| probe | Mops/s (indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular2` euclidean (scattered coords) | ~14.7 | 0 |
| `cellular2` manhattan | ~9.5 | 0 |
| `cellular2` chebyshev | ~8.5 | 0 |

Backfill (v1.3.0, 0008): after widening euclid/manhattan to the 5x5 = 25-cell
neighbourhood (chebyshev stays 3x3 = 9-cell), the same probes re-measure (best-of-5,
node v26.3.1; see `bench/BASELINE.md`):

| probe (v1.3.0) | Mops/s (indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular2` euclidean | ~6.28 | 0 |
| `cellular2` manhattan | ~4.95 | 0 |
| `cellular2` chebyshev (unchanged, radius 1) | ~7.44 | 0 |

The ~2.2x (euclid) / ~1.7x (manhattan) drop is the 25/9 cell-count ratio; chebyshev,
untouched, is now the fastest metric. The alloc contract is unchanged: 0 bytes/call.

Expectation to confirm, not assume (from the design lock): manhattan and chebyshev
would be marginally faster than euclidean (no end-sqrt). If euclidean is not within
a small constant of the other two, the two end-sqrts are not the reason --
investigate the loop.

**Confirmed the opposite, and investigated as instructed.** Euclidean measured the
FASTEST, not the slowest. The loop investigation found the cost was the metric's
`abs`/`max`, not the sqrt: a data-dependent `dx < 0 ? -dx : dx` ternary
mispredicted on scattered coords and ran ~2x slower than the branchless `Math.abs`
/ `Math.max` intrinsics. Switching to the branchless form (digest-identical --
`dx` is never `-0`, so `Math.abs` and the ternary agree bit-for-bit; all three
goldens re-derive unchanged) brought the metrics within a small constant (~1.7x).
The two off-loop euclidean sqrts cost less than manhattan/chebyshev's two per-
neighbour abs; the end-sqrts were never the driver. The alloc contract holds
exactly: 0 bytes/call on all three kernels and the module surface.

## Consequences

- Public constants `METRIC_EUCLIDEAN` / `METRIC_MANHATTAN` / `METRIC_CHEBYSHEV`
  ship from v1.0.0; `METRIC_EUCLIDEAN` exists as of C0 (v0.1.0) with `1`/`2`
  reserved and rejected by the guard.
- The metric is immutable per instance; there is deliberately no `setMetric`.
- `createCellular` can throw at construction (unknown metric id) -- a setup-time,
  fail-closed signal, never on the hot path.
- euclidean `f1`/`f2` are true distances; `f2 - f1` and the cross-metric law are
  unit-coherent. A future `returnSquared` variant, if ever added, is opt-in and
  does not change this default.
- T0 gains the metric-sanity law; T9 gains the metric-branch-in-loop control.
- Ratifies the C0 working convention for feature-point placement and `id`
  (0003-jitter-and-hash, 0004-cell-id) by depending on it unchanged across all
  three metrics.

*Anchor D-01 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
