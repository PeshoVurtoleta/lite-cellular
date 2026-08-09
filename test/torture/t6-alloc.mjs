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

import { createCellular, cellular2 } from '../../Cellular.js';
import {
    runOpsGate, runAllocGate, BREAK, SAMPLES, OUT,
    makePrng, SEED, assertHot, die,
} from './harness.mjs';

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
}
