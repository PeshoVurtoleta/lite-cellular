# lite-cellular -- bench baseline (v1.0.0, C1)

First recorded baseline. C4 consolidates the full baseline; this is the seed.

- Command: `node --expose-gc bench/bench.mjs`
- Method: `measureOps({ stabilize: 'deep' })`, best-of-5 for ops/sec;
  `measureAllocs` min-over-batches for `bytesPerCall`.
- Node: v26.3.1
- Machine: developer workstation (Apple Silicon, darwin). Throughput on a shared
  box has ~2x run-to-run variance and is INDICATIVE only. The contract is the
  alloc gate (`bytesPerCall: 0`), not any ops/sec figure.

| probe | Mops/s (best-of-5, indicative) | bytesPerCall (contract) |
| --- | --- | --- |
| `cellular2` euclidean (scattered coords) | ~14.7 | 0 |
| `cellular2` manhattan | ~9.5 | 0 |
| `cellular2` chebyshev | ~8.5 | 0 |
| module `cellular2` (euclidean) | ~14.7 | 0 |

## Finding (closes decision 0001's open expectation)

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
