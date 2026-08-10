/**
 * T7 -- retention gate. Dropped Cellular instances of EVERY metric must be
 * object-level collectable (lite-leak, FinalizationRegistry). The kernel binding
 * is a plain function reference, not a closure retained over the instance, so a
 * dropped instance of any metric has no live reference. A positive control retains
 * one instance and asserts the tracker still reports it -- proving the gate can SEE
 * retention, so the "size 0" assertion is not vacuous.
 *
 * Held-value contract (lite-leak): neither the cleanup closure nor the tag may
 * close over the tracked instance, or finalization is defeated and the tracker
 * silently reports clean. So cleanup is a shared NOOP and the tag is a number.
 *
 * @license MIT
 */

import {
    createCellular, METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { assertHot } from './harness.mjs';

const CYCLES = 4096;
const NOOP = function () {};
const METRIC_IDS = [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV];

/** Module-level sink for the positive control, so the retained instance survives. */
const held = [];

function settle() {
    return new Promise((r) => setTimeout(r, 50));
}

export async function run() {
    const tracker = createLeakTracker({ name: 'cellular-leak' });

    // Allocate then DROP N instances, cycling the metric so every kernel binding is
    // exercised. Created in an inner scope and never escape it.
    (function churn() {
        for (let i = 0; i < CYCLES; i++) {
            const metric = METRIC_IDS[i % 3];
            const inst = createCellular(i, { metric, jitter: 1 });
            inst.cellular2(i * 0.5, -i * 0.5);       // touch the 2D surface so the alloc is real
            // Also exercise every 3D surface so a dropped instance that ran the 27-cell
            // kernels, the volume bake, and the 3D tile is still collectable (0007): the
            // _kernel3/_tileKernel3 bindings are plain function refs, not closures over
            // the instance.
            inst.cellular3(i * 0.5, -i * 0.5, i * 0.25);
            inst.tileableCell3(i * 0.5, -i * 0.5, i * 0.25, 4, 4, 4);
            const vox = new Float64Array(2 * 2 * 2);
            inst.fillCellField3(vox, 2, 2, 2, { combo: 'f1', scale: 0.1 });
            tracker.track(inst, NOOP, i);
        }
    })();

    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();

    assertHot(tracker.size() === 0,
        () => `T7: ${tracker.size()} dropped Cellular instances were not collected`);

    // Positive control -- a RETAINED instance must still be tracked. If this were
    // also collected, the assertion above would be meaningless.
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
