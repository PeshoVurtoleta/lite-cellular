/**
 * @zakkster/lite-cellular -- throughput + zero-alloc benchmark.
 *
 *     node --expose-gc bench/bench.mjs
 *
 * Fills the Measured tables in decisions/0001, 0003, 0004 (C1) and 0005, 0006 (C2)
 * and seeds bench/BASELINE.md. Uses measureOps({ stabilize: 'deep' }) best-of-5 over
 * `cellular2` at scattered coords, the field bake `fillCellField2` (per combo, plain
 * + tiling), and `tileableCell2`. Throughput is INDICATIVE (a shared box has ~2x
 * run-to-run variance and is never the contract); the alloc gate (bytesPerCall: 0 via
 * measureAllocs) is the contract -- for the bake that is per-bake retained bytes, and
 * the whole-window maxArrayBuffersGrowth: 0 (see torture T6). NOT in files[].
 *
 * @license MIT
 */

import { measureOps, measureAllocs } from '@zakkster/lite-gc-profiler';
import {
    createCellular, cellular2, seedCellular,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV, VERSION,
} from '../Cellular.js';

// Op counts tuned down for the widened euclid/manhattan kernels (5x5 = 25 / 5x5x5 =
// 125 cells; 0008): throughput is INDICATIVE, so smaller counts are fine. best-of-5 is
// kept, and `bytesPerCall: 0` (the contract) is unaffected by op count.
const OPS = 60000;
const WARMUP = 4000;
const REPS = 5;
const ALLOC_ITER = 8000;
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
        const r = measureAllocs(fn, { iterations: ALLOC_ITER, batches: 8 });
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

// tileableCell2 hot body (single query), scattered coords, period 8x8.
function makeTileHot(id) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    let s = 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        inst.tileableCell2((s % 65536) / 64, (s >>> 8) / 64, 8, 8, OUT);
    };
}

// cellular3 hot body (single query), scattered 3D coords. ~3x the 2D cell count.
function makeInstanceHot3(id) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    let s = 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        inst.cellular3((s % 65536) / 64, (s >>> 8) / 64, (s >>> 4 & 1023) / 64, OUT);
    };
}

// tileableCell3 hot body (single query), scattered coords, period 8x8x8.
function makeTileHot3(id) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    let s = 1;
    return () => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        inst.tileableCell3((s % 65536) / 64, (s >>> 8) / 64, (s >>> 4 & 1023) / 64, 8, 8, 8, OUT);
    };
}

// The bake bench: one fillCellField2 call is one "op". Uses a smaller op / iteration
// count than the per-query bench (each op is a whole BW*BH field) and reports both
// ops/sec (fields per second) and bytesPerCall (per-bake retained bytes -- the C2
// contract is 0).
const BW = 64, BH = 64;
const BAKE_OPS = 1500, BAKE_WARMUP = 100, BAKE_ITER = 300, BAKE_BATCH = 4;

function makeBakeHot(id, combo, tiling) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    const dst = new Float64Array(BW * BH);
    const opts = tiling
        ? { combo, scale: 4 / BW, periodX: 4, periodY: 4 }
        : { combo, scale: 0.02 };
    return () => { inst.fillCellField2(dst, BW, BH, opts); };
}

function probeBake(label, id, combo, tiling) {
    const makeHot = () => makeBakeHot(id, combo, tiling);
    let bestOps = 0;
    for (let k = 0; k < REPS; k++) {
        const r = measureOps(makeHot(), { ops: BAKE_OPS, warmup: BAKE_WARMUP, stabilize: 'deep' });
        if (r.opsPerSec > bestOps) bestOps = r.opsPerSec;
    }
    let bestBytes = Infinity;
    for (let k = 0; k < REPS; k++) {
        const r = measureAllocs(makeHot(), { iterations: BAKE_ITER, batches: BAKE_BATCH });
        if (r.bytesPerCall < bestBytes) bestBytes = r.bytesPerCall;
    }
    return { label, opsPerSec: bestOps, bytesPerCall: bestBytes };
}

// The 3D volume bake bench: one fillCellField3 call is one op (a whole VW*VH*VD
// volume). Smaller extents than the 2D field so an op stays comparable in voxel count.
const VW = 24, VH = 24, VD = 24;
const VBAKE_OPS = 250, VBAKE_WARMUP = 20, VBAKE_ITER = 60, VBAKE_BATCH = 4;

function makeBakeHot3(id, combo, tiling) {
    const inst = createCellular(1337, { metric: id, jitter: 1 });
    const dst = new Float64Array(VW * VH * VD);
    const opts = tiling
        ? { combo, scale: 4 / VW, periodX: 4, periodY: 4, periodZ: 4 }
        : { combo, scale: 0.02 };
    return () => { inst.fillCellField3(dst, VW, VH, VD, opts); };
}

function probeBake3(label, id, combo, tiling) {
    const makeHot = () => makeBakeHot3(id, combo, tiling);
    let bestOps = 0;
    for (let k = 0; k < REPS; k++) {
        const r = measureOps(makeHot(), { ops: VBAKE_OPS, warmup: VBAKE_WARMUP, stabilize: 'deep' });
        if (r.opsPerSec > bestOps) bestOps = r.opsPerSec;
    }
    let bestBytes = Infinity;
    for (let k = 0; k < REPS; k++) {
        const r = measureAllocs(makeHot(), { iterations: VBAKE_ITER, batches: VBAKE_BATCH });
        if (r.bytesPerCall < bestBytes) bestBytes = r.bytesPerCall;
    }
    return { label, opsPerSec: bestOps, bytesPerCall: bestBytes };
}

const rows = [
    probe('cellular2 euclidean (scattered coords)', () => makeInstanceHot(METRIC_EUCLIDEAN)),
    probe('cellular2 manhattan', () => makeInstanceHot(METRIC_MANHATTAN)),
    probe('cellular2 chebyshev', () => makeInstanceHot(METRIC_CHEBYSHEV)),
    probe('module cellular2 (euclidean)', () => makeModuleHot()),
    probe('tileableCell2 euclidean (8x8)', () => makeTileHot(METRIC_EUCLIDEAN)),
    probeBake('fillCellField2 f1 (plain, 64x64)', METRIC_EUCLIDEAN, 'f1', false),
    probeBake('fillCellField2 f2-f1 (plain, 64x64)', METRIC_EUCLIDEAN, 'f2-f1', false),
    probeBake('fillCellField2 f2 (plain, 64x64)', METRIC_EUCLIDEAN, 'f2', false),
    probeBake('fillCellField2 f1 (tiling, 64x64)', METRIC_EUCLIDEAN, 'f1', true),
    probeBake('fillCellField2 f2-f1 (tiling, 64x64)', METRIC_EUCLIDEAN, 'f2-f1', true),
    probeBake('fillCellField2 f2 (tiling, 64x64)', METRIC_EUCLIDEAN, 'f2', true),
    probe('cellular3 euclidean (scattered coords)', () => makeInstanceHot3(METRIC_EUCLIDEAN)),
    probe('cellular3 manhattan', () => makeInstanceHot3(METRIC_MANHATTAN)),
    probe('cellular3 chebyshev', () => makeInstanceHot3(METRIC_CHEBYSHEV)),
    probe('tileableCell3 euclidean (8x8x8)', () => makeTileHot3(METRIC_EUCLIDEAN)),
    probeBake3('fillCellField3 f1 (plain, 24^3)', METRIC_EUCLIDEAN, 'f1', false),
    probeBake3('fillCellField3 f2-f1 (plain, 24^3)', METRIC_EUCLIDEAN, 'f2-f1', false),
    probeBake3('fillCellField3 f2 (plain, 24^3)', METRIC_EUCLIDEAN, 'f2', false),
    probeBake3('fillCellField3 f1 (tiling, 24^3)', METRIC_EUCLIDEAN, 'f1', true),
    probeBake3('fillCellField3 f2-f1 (tiling, 24^3)', METRIC_EUCLIDEAN, 'f2-f1', true),
    probeBake3('fillCellField3 f2 (tiling, 24^3)', METRIC_EUCLIDEAN, 'f2', true),
];

process.stdout.write('lite-cellular v' + VERSION + ' bench (node ' + process.version + ', best-of-' + REPS + ')\n');
process.stdout.write('probe                                          ops/sec        Mops/s  bytesPerCall\n');
for (const r of rows) {
    const mops = (r.opsPerSec / 1e6).toFixed(3);
    process.stdout.write(
        r.label.padEnd(46) + ' ' +
        Math.round(r.opsPerSec).toString().padStart(12) + ' ' +
        mops.padStart(8) + ' ' +
        r.bytesPerCall.toFixed(3).padStart(12) + '\n');
}
