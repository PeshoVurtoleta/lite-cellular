/**
 * @zakkster/lite-cellular -- throughput + zero-alloc benchmark.
 *
 *     node --expose-gc bench/bench.mjs
 *
 * Fills the Measured tables in decisions/0001, 0003, 0004 and seeds
 * bench/BASELINE.md. Uses measureOps({ stabilize: 'deep' }) best-of-5 per metric
 * over `cellular2` at scattered coords. Throughput is INDICATIVE (a shared box has
 * ~2x run-to-run variance and is never the contract); the alloc gate
 * (bytesPerCall: 0 via measureAllocs) is the contract. NOT in package.json files[].
 *
 * @license MIT
 */

import { measureOps, measureAllocs } from '@zakkster/lite-gc-profiler';
import {
    createCellular, cellular2, seedCellular,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV, VERSION,
} from '../Cellular.js';

const OPS = 200000;
const WARMUP = 8000;
const REPS = 5;
const OUT = { f1: 0, f2: 0, id: 0 };

function bestOfOpsPerSec(fn) {
    let best = 0;
    for (let k = 0; k < REPS; k++) {
        const r = measureOps(fn, { ops: OPS, warmup: WARMUP, stabilize: 'deep' });
        if (r.opsPerSec > best) best = r.opsPerSec;
    }
    return best;
}

function minBytesPerCall(fn) {
    let best = Infinity;
    for (let k = 0; k < REPS; k++) {
        const r = measureAllocs(fn, { iterations: 20000, batches: 8 });
        if (r.bytesPerCall < best) best = r.bytesPerCall;
    }
    return best;
}

function probe(label, makeHot) {
    const opsPerSec = bestOfOpsPerSec(makeHot());
    const bytesPerCall = minBytesPerCall(makeHot());
    return { label, opsPerSec, bytesPerCall };
}

if (typeof globalThis.gc !== 'function') {
    process.stderr.write('bench: run with --expose-gc:  node --expose-gc bench/bench.mjs\n');
    process.exit(1);
}

// Each hot body draws scattered coords from a xorshift so the field is genuinely
// exercised, writing into the shared OUT struct (no per-call allocation).
function makeInstanceHot(id) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    let s = 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        inst.cellular2((s % 65536) / 64, (s >>> 8) / 64, OUT);
    };
}
function makeModuleHot() {
    seedCellular(1337);
    let s = 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        cellular2((s % 65536) / 64, (s >>> 8) / 64, OUT);
    };
}

const rows = [
    probe('cellular2 euclidean (scattered coords)', () => makeInstanceHot(METRIC_EUCLIDEAN)),
    probe('cellular2 manhattan', () => makeInstanceHot(METRIC_MANHATTAN)),
    probe('cellular2 chebyshev', () => makeInstanceHot(METRIC_CHEBYSHEV)),
    probe('module cellular2 (euclidean)', () => makeModuleHot()),
];

process.stdout.write('lite-cellular v' + VERSION + ' bench (node ' + process.version + ', best-of-' + REPS + ')\n');
process.stdout.write('probe                                        ops/sec        Mops/s  bytesPerCall\n');
for (const r of rows) {
    const mops = (r.opsPerSec / 1e6).toFixed(1);
    process.stdout.write(
        r.label.padEnd(44) + ' ' +
        Math.round(r.opsPerSec).toString().padStart(12) + ' ' +
        mops.padStart(8) + ' ' +
        r.bytesPerCall.toFixed(3).padStart(12) + '\n');
}
