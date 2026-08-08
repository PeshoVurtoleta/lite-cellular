/**
 * T7 -- retention gate. Dropped Cellular instances must be object-level
 * collectable (lite-leak, FinalizationRegistry). A positive control retains one
 * instance and asserts the tracker still reports it -- proving the gate can SEE
 * retention, so the "size 0" assertion is not vacuous.
 *
 * Held-value contract (lite-leak): neither the cleanup closure nor the tag may
 * close over the tracked instance, or finalization is defeated and the tracker
 * silently reports clean. So cleanup is a shared NOOP and the tag is a number.
 *
 * @license MIT
 */

import { createCellular } from '../../Cellular.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { assertHot } from './harness.mjs';

const CYCLES = 4096;
const NOOP = function () {};

/** Module-level sink for the positive control, so the retained instance survives. */
const held = [];

function settle() {
    return new Promise((r) => setTimeout(r, 50));
}

export async function run() {
    const tracker = createLeakTracker({ name: 'cellular-leak' });

    // Allocate then DROP N instances. They are created in an inner scope and
    // never escape it, so after this returns nothing references them.
    (function churn() {
        for (let i = 0; i < CYCLES; i++) {
            const inst = createCellular(i);
            // Touch it so the allocation is real and not elided.
            inst.cellular2(i * 0.5, -i * 0.5);
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
    const kept = createCellular(0x5eed);
    kept.cellular2(1.5, 2.5);
    ctrl.track(kept, NOOP, 0x5eed);
    held.push(kept);

    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();

    assertHot(ctrl.size() === 1,
        () => `T7: retained instance not seen as live (size=${ctrl.size()}) -- gate blind to retention`);
}
