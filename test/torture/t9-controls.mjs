/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * Runs deliberately-broken variants IN PROCESS on every plain `node
 * test/torture.mjs` and asserts the corresponding gate flags each one. If a
 * control slips through, T9 itself fails the run -- a gate that cannot fail is
 * decorative.
 *
 * There is also the whole-suite control CELLULAR_TORTURE_BREAK=1, which injects a
 * retained createCellular() into T6's hot loop so the alloc gate rejects and the
 * process exits non-zero. T9 covers the same three lanes (alloc, golden,
 * retention) here so a plain run already proves each gate bites.
 *
 * @license MIT
 */

import { createCellular, METRIC_EUCLIDEAN } from '../../Cellular.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { runOpsGate, die } from './harness.mjs';
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, digest } from '../../goldens/gen.mjs';

const NOOP = function () {};
const held = [];

/** Retained sink so the alloc control's allocations survive GC. */
const leak = [];

function settle() {
    return new Promise((r) => setTimeout(r, 50));
}

export async function run() {
    // Control 1 -- the alloc gate. A hot body that retains an allocation every
    // iteration MUST be rejected by runOpsGate (maxArrayBuffersGrowth:0 catches
    // the Float64Array backing store; the retention forces the growth).
    const { report } = runOpsGate(() => { leak.push(new Float64Array(64)); },
        { ops: 4000, warmup: 0 });
    if (report.ok) {
        die('T9 control: an allocating hot loop passed the zero-alloc gate');
    }
    leak.length = 0; // release the control's garbage

    // Control 2 -- the golden check. The correct digest matches the committed one
    // (proven in T0); here prove the check is NOT vacuous -- a field with a
    // different seed produces a DIFFERENT digest, so a corrupted golden is caught.
    const good = createCellular(GOLD_SEED, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
    const bad = createCellular(GOLD_SEED + 1, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
    const goodDigest = digest(good, COORDS);
    const badDigest = digest(bad, COORDS);
    if (goodDigest === badDigest) {
        die('T9 control: the golden digest is insensitive to the seed -- a corrupted golden would pass');
    }

    // Control 3 -- the retention detector. A dropped instance must collect (so
    // T7's "size 0" is real) AND a retained one must stay live (so T7's positive
    // control is real). If the tracker cannot see a retained instance, T7 is blind.
    const tracker = createLeakTracker({ name: 'cellular-ctrl-drop' });
    (function churn() {
        for (let i = 0; i < 512; i++) {
            const inst = createCellular(i);
            inst.cellular2(i, -i);
            tracker.track(inst, NOOP, i);
        }
    })();
    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();
    if (tracker.size() !== 0) {
        die('T9 control: dropped instances not collected (size=' + tracker.size() + ') -- T7 collect path unreliable');
    }

    const ctrl = createLeakTracker({ name: 'cellular-ctrl-hold' });
    const kept = createCellular(0xc0ffee);
    kept.cellular2(3.5, 4.5);
    ctrl.track(kept, NOOP, 0xc0ffee);
    held.push(kept);
    globalThis.gc();
    await settle();
    globalThis.gc();
    await settle();
    if (ctrl.size() !== 1) {
        die('T9 control: a retained instance was reported collected (size=' + ctrl.size() +
            ') -- the retention gate cannot fail');
    }
}
