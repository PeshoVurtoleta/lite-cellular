/**
 * T6 -- the zero-alloc gate, across all three metrics AND the module surface.
 *
 * For each of euclidean / manhattan / chebyshev instances and the module free
 * `cellular2`, the query hot path is proven zero-alloc on two EXACT lanes:
 *
 *   - Zero-retention (runAllocGate): measureAllocs maxBytesPerCall:0, best-of-5.
 *     The load-bearing gate. Measures per-call RETAINED bytes after a forced
 *     collection, so 0 is the literal zero-allocation claim
 *     (../LiteGcProfiler/llms.txt 172-179). This REPLACES the C1-BRIEF S3.3
 *     `maxBytesPerOp:0` rate lane: a measureOps RATE has a V8 self-noise floor
 *     (llms.txt 168-179) so it can never read 0, and measured on this workload it
 *     does not separate a transient from clean. measureAllocs is exact here.
 *   - Whole-window (runOpsGate): maxMajor:0 / maxPauseMs:4 /
 *     maxArrayBuffersGrowth:0 (stabilize:'deep'). Catches RETAINED per-op
 *     ArrayBuffer/heap growth.
 *
 * A structural assertion no heap gate can make: the bound-kernel indirection did
 * not introduce a per-query allocation -- each instance's `_out` identity is
 * unchanged across the window.
 *
 * CELLULAR_TORTURE_BREAK=1 injects a RETAINED createCellular() + Float64Array into
 * the euclidean whole-window hot body so the gate rejects (a gate that cannot fail
 * is decorative); the arrayBuffers lane trips promptly and deterministically.
 *
 * @license MIT
 */

import { createCellular, cellular2, METRIC_EUCLIDEAN } from '../../Cellular.js';
import {
    runOpsGate, runAllocGate, BREAK, BREAK_BAKER, BREAK_COMBOPARSE, SAMPLES, OUT,
    makePrng, SEED, assertHot, die,
} from './harness.mjs';
import { bakeAllocating, bakeComboParse } from './broken.mjs';

const OPS = 120000;
const WARMUP = 4000;
const COORD = 1024;

/** Retained sink so the BREAK control's allocations survive GC (heap grows). */
const leak = [];

export function run() {
    // --- one whole-window + zero-retention gate per metric -------------------
    for (const [name, inst] of SAMPLES) {
        const outIdentityBefore = inst._out;
        const isEuclid = name === 'euclidean';
        const prng = makePrng(SEED);

        // Whole-window lane (also carries the BREAK control on euclidean).
        const hot = (i) => {
            const x = (prng() % (COORD * 64)) / 64;
            const y = (prng() % (COORD * 64)) / 64;
            inst.cellular2(x, y, OUT);
            // Second call on the omitted-out path exercises the reused instance
            // struct (still zero-alloc: returns inst._out, never a new object).
            inst.cellular2(y, x);
            if (BREAK && isEuclid) { leak.push(createCellular(i)); leak.push(new Float64Array(64)); }
        };

        const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
        assertHot(inst._out === outIdentityBefore,
            () => `T6[${name}]: instance _out identity changed -- hidden re-alloc of the reused struct`);
        if (!report.ok) {
            const g = summary.gc;
            die('T6[' + name + '] whole-window gate rejected -- verdict=' + report.verdict +
                ' source=' + summary.source +
                ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3) +
                (BREAK && isEuclid ? ' (CELLULAR_TORTURE_BREAK control -- expected)' : ''));
        }
        if (BREAK && isEuclid) {
            die('T6[' + name + ']: CELLULAR_TORTURE_BREAK injected retained allocations but the gate passed');
        }

        // Zero-retention lane -- the exact measureAllocs gate.
        const prng2 = makePrng(SEED ^ 0x1111);
        const allocHot = () => {
            const x = (prng2() % (COORD * 64)) / 64;
            const y = (prng2() % (COORD * 64)) / 64;
            inst.cellular2(x, y, OUT);
        };
        const { report: aRep, result } = runAllocGate(allocHot, {});
        assertHot(aRep.verdict !== 'fail',
            () => `T6[${name}] zero-retention gate rejected -- bytesPerCall=${result.bytesPerCall} ` +
                `(a per-query allocation in the ${name} kernel)`);
    }

    // --- the module free cellular2: same two lanes ---------------------------
    const prngM = makePrng(SEED ^ 0x2222);
    const hotM = (i) => {
        const x = (prngM() % (COORD * 64)) / 64;
        const y = (prngM() % (COORD * 64)) / 64;
        cellular2(x, y, OUT);
    };
    const { report: rM, summary: sM } = runOpsGate(hotM, { ops: OPS, warmup: WARMUP });
    if (!rM.ok) {
        const g = sM.gc;
        die('T6[module] whole-window gate rejected -- verdict=' + rM.verdict +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
    }
    const prngM2 = makePrng(SEED ^ 0x3333);
    const allocHotM = () => {
        const x = (prngM2() % (COORD * 64)) / 64;
        const y = (prngM2() % (COORD * 64)) / 64;
        cellular2(x, y, OUT);
    };
    const { report: aM, result: resM } = runAllocGate(allocHotM, {});
    assertHot(aM.verdict !== 'fail',
        () => `T6[module] zero-retention gate rejected -- bytesPerCall=${resM.bytesPerCall}`);

    // --- C2: the field bake, where the ArrayBuffer gate earns its keep -------
    // `dst` is an ArrayBuffer-backed store the V8-heap gate is blind to, so the
    // whole-window `maxArrayBuffersGrowth:0` + the `dst.buffer.byteLength` assert are
    // the load-bearing checks; the zero-retention lane is the exact per-call proof.
    const BW = 32, BH = 32;
    const dst = new Float64Array(BW * BH);
    const bakeInst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const combos = ['f1', 'f2-f1', 'cracks', 'f2'];

    // BREAK controls: gate a broken baker (per-pixel out-struct, or per-pixel combo
    // string parse). It MUST be rejected; either outcome exits non-zero.
    if (BREAK_BAKER || BREAK_COMBOPARSE) {
        const sink = [];
        const small = new Float64Array(8 * 8);
        // Sink accumulates across iterations (never cleared inside the hot body) so
        // the retained per-pixel allocations read bytes > 0.
        const brokenHot = () => {
            if (BREAK_BAKER) bakeAllocating(bakeInst, small, 8, 8, { combo: 'f1' }, sink);
            else bakeComboParse(bakeInst, small, 8, 8, { combo: 'f2-f1' }, sink);
        };
        const { report } = runAllocGate(brokenHot, { iterations: 300, batches: 4, reps: 1 });
        if (report.verdict !== 'fail') {
            die('T6 bake break control: a ' + (BREAK_BAKER ? 'per-pixel-allocating' : 'per-pixel combo-parse') +
                ' baker passed the zero-retention gate -- the bake gate is blind');
        }
        die('T6 bake break control tripped as designed -- exiting non-zero');
    }

    // Plain + tiling bake, each combo: whole-window (arrayBuffers) + zero-retention.
    for (const tiling of [false, true]) {
        for (const combo of combos) {
            const opts = tiling
                ? { combo, scale: 4 / BW, periodX: 4, periodY: 4 }
                : { combo, scale: 0.03 };
            const bytesBefore = dst.buffer.byteLength;
            const hot = () => { bakeInst.fillCellField2(dst, BW, BH, opts); };

            const { report, summary } = runOpsGate(hot, { ops: 3000, warmup: 200 });
            assertHot(dst.buffer.byteLength === bytesBefore,
                () => `T6 bake[${tiling ? 'tiling' : 'plain'}/${combo}]: dst.buffer.byteLength changed -- a hidden realloc`);
            if (!report.ok) {
                const g = summary.gc;
                die('T6 bake[' + (tiling ? 'tiling' : 'plain') + '/' + combo + '] whole-window gate rejected -- ' +
                    'verdict=' + report.verdict + ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
            }
            const { report: aRep, result } = runAllocGate(hot, { iterations: 600, batches: 4, reps: 3 });
            assertHot(aRep.verdict !== 'fail',
                () => `T6 bake[${tiling ? 'tiling' : 'plain'}/${combo}] zero-retention gate rejected -- bytesPerCall=${result.bytesPerCall}`);
        }
    }

    // tileableCell2 in a hot loop: same two lanes.
    const prngT = makePrng(SEED ^ 0x4444);
    const hotT = () => {
        const x = (prngT() % 65536) / 64;
        const y = (prngT() % 65536) / 64;
        bakeInst.tileableCell2(x, y, 8, 8, OUT);
    };
    const { report: rT, summary: sT } = runOpsGate(hotT, { ops: OPS, warmup: WARMUP });
    if (!rT.ok) {
        const g = sT.gc;
        die('T6[tileableCell2] whole-window gate rejected -- verdict=' + rT.verdict +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
    }
    const prngT2 = makePrng(SEED ^ 0x5555);
    const allocHotT = () => {
        const x = (prngT2() % 65536) / 64;
        const y = (prngT2() % 65536) / 64;
        bakeInst.tileableCell2(x, y, 8, 8, OUT);
    };
    const { report: aT, result: resT } = runAllocGate(allocHotT, {});
    assertHot(aT.verdict !== 'fail',
        () => `T6[tileableCell2] zero-retention gate rejected -- bytesPerCall=${resT.bytesPerCall}`);
}
