# lite-cellular -- bench baseline (v1.2.0, C3)

C4 consolidates the full baseline; this is the running seed.

- Command: `node --expose-gc bench/bench.mjs`
- Method: `measureOps({ stabilize: 'deep' })`, best-of-5 for ops/sec;
  `measureAllocs` min-over-batches for `bytesPerCall`.
- Node: v26.3.1
- Machine: developer workstation (Apple Silicon, darwin). Throughput on a shared
  box has ~2x run-to-run variance and is INDICATIVE only. The contract is the
  alloc gate (`bytesPerCall: 0`), not any ops/sec figure.

## Per-query surface (C1)

| probe | Mops/s (best-of-5, indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular2` euclidean (scattered coords) | ~13.6 | 0 |
| `cellular2` manhattan | ~8.2 | 0 |
| `cellular2` chebyshev | ~8.4 | 0 |
| module `cellular2` (euclidean) | ~13.9 | 0 |
| `tileableCell2` euclidean (period 8x8) | ~10.8 | 0 |

## Field bake (C2) -- one op = one 64x64 field (4096 px)

Fields/sec is indicative; `bytesPerCall: 0` (per-bake retained bytes) is the C2
contract, alongside the whole-window `maxArrayBuffersGrowth: 0` proven in torture T6
(`dst` is ArrayBuffer-backed, invisible to the V8-heap gate). The tiling bake runs at
~half the plain rate: the two integer `_wrap` reductions per neighbour are the cost of
an EXACT seam.

| probe | fields/sec (best-of-5) | ~Mpx/s | bytesPerCall (contract) |
| --- | --- | --- | --- |
| `fillCellField2` f1 (plain) | ~11000 | ~45 | 0 |
| `fillCellField2` f2-f1 (plain) | ~10800 | ~44 | 0 |
| `fillCellField2` f2 (plain) | ~10800 | ~44 | 0 |
| `fillCellField2` f1 (tiling) | ~5800 | ~24 | 0 |
| `fillCellField2` f2-f1 (tiling) | ~6000 | ~24 | 0 |
| `fillCellField2` f2 (tiling) | ~6000 | ~24 | 0 |

## 3D per-query surface (C3) -- the 27-cell lift

The 3x3x3 = 27-cell scan is ~3x the per-query work of the 9-cell 2D kernel by cell
count, and measures right there: `cellular3` euclidean ~4.8 Mops/s against the 2D
~14.3 (a 3.0x ratio, exactly the cell-count ratio). Same zero-alloc shape --
`bytesPerCall: 0` on every 3D probe is the contract; the 2D surface is byte-unchanged.

| probe | Mops/s (best-of-5, indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular3` euclidean (scattered coords) | ~4.8 | 0 |
| `cellular3` manhattan | ~4.1 | 0 |
| `cellular3` chebyshev | ~4.0 | 0 |
| `tileableCell3` euclidean (period 8x8x8) | ~4.2 | 0 |

## 3D volume bake (C3) -- one op = one 24x24x24 volume (13824 voxels)

Volumes/sec is indicative; `bytesPerCall: 0` (per-bake retained bytes) is the C3
contract, alongside the whole-window `maxArrayBuffersGrowth: 0` proven in torture T6
(`dst` is ArrayBuffer-backed, invisible to the V8-heap gate). The tiling bake runs at
~half the plain rate: the three integer `_wrap` reductions per neighbour are the cost
of an EXACT seam on all three axes.

| probe | volumes/sec (best-of-5) | ~Mvoxel/s | bytesPerCall (contract) |
| --- | --- | --- | --- |
| `fillCellField3` f1 (plain) | ~840 | ~11.6 | 0 |
| `fillCellField3` f2-f1 (plain) | ~840 | ~11.6 | 0 |
| `fillCellField3` f2 (plain) | ~840 | ~11.6 | 0 |
| `fillCellField3` f1 (tiling) | ~390 | ~5.4 | 0 |
| `fillCellField3` f2-f1 (tiling) | ~395 | ~5.5 | 0 |
| `fillCellField3` f2 (tiling) | ~395 | ~5.5 | 0 |

## Seam proof (C2, torture T8 / examples/seamless-tile.mjs)

256x256 period-4 tile, coloured through `gradientOcean`, scored by
`@zakkster/lite-patternforge` `seamlessScore` (lower better; < 0.02 imperceptible):

| tile | seamlessScore overall |
| --- | --- |
| cellular `fillCellField2` (exact integer-cell wrap) | ~0.012 |
| lite-noise `tileableField2` fbm (lattice wrap) | ~0.024 |

The cellular tile is imperceptible AND materially below the gradient tile -- the exact
integer-cell wrap makes the seam step equal to a normal interior step (0006).

## C1 finding (closes decision 0001's open expectation)

Decision 0001 pre-registered the expectation that manhattan/chebyshev would be
"marginally faster than euclidean (no end-sqrt)", and said: if euclidean is not
within a small constant of the other two, the two end-sqrts are not the reason --
investigate the loop.

Measured: euclidean is the FASTEST, not the slowest. Investigating the loop as
instructed found the cost was the metric's `abs`/`max`, not the sqrt: a
data-dependent `dx < 0 ? -dx : dx` ternary mispredicted on scattered coords and
measured ~2x slower than the branchless `Math.abs` / `Math.max` intrinsics (which
are digest-identical -- `dx` is never `-0`). After switching to the branchless
form the three metrics sit within a small constant (~1.7x), euclidean's two
off-loop sqrts costing less than manhattan/chebyshev's two intrinsic abs each. The
end-sqrts were never the driver; the abs branch was. All four probes allocate
0 bytes per call -- the load-bearing result.
