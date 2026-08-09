/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * Runs deliberately-broken variants IN PROCESS on every plain `node
 * test/torture.mjs` and asserts the corresponding gate flags each one. If a
 * control slips through, T9 itself fails the run -- a gate that cannot fail is
 * decorative.
 *
 * C0 lanes (kept): alloc gate (retained ArrayBuffer growth), golden
 * seed-sensitivity, retention drop + hold.
 *
 * C1 lanes (added, one per new gate):
 *   (a) in-loop metric branch  -- a kernel that branches on a STRING metric per
 *       query and lets a per-query string ESCAPE (retained in a module array; the
 *       "string metric branched per query" anti-pattern 0001 forbids). Its per-call
 *       retained allocation must trip the T6 zero-retention gate (maxBytesPerCall:0).
 *   (b) shared-seed build      -- two "instances" sharing one seed (sharedSeedFactory)
 *       must make T5's instance-isolation law return false.
 *   (c) escaping transient     -- a plain `{}` allocated per query and PUSHED into a
 *       module array read afterwards, so V8 cannot scalar-replace it away (the C0
 *       review's lesson: a non-escaping transient optimizes to nothing, and a
 *       transient the collector settles is invisible to a retained-bytes gate -- so
 *       the honest control genuinely escapes AND is retained). Must trip the T6
 *       zero-retention gate.
 *
 * The whole-suite env controls (CELLULAR_TORTURE_BREAK=1,
 * CELLULAR_TORTURE_SHARED_SEED=1) exit the run non-zero; T9 covers the same lanes
 * here so a plain run already proves each gate bites.
 *
 * @license MIT
 */

import { createCellular, METRIC_EUCLIDEAN } from '../../Cellular.js';
import { createLeakTracker } from '@zakkster/lite-leak';
import { runOpsGate, runAllocGate, die } from './harness.mjs';
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, digest } from '../../goldens/gen.mjs';
import { instanceIsolationHolds, sharedSeedFactory } from './t5-fuzz.mjs';
import { exactPeriodicityHolds } from './t0-laws.mjs';
import { bakeAllocating, bakeComboParse, tileHashRawCell } from './broken.mjs';

/** Escaping sinks for the C2 bake controls, so V8 cannot elide the retained allocs. */
const bakeSink = [];

const NOOP = function () {};
const held = [];

/** Retained sink so the alloc control's allocations survive GC. */
const leak = [];

/** Escaping sinks (arrays) so V8 cannot scalar-replace the retained controls away. */
const escSink = [];
const strSink = [];

function settle() {
    return new Promise((r) => setTimeout(r, 50));
}

export async function run() {
    // Control 1 (C0) -- the whole-window alloc gate. A hot body that retains an
    // allocation every iteration MUST be rejected (maxArrayBuffersGrowth:0 catches
    // the Float64Array backing store; the retention forces the growth).
    {
        const { report } = runOpsGate(() => { leak.push(new Float64Array(64)); }, { ops: 4000, warmup: 0 });
        if (report.ok) die('T9 control(alloc): an allocating hot loop passed the whole-window gate');
        leak.length = 0;
    }

    // Control 2 (C0) -- the golden check is not vacuous: a different seed produces a
    // different digest, so a corrupted golden is caught.
    {
        const good = createCellular(GOLD_SEED, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
        const bad = createCellular(GOLD_SEED + 1, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
        if (digest(good, COORDS) === digest(bad, COORDS)) {
            die('T9 control(golden): the digest is insensitive to the seed -- a corrupted golden would pass');
        }
    }

    // Control (a) -- in-loop STRING metric branch that lets a per-query string
    // escape (retained). The metric-branch anti-pattern allocates; the
    // zero-retention gate bites.
    {
        const inst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const out = { f1: 0, f2: 0, id: 0 };
        const metric = 'euclidean';
        let s = 1;
        const branchy = () => {
            s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
            inst.cellular2((s % 65536) / 64, (s >>> 8) / 64, out);
            // Per-query string metric branch; the result is retained -> allocation.
            const tag = metric === 'manhattan' ? 'L1:' : metric === 'chebyshev' ? 'Linf:' : 'L2:';
            strSink.push(tag + out.f1);
        };
        const { report, result } = runAllocGate(branchy, { iterations: 8000, batches: 4, reps: 1 });
        if (report.verdict !== 'fail') {
            die('T9 control(metric-branch): a per-query string-metric branch passed the zero-retention gate ' +
                '(bytesPerCall=' + result.bytesPerCall + ') -- the branch gate cannot fail');
        }
        strSink.length = 0;
    }

    // Control (c) -- escaping transient object per query, PUSHED into a module array
    // read afterwards so V8 cannot scalar-replace it and the collector cannot settle
    // it away. Must trip the zero-retention gate.
    {
        const inst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        let s = 7;
        const transient = () => {
            s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
            const t = { f1: 0, f2: 0, id: 0 };     // fresh per-query object
            inst.cellular2((s % 65536) / 64, (s >>> 8) / 64, t);
            escSink.push(t);                        // ESCAPES + retained
        };
        const { report, result } = runAllocGate(transient, { iterations: 8000, batches: 4, reps: 1 });
        if (report.verdict !== 'fail') {
            die('T9 control(transient): an escaping per-query {} passed the zero-retention gate ' +
                '(bytesPerCall=' + result.bytesPerCall + ') -- the transient gate cannot fail');
        }
        if (escSink.length === 0) die('T9 control(transient): sink empty -- the escape was elided');
        escSink.length = 0;
    }

    // Control (b) -- the isolation gate. A shared-seed build must make T5's
    // instance-isolation law return false. If it holds, T5 is blind.
    if (instanceIsolationHolds(sharedSeedFactory())) {
        die('T9 control(shared-seed): the isolation law did NOT catch a shared-seed build -- T5 is blind');
    }

    // --- C2 controls: every new gate proven able to fail --------------------

    // C2 (a) -- a baker that allocates a RETAINED per-pixel out-struct (0005
    // anti-pattern). The T6 zero-retention gate must reject it.
    {
        const inst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const dst = new Float64Array(8 * 8);
        // Do NOT clear the sink inside the hot body: the retained per-pixel structs
        // must ACCUMULATE across iterations so measureAllocs reads bytes > 0.
        const hot = () => { bakeAllocating(inst, dst, 8, 8, { combo: 'f1' }, bakeSink); };
        const { report, result } = runAllocGate(hot, { iterations: 300, batches: 4, reps: 1 });
        if (report.verdict !== 'fail') {
            die('T9 control(bake-alloc): a per-pixel-allocating baker passed the zero-retention gate ' +
                '(bytesPerCall=' + result.bytesPerCall + ') -- the bake gate cannot fail');
        }
        bakeSink.length = 0;
    }

    // C2 (b) -- a tiling kernel that hashes the UNWRAPPED cell (wraps the float
    // coord, not the integer cell -- 0006 anti-pattern). It must NOT be exactly
    // periodic; if it is, the T0 periodicity law is blind.
    {
        const inst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const brokenSample = (x, y, P, Q, o) => tileHashRawCell(inst._seed, inst._jitter, P, Q, x, y, o);
        if (exactPeriodicityHolds(brokenSample)) {
            die('T9 control(float-wrap): a raw-cell-hash tiling kernel was still exactly periodic -- the periodicity law is blind');
        }
    }

    // C2 (c) -- a baker that re-parses the combo STRING per pixel (0005 anti-pattern),
    // the parse retained. The zero-retention gate must reject it.
    {
        const inst = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const dst = new Float64Array(8 * 8);
        const hot = () => { bakeComboParse(inst, dst, 8, 8, { combo: 'f2-f1' }, bakeSink); };
        const { report, result } = runAllocGate(hot, { iterations: 300, batches: 4, reps: 1 });
        if (report.verdict !== 'fail') {
            die('T9 control(combo-parse): a per-pixel combo-string-parse baker passed the zero-retention gate ' +
                '(bytesPerCall=' + result.bytesPerCall + ') -- the bake gate cannot fail');
        }
        bakeSink.length = 0;
    }

    // Control 3 (C0) -- the retention detector: a dropped instance must collect
    // (T7's "size 0" is real) AND a retained one must stay live (T7's positive
    // control is real).
    {
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
            die('T9 control(retention-drop): dropped instances not collected (size=' + tracker.size() + ')');
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
            die('T9 control(retention-hold): a retained instance was reported collected (size=' + ctrl.size() + ')');
        }
    }
}
