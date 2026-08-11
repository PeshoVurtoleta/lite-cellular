/**
 * T7 -- retention gate, extended to a 65536-cycle soak (0008/C4). Dropped Cellular
 * instances of EVERY metric must be object-level collectable (lite-leak,
 * FinalizationRegistry). The kernel binding is a plain function reference, not a closure
 * retained over the instance, so a dropped instance of any metric has no live reference.
 *
 * Two independent proofs of flatness:
 *   - EXACT: the FinalizationRegistry tracker returns to size 0 -- no instance survived
 *     its drop. This is the load-bearing proof.
 *   - SANITY: the heap is sampled ACROSS cycles (after a periodic gc, not within one
 *     cycle); the end-of-soak heapUsed stays within a bound of the post-warmup baseline.
 *     A real per-cycle retention of 65536 instances + their bakes would blow the bound.
 *
 * The positive control retains one instance and asserts the tracker still reports it --
 * proving the gate can SEE retention, so "size 0" is not vacuous.
 * CELLULAR_TORTURE_BREAK_SOAK=1 retains ONE instance inside the soak churn (broken.mjs
 * `retainForSoak`), so `tracker.size()` returns 1 and the soak fails -- a gate that
 * cannot fail is decorative.
 *
 * Measured: 65536 build/drop cycles (2D+3D mixed metrics, a 3D bake each) run in
 * ~0.4s wall on the dev box -- well inside the torture budget. Held-value contract
 * (lite-leak): neither the cleanup closure nor the tag may close over the tracked
 * instance, or finalization is defeated. So cleanup is a shared NOOP and the tag is a
 * number.
 *
 * @license MIT
 */

import {
    createCellular, METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { assertHot, die, BREAK_SOAK } from './harness.mjs';
import { retainForSoak } from './broken.mjs';

const CYCLES = 65536;
const NOOP = function () {};
const METRIC_IDS = [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV];

/** Heap-flatness bound across the soak (bytes). A per-cycle retention would exceed it. */
const HEAP_BOUND = 24 * 1024 * 1024;

/** Module-level sinks so retained instances (control + break) survive their scope. */
const held = [];
const soakLeak = [];

function settle() {
    return new Promise((r) => setTimeout(r, 50));
}

export async function run() {
    const tracker = createLeakTracker({ name: 'cellular-leak' });
    const vox = new Float64Array(2 * 2 * 2);   // one reused bake buffer (not per-cycle)
    let baseHeap = 0, endHeap = 0;

    // Allocate then DROP N instances, cycling the metric so every kernel binding is
    // exercised. Created in an inner scope and never escape it. The heap is sampled
    // ACROSS cycles (after a periodic gc), not within one.
    (function churn() {
        for (let i = 0; i < CYCLES; i++) {
            const metric = METRIC_IDS[i % 3];
            const inst = createCellular(i, { metric, jitter: 1 });
            inst.cellular2(i * 0.5, -i * 0.5);           // touch 2D so the alloc is real
            // Exercise every 3D surface too: a dropped instance that ran the widened
            // kernels, the volume bake, and the 3D tile is still collectable (0007/0008) --
            // the _kernel3/_tileKernel3 bindings are plain function refs, not closures.
            inst.cellular3(i * 0.5, -i * 0.5, i * 0.25);
            inst.tileableCell3(i * 0.5, -i * 0.5, i * 0.25, 4, 4, 4);
            inst.fillCellField3(vox, 2, 2, 2, { combo: 'f1', scale: 0.1 });
            tracker.track(inst, NOOP, i);
            // BREAK_SOAK control: retain ONE instance mid-soak so it outlives its drop.
            if (BREAK_SOAK && i === 1234) retainForSoak(inst, soakLeak);
            if ((i & 8191) === 0) {
                globalThis.gc();
                const h = process.memoryUsage().heapUsed;
                if (i === 8192) baseHeap = h;   // baseline after warmup
                endHeap = h;
            }
        }
    })();

    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();
    endHeap = process.memoryUsage().heapUsed;

    // SANITY: heap flat across the soak (post-warmup baseline vs end).
    assertHot(baseHeap === 0 || endHeap - baseHeap < HEAP_BOUND,
        () => `T7.soak-heap: heap grew ${(endHeap - baseHeap)} B across ${CYCLES} cycles ` +
            `(baseline ${baseHeap}, end ${endHeap}) -- a per-cycle retention`);

    // EXACT: no dropped instance survived (FinalizationRegistry). Under BREAK_SOAK this
    // is 1 (the retained instance), which fails the soak as designed.
    assertHot(tracker.size() === 0,
        () => `T7.soak: ${tracker.size()} dropped Cellular instances of ${CYCLES} were not collected` +
            (BREAK_SOAK ? ' (CELLULAR_TORTURE_BREAK_SOAK control -- expected)' : ''));

    // Positive control -- a RETAINED instance must still be tracked. If this were also
    // collected, the assertion above would be meaningless.
    const ctrl = createLeakTracker({ name: 'cellular-leak-ctrl' });
    const kept = createCellular(0x5eed, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    kept.cellular2(1.5, 2.5);
    kept.cellular3(1.5, 2.5, 3.5);
    ctrl.track(kept, NOOP, 0x5eed);
    held.push(kept);

    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();

    assertHot(ctrl.size() === 1,
        () => `T7: retained instance not seen as live (size=${ctrl.size()}) -- gate blind to retention`);
}
