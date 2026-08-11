# lite-cellular -- bench baseline (v1.3.0, C4)

The committed baseline for the whole surface AFTER the 0008 exact-neighbourhood
widening. euclid/manhattan now scan the 5x5 / 5x5x5 neighbourhood (radius 2);
chebyshev is unchanged at 3x3 / 3x3x3 (radius 1).

- Command: `node --expose-gc bench/bench.mjs`
- Method: `measureOps({ stabilize: 'deep' })`, best-of-5 for ops/sec;
  `measureAllocs` min-over-batches for `bytesPerCall`.
- Node: v26.3.1
- Machine: developer workstation (Apple Silicon, darwin). Throughput on a shared
  box has ~2x run-to-run variance and is INDICATIVE only. The contract is the
  alloc gate (`bytesPerCall: 0` on EVERY probe below), not any ops/sec figure.

## The 0008 widening cost (euclid/manhattan only)

The cell count drives the cost: euclid/manhattan evaluate 25/9 = ~2.78x (2D) and
125/27 = ~4.63x (3D) more distances per query; chebyshev is untouched. Measured
per-query drop, 2D: euclid ~13.6 -> ~6.3 Mops/s (~2.2x), manhattan ~8.2 -> ~4.9
(~1.7x). 3D: euclid ~4.8 -> ~1.6 Mops/s (~3.0x), manhattan ~4.1 -> ~1.6. chebyshev
holds (2D ~7.4, 3D ~3.8). All probes still allocate 0 bytes per call.

## Per-query surface (2D)

| probe | Mops/s (best-of-5, indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular2` euclidean (scattered coords) | ~6.28 | 0 |
| `cellular2` manhattan | ~4.95 | 0 |
| `cellular2` chebyshev (radius 1, unchanged) | ~7.44 | 0 |
| module `cellular2` (euclidean) | ~6.89 | 0 |
| `tileableCell2` euclidean (period 8x8) | ~6.00 | 0 |

## Field bake (2D) -- one op = one 64x64 field (4096 px)

`bytesPerCall: 0` (per-bake retained bytes) is the contract, alongside the
whole-window `maxArrayBuffersGrowth: 0` proven in torture T6 (`dst` is
ArrayBuffer-backed, invisible to the V8-heap gate).

| probe | fields/sec (best-of-5) | ~Mpx/s | bytesPerCall (contract) |
| --- | --- | --- | --- |
| `fillCellField2` f1 (plain) | ~4435 | ~18.2 | 0 |
| `fillCellField2` f2-f1 (plain) | ~4398 | ~18.0 | 0 |
| `fillCellField2` f2 (plain) | ~4404 | ~18.0 | 0 |
| `fillCellField2` f1 (tiling) | ~2728 | ~11.2 | 0 |
| `fillCellField2` f2-f1 (tiling) | ~2736 | ~11.2 | 0 |
| `fillCellField2` f2 (tiling) | ~2738 | ~11.2 | 0 |

## 3D per-query surface -- the 125-cell (euclid/manhattan) / 27-cell (chebyshev) scan

| probe | Mops/s (best-of-5, indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular3` euclidean (scattered coords) | ~1.58 | 0 |
| `cellular3` manhattan | ~1.61 | 0 |
| `cellular3` chebyshev (radius 1, unchanged) | ~3.75 | 0 |
| `tileableCell3` euclidean (period 8x8x8) | ~1.33 | 0 |

## 3D volume bake -- one op = one 24x24x24 volume (13824 voxels)

| probe | volumes/sec (best-of-5) | ~Mvoxel/s | bytesPerCall (contract) |
| --- | --- | --- | --- |
| `fillCellField3` f1 (plain) | ~200 | ~2.76 | 0 |
| `fillCellField3` f2-f1 (plain) | ~199 | ~2.75 | 0 |
| `fillCellField3` f2 (plain) | ~200 | ~2.76 | 0 |
| `fillCellField3` f1 (tiling) | ~113 | ~1.56 | 0 |
| `fillCellField3` f2-f1 (tiling) | ~113 | ~1.56 | 0 |
| `fillCellField3` f2 (tiling) | ~113 | ~1.56 | 0 |

## Sufficiency (C4, torture T-ORACLE)

The shipped kernel equals a radius-3 brute-force block scan bit-for-bit ({f1,f2,id})
over 100k+ mixed ops (`cellular2/3`, `tileableCell2/3`, bake samples), all three
metrics, `jitter` swept `[0,1]`: ZERO divergences. Before 0008 the radius-1 3x3 scan
missed the true nearest feature ~2e-6 (euclid) / ~2e-4 (manhattan) of the time;
chebyshev was already exact. The `CELLULAR_TORTURE_BREAK_PRECISION` control narrows the
kernel back to radius 1 and makes the oracle FAIL -- proof the oracle tests sufficiency.

## Seam proof (C2, torture T8 / examples/seamless-tile.mjs)

256x256 period-4 tile, coloured through `gradientOcean`, scored by
`@zakkster/lite-patternforge` `seamlessScore` (lower better; < 0.02 imperceptible):

| tile | seamlessScore overall |
| --- | --- |
| cellular `fillCellField2` (exact integer-cell wrap) | ~0.012 |
| lite-noise `tileableField2` fbm (lattice wrap) | ~0.024 |

The exact integer-cell wrap (0006) is unaffected by the 0008 widening: wrapping the
wider ring's integer cells stays bit-exact, so the tile is still seamless with `===`.
