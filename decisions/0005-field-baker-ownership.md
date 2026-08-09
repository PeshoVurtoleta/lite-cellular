# 0005 -- field baker owns nothing; combo resolved once (C2, v1.1.0)

Status: accepted, 2026-08-09.
Anchor: D-05 (ROADMAP.md section 2)
Owner: C2
Depends on: 0001-metric-selection (the metric binds once, same as the instance),
  0002-combination-is-callers (combo is forbidden per-query; this record is the ONE
  place it is allowed, and 0002 points here for why)
Depended on by: 0006-tileability (the baker's optional tile is that record's wrap
  applied inside this loop)

Forward-dated (see 0001). Model: `../LiteNoise/Noise.js` `_fillField2` /
`_tileableField2` -- caller-owned `out`, `opts?.x ?? default` (never `opts = {}`),
a mode decoded once before the loop, an allocation-free normalize pass.

## Problem

`cellular2` answers one query. Textures need a whole field -- `w*h` samples baked
into a buffer a renderer can upload. That is the money surface (weathered stone,
cracked mud, scales, caustics). Three things must be decided so the bake does not
quietly become the allocating, branch-per-pixel path the per-query kernel spent
four records avoiding:

1. **Who owns the destination buffer.**
2. **Where `combo` (F1 / F2-F1 / F2) lives** -- 0002 forbids it per-query, but a
   field is exactly the place it belongs. How, without a per-pixel string parse?
3. **How the metric is applied per pixel** without re-introducing the branch 0001
   removed.

## Decision 1: the baker owns nothing -- caller-owned `dst`, written in place

```
fillCellField2(dst, w, h, opts) -> dst
```

`dst` is the caller's `Float64Array` or `Float32Array`. The baker validates it
(a typed array, length `>= w*h`) and **throws** otherwise (fail closed; an
undersized buffer is a caller error, never a silent short write into a typed
array). It writes `w*h` values in row-major order and returns `dst`. It allocates
**nothing** -- no scratch buffer, no per-pixel out-struct. The per-pixel `f1`/`f2`
live in **locals** (the scan is inlined, or writes one pre-loop scratch struct),
never a fresh object per pixel.

`opts` is read with the `opts?.key ?? default` / no-`opts = {}` discipline from
`_fillField2`, so the omitted-opts path allocates nothing either:

```
seed, scale (->0.01), jitter (->1), metric (->euclidean), combo (->'f1'),
ox, oy (->0), normalize (->false), periodX?, periodY? (0006)
```

## Decision 2: `combo` is resolved to a selector ONCE, before the loop

`combo` names which texture the field holds:

```
'f1'      -> f1                 blobs / cells
'f2-f1'   -> f2 - f1            cracks / Voronoi walls   (alias 'cracks')
'f2'      -> f2                 soft cell field
```

It is decoded **once, at setup**, via a const map -- the `_TF2_MODELS` pattern:

```js
const _COMBO = { 'f1': 0, 'f2-f1': 1, 'cracks': 1, 'f2': 2 };
const sel = _COMBO[combo];
if (sel === undefined) throw new RangeError("... unknown combo '" + combo + "' ...");
```

The pixel loop branches on the **small int `sel`**, never re-parses the string.
Because the scan already computes both `f1` and `f2` in locals (0002 -- the second
distance is nearly free), the combo is a trivial select/subtract on two locals:
no function-pointer call, no discarded work, no allocation. This is exactly 0002's
sanctioned exception: combo forbidden per-query, permitted as a resolve-once bake
option. A per-pixel string compare is the failure mode T6 and a `grep` of the loop
body must rule out.

## Decision 3: the metric binds once, per 0001

`opts.metric` selects one of the three kernels (0001) **once, before the loop** --
the same binding the instance constructor does -- and the pixel loop runs that one
metric's inlined scan. No metric branch per pixel. A bake is single-metric; to mix
metrics, bake twice.

## Decision 4: normalize is an allocation-free opt-in

F1 and F2-F1 fields are not naturally in `[0,1]` (F1 grows with cell size; cracks
are near-zero most places). `normalize: true` runs the two-pass min/max -> rescale
from `_fillField2` **in place** (two scalar-tracking passes over `dst`, no temp
buffer); a constant field (range 0) maps to all-zero, never divides by zero. Off
by default -- the raw distance field is the honest primitive; normalization is a
presentation choice the caller opts into.

## Why not the rejected shapes

- **Baker allocates and returns a new buffer** -- the one thing the package exists
  not to do. A per-frame bake would churn the heap. Rejected: caller owns `dst`.
- **`combo` as a per-pixel string / function argument** -- re-parses or indirect-
  calls `w*h` times; the 0002 hot-path trap at field scale. Rejected for the
  resolve-once selector.
- **Compute only the combo the caller asked for** (skip `f2` for `combo:'f1'`) --
  `f2` falls out of the same 3x3 scan for one extra compare (0002); branching to
  skip it saves nothing and adds a branch. Rejected: always scan both.
- **normalize on by default** -- hides the raw field's real range and makes two
  bakes with different content share a scale silently. Rejected: opt-in.

## Hot path

Per pixel: one inlined 3x3 metric scan (locals only, 0001/0003/0004), one
`sel`-branch combo select, one `dst[idx++]` write. No allocation, no string parse,
no metric branch, no per-pixel object. Setup (metric bind, combo decode, buffer
validation) is once, before the loop. T6 gates the bake at `maxMajor: 0`,
`maxArrayBuffersGrowth: 0`, `stabilize: 'deep'` -- and this is the tier where the
ArrayBuffer gate earns its keep, because `dst` is an ArrayBuffer-backed store the
V8-heap gate is blind to.

## Measured

Greenfield: no before. The contract is the alloc gate on the bake -- per-bake
retained bytes `bytesPerCall: 0` (measureAllocs) AND the whole-window
`maxArrayBuffersGrowth: 0` with a `dst.buffer.byteLength`-unchanged assert (torture
T6; `dst` is ArrayBuffer-backed, invisible to the V8-heap gate). Both hold for the
plain and tiling bake, every combo. Throughput is indicative only.

Built baker, `node --expose-gc bench/bench.mjs`, best-of-5, node v26.3.1, Apple
Silicon (one op = one 64x64 = 4096-px field):

| bake (64x64) | fields/sec | ~Mpx/s | bytesPerCall (contract) |
| --- | --- | --- | --- |
| f1 (plain) | ~11000 | ~45 | 0 |
| f2-f1 (plain) | ~10800 | ~44 | 0 |
| f2 (plain) | ~10800 | ~44 | 0 |
| f1 (tiling) | ~5800 | ~24 | 0 |
| f2-f1 (tiling) | ~6000 | ~24 | 0 |
| f2 (tiling) | ~6000 | ~24 | 0 |

The combo makes no measurable difference (both distances fall out of the same scan;
combo is one select on two locals). Tiling runs at ~half the plain rate -- the two
integer `_wrap` reductions per neighbour, the price of the exact seam (0006). The
`bytesPerCall: 0` result is the load-bearing one; the T9 controls (a per-pixel
out-struct baker, a per-pixel combo string parse) each trip the gate, so it can fail.

## Consequences

- `fillCellField2(dst, w, h, opts) -> dst` writes into a caller-owned typed array,
  allocation-free, single-metric, combo resolved once.
- `combo` accepts `'f1'` / `'f2-f1'` (alias `'cracks'`) / `'f2'`; unknown throws.
- `normalize` is opt-in and allocation-free.
- With `opts.periodX`/`periodY` set the bake is tileable -- that is 0006's wrap
  applied to this loop; without them it is a plain field.
- `fillCellField3` (C3) is the structural twin over the 27-cell scan.

*Anchor D-05 of ROADMAP.md. MIT (c) Zahary Shinikchiev.*
