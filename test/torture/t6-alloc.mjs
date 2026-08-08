/**
 * T6 -- the zero-alloc gate.
 *
 * `cellular2` in a hot loop over pseudo-random coords, writing into the shared
 * OUT struct, measured with lite-gc-profiler and gated at maxMajor:0 /
 * maxPauseMs:4 / maxArrayBuffersGrowth:0 with stabilize:'deep'. The query path
 * owns no ArrayBuffer, so maxMajor is the load-bearing rule here; the arrayBuffers
 * rule is kept in the shared RULES so C2's field bakes inherit it unchanged.
 *
 * A structural assertion no heap gate can make: the instance's `_out` object
 * identity is unchanged across the window -- a hidden re-alloc of the reused
 * out-struct would replace it, and this catches that even if the heap gate
 * happened to settle.
 *
 * CELLULAR_TORTURE_BREAK=1 injects a RETAINED allocation into the hot body so the
 * gate must reject the window (a gate that cannot fail is decorative). The
 * injection is a retained `createCellular()` -- the extra query-path allocation
 * the C0 brief names -- plus a retained `Float64Array`: the profiler measures
 * that its ArrayBuffer backing store grows, and `maxArrayBuffersGrowth:0` trips
 * promptly and deterministically. (Retained plain objects alone do not force a
 * major GC in this window, so they cannot trip the brief-mandated rules; the
 * arrayBuffers lane the gate already watches is the reliable control -- see the
 * DIFF note. The gate is not widened; the control is made able to fire.)
 *
 * @license MIT
 */

import { createCellular } from '../../Cellular.js';
import { runOpsGate, BREAK, SAMPLE, OUT, makePrng, SEED, assertHot, die } from './harness.mjs';

const OPS = 200000;
const WARMUP = 4000;
const COORD = 1024;

/** Retained sink so the BREAK control's allocations survive GC (heap grows). */
const leak = [];

export function run() {
    const prng = makePrng(SEED);
    // The hot body samples the shared instance into the shared out-struct. The
    // only per-iteration work is a PRNG draw and the query -- no allocation.
    const outIdentityBefore = SAMPLE._out;

    const hot = (i) => {
        const x = (prng() % (COORD * 64)) / 64;
        const y = (prng() % (COORD * 64)) / 64;
        SAMPLE.cellular2(x, y, OUT);
        // Second call with the omitted-out path exercises the reused instance
        // struct (still zero-alloc: it returns SAMPLE._out, never a new object).
        SAMPLE.cellular2(y, x);
        if (BREAK) { leak.push(createCellular(i)); leak.push(new Float64Array(64)); } // control: retained growth
    };

    const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });

    // Structural: the reused out-struct must be the SAME object after the window.
    assertHot(SAMPLE._out === outIdentityBefore,
        () => 'T6: instance _out identity changed -- hidden re-alloc of the reused struct');

    if (!report.ok) {
        const g = summary.gc;
        die('T6 alloc gate rejected -- verdict=' + report.verdict +
            ' source=' + summary.source +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3) +
            (BREAK ? ' (CELLULAR_TORTURE_BREAK control -- expected)' : ''));
    }

    // In BREAK mode the gate was SUPPOSED to reject; reaching here means the
    // injected allocations slipped through, which is itself a failure.
    if (BREAK) {
        die('T6: CELLULAR_TORTURE_BREAK injected retained allocations per iteration but the gate passed');
    }
}
