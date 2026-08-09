# 0002 -- combination is the caller's: the kernel returns {f1, f2, id} (C1, v1.0.0)

Status: accepted, 2026-08-08. Implemented in v1.0.0 (C1).
Anchor: D-02 (ROADMAP.md section 2)
Owner: C1 (the C0 kernel already returns this shape)
Depends on: 0001-metric-selection (same "no decision inside the hot loop" principle)
Depended on by: 0005-field-baker-ownership (the bake is the ONE sanctioned place a
  `combo` option lives, precisely because it is not the per-query hot path)

Forward-dated on purpose (see 0001). This record fixes the return shape of the
per-query kernel and, just as importantly, what does **not** go into it.

## Problem

Cellular noise's textures are combinations of the two nearest feature-point
distances:

- `f1`         -> blobs / cells (distance to the nearest point)
- `f2 - f1`    -> cracks / cell walls (the Voronoi edges)
- `f2`         -> a softer cell field

The tempting API is a `combo` (or `mode`) parameter on `cellular2` that returns
the single number the caller wants: `cellular2(x, y, COMBO_CRACKS)`. It is the
wrong shape, for the same reason a string metric is (0001) and for one more:
collapsing to a single number **throws away information**.

## Decision: the per-query kernel returns exactly `{ f1, f2, id }`; combos are the caller's

`cellular2` (and `cellular3`, C3) return the three raw values and nothing else.
There is **no `combo`/`mode` parameter** on the per-query call. The textures are
one arithmetic op the caller does on the result:

```js
const c = cell.cellular2(x, y);
const blobs  = c.f1;
const cracks = c.f2 - c.f1;     // one subtraction, in the caller's loop
const soft   = c.f2;
```

Three reasons, in order of weight:

1. **`{f1, f2}` is a strict superset of every combo.** From the two distances the
   caller derives all three textures (and others -- `f1*f2`, `f2/f1`, ...) with one
   op. A pre-combined single return is lossy: given only `f2 - f1` you cannot
   recover `f1` or `f2`, so a caller who wants a second texture from the same field
   must **query again**. Returning the raw pair is strictly more expressive at
   identical cost.

2. **It keeps the hot loop monomorphic and branch-free.** A `combo` enum would
   either branch on the mode per query -- the exact trap 0001 removes for the
   metric -- or force the kernel to compute values the caller discards. Neither is
   acceptable on the hot path. The kernel's job is the neighbourhood scan; the
   combination is arithmetic that belongs where the caller already has a loop.

3. **`f2 - f1` is genuinely one subtraction.** Pushing it into the library buys
   the caller nothing and costs an API surface and a branch. The library earns its
   place on the O(9) scan and the zero-alloc guarantee, not on an operation the
   caller writes in less code than the function call would take.

`f2` is computed in the same 3x3 scan as `f1` -- one extra `else if` in the
compare-and-swap already present in C0 -- so returning the pair is nearly free
versus returning `f1` alone. That near-free second distance is the whole reason
cellular noise beats a plain distance-to-grid; the kernel always computes it.

### The one place `combo` is allowed: the field baker (0005)

The rule is precise, not absolute. `fillCellField2` (D-05, C2) **does** take a
`combo` option, because a bake is **not** the per-query hot path: it resolves
`combo` to a function pointer **once, before the pixel loop**, then runs one
monomorphic loop. That is the same "resolve once, not per iteration" discipline as
0001's kernel binding. So: combo is forbidden as a per-query parameter (this
record) and permitted as a resolved-once bake option (0005). The distinction is
the point, and 0005 depends on this record for it.

## Why not the rejected shapes

- **`combo` parameter on `cellular2`** -- branches per query or precomputes
  discarded work, and collapses `f1`/`f2` into one lossy number that forces a
  re-query for a second texture. Rejected on all three counts.
- **Return `f1` only** (as many minimal Worley snippets do) -- cannot make cracks
  (`f2 - f1`) or the soft field at all, and the second distance is nearly free in
  the same scan. Rejected: it discards the library's main advantage.
- **Return a fat struct with `f2-f1`, `f2*f1`, ... pre-baked** -- computes textures
  most callers do not want, on every query. Rejected as invented per-query cost;
  the caller computes the one combo they need.
- **A higher feature rank (`f3`, ...) in v1** -- a real extension (more nearest
  points), but a separate decision with its own scan-order and alloc cost, not a
  "combo". Out of scope here; the out-struct is exactly `{f1, f2, id}` for v1.

## Hot path

The kernel computes `f1`, `f2` (one extra compare-and-swap branch, present since
C0), and `id` (0004). **No combo branch, no combo parameter, no discarded
computation.** The caller's `f2 - f1` executes in the caller's code, outside the
library. Provable by the `cellular2` signature (three args: `x, y, out?`) and by
reading the kernel. T6 gates that the kernel allocates nothing; there is no combo
surface for it to gate.

## Measured

Greenfield: no before. The binding contract is the alloc gate (`maxBytesPerCall: 0`
via `measureAllocs`; the design lock's `bytesPerOp: 0` shorthand is not a real
profiler rule -- a rate cannot read 0, so C1 gates on retained bytes). Measured at
v1.0.0: the `{f1, f2, id}` kernel allocates 0 bytes/call on all three metrics and
the module surface (see `bench/BASELINE.md` / 0001). The caller-side combo is one
subtraction in the caller's own loop and is not the library's cost to report. No
throughput table of its own.

## Consequences

- `cellular2`/`cellular3` signatures never grow a `combo`/`mode` parameter; the
  out-struct is exactly `{ f1, f2, id }`.
- README and the C2 composability examples show the one-line combos
  (`c.f2 - c.f1`, etc.) rather than a mode enum -- and the recipes that multiply a
  `f2 - f1` field into an fbm do the combination caller-side, demonstrating the
  decision in code.
- `combo` as a resolved-once option is confined to the field baker (0005); this
  record is what 0005 points to for why it may not appear per-query.
- Adding a third feature rank later is a new decision, not a widening of this one.

*Anchor D-02 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
