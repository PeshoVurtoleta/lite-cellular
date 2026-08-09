/**
 * @zakkster/lite-cellular -- torture harness.
 *
 * Shared scratch pool, a zero-alloc assertion, a seeded PRNG, and the two
 * lite-gc-profiler gate wrappers. Every tier imports from here so the discipline
 * lives in one place:
 *
 *   - All scratch (the out-struct, the per-metric sample instances) is allocated
 *     ONCE, here, outside every loop. No `createCellular()` and no out-object
 *     literal on a hot path.
 *   - `assertHot()` builds its message string only on failure -- a template
 *     literal per iteration is an allocation that would fail the T6 gate.
 *   - The PRNG is a seeded xorshift32. On any failure a tier prints SEED and the
 *     op index so the case replays with `TORTURE_SEED=... node test/torture.mjs`.
 *   - lite-gc-profiler is one-measurement-at-a-time; tiers run sequentially,
 *     never nested. `runOpsGate` / `runTransientGate` each open and close a single
 *     window per call.
 *
 * Two gate lanes, both needed (the C0 review's S3 gap):
 *   - `runAllocGate` -- the EXACT, load-bearing zero-alloc gate: measureAllocs with
 *     `maxBytesPerCall: 0`. This measures per-CALL RETAINED bytes (allocation that
 *     survives a forced collection) via a min-over-batches estimator, so `0` is the
 *     literal zero-retention claim (../LiteGcProfiler/llms.txt 172-179). Best-of-N:
 *     a truly zero-alloc kernel reads exactly 0 on at least one rep, so gating the
 *     min removes the rare sub-byte estimator fluke without moving the budget off 0.
 *     A per-query object that is returned/retained (the real regression) reads
 *     ~80 B/call on EVERY rep. This REPLACES the C1-BRIEF S3.3 `maxBytesPerOp: 0`
 *     rate lane: a measureOps allocation RATE has a documented V8 self-noise floor
 *     (llms.txt 168-179, ~250-770 KB per noop window), so a rate can never read 0
 *     and, measured on this workload, does not separate a transient from clean.
 *     measureAllocs is the tool the profiler makes exact for this claim.
 *   - `runOpsGate`  -- whole-window: maxMajor:0 / maxPauseMs:4 /
 *     maxArrayBuffersGrowth:0 (stabilize:'deep'). Catches a RETAINED per-op
 *     ArrayBuffer/heap growth the query path must never produce. Both are exact.
 *
 * @license MIT
 */

import { measureOps, checkNoGc, measureAllocs, checkAllocs } from '@zakkster/lite-gc-profiler';
import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
} from '../../Cellular.js';

/** Seed for every PRNG in the run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x1234abcd;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n; // xorshift32 must not be seeded with 0
})();

/** Deliberately-broken control mode: injects a per-iteration allocation into T6. */
export const BREAK = process.env.CELLULAR_TORTURE_BREAK === '1';

/**
 * C2 break controls (each makes the whole run exit non-zero, proving a gate bites):
 *   - BREAK_BAKER     : T6 gates a baker that allocates a retained per-pixel
 *                       out-struct -- the zero-retention gate must reject it (0005).
 *   - BREAK_COMBOPARSE: T6 gates a baker that parses the combo STRING per pixel and
 *                       retains the parse -- same gate must reject it (0005).
 *   - BREAK_FLOATWRAP : T0 runs the exact-periodicity law against a kernel that wraps
 *                       the FLOAT coord instead of the integer cell -- periodicity
 *                       must break (the 0006 anti-pattern).
 */
export const BREAK_BAKER = process.env.CELLULAR_TORTURE_BREAK_BAKER === '1';
export const BREAK_COMBOPARSE = process.env.CELLULAR_TORTURE_BREAK_COMBOPARSE === '1';
export const BREAK_FLOATWRAP = process.env.CELLULAR_TORTURE_BREAK_FLOATWRAP === '1';

/**
 * Whole-window zero-GC rules. maxArrayBuffersGrowth needs measureOps
 * `stabilize:'deep'` (ArrayBuffer backing stores live outside the V8 heap).
 */
export const RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 };

/**
 * The EXACT zero-retention rule. `0` is the literal per-call zero-allocation claim
 * (measureAllocs measures RETAINED bytes after a forced collection).
 */
export const ALLOC_RULES = { maxBytesPerCall: 0 };

/** The seed the shared sample instances are built with (goldens use 42 separately). */
export const SAMPLE_SEED = 1337;

/**
 * One shared out-struct and one shared Cellular instance PER METRIC, all created
 * ONCE. A tier that samples uses these; nothing on a hot path allocates.
 */
export const OUT = { f1: 0, f2: 0, id: 0 };
export const SAMPLE = createCellular(SAMPLE_SEED, { metric: METRIC_EUCLIDEAN, jitter: 1 });
export const SAMPLE_MAN = createCellular(SAMPLE_SEED, { metric: METRIC_MANHATTAN, jitter: 1 });
export const SAMPLE_CHEB = createCellular(SAMPLE_SEED, { metric: METRIC_CHEBYSHEV, jitter: 1 });

/** The three sample instances tagged with a human name, for tier loops. */
export const SAMPLES = [
    ['euclidean', SAMPLE],
    ['manhattan', SAMPLE_MAN],
    ['chebyshev', SAMPLE_CHEB],
];

/** Seeded xorshift32. Returns a function yielding a uint32 each call. */
export function makePrng(seed) {
    let x = (seed >>> 0) || 1;
    return function next() {
        x ^= x << 13; x >>>= 0;
        x ^= x >> 17;
        x ^= x << 5; x >>>= 0;
        return x >>> 0;
    };
}

/** Fail the whole gate. stdout stays clean; the reason goes to stderr. */
export function die(msg) {
    process.stderr.write('torture: FAIL -- ' + msg + '\n');
    process.exit(1);
}

/**
 * Assertion whose message is built ONLY on failure. Pass a thunk, not a string,
 * so the happy path allocates nothing.
 * @param {boolean} cond
 * @param {() => string} msgThunk
 */
export function assertHot(cond, msgThunk) {
    if (!cond) die(msgThunk());
}

/**
 * Whole-window gate: run `fn(i)` under a single measured window and gate it
 * against RULES. Uses `stabilize:'deep'` so `maxArrayBuffersGrowth` is resolvable.
 * Returns the checkNoGc report plus the raw summary for diagnostics.
 *
 * @param {(i:number)=>void} fn      Sync, zero-alloc hot body.
 * @param {{ops:number, warmup?:number}} opts
 */
export function runOpsGate(fn, opts) {
    const res = measureOps(fn, {
        ops: opts.ops,
        warmup: opts.warmup === undefined ? 0 : opts.warmup,
        stabilize: 'deep',
    });
    return { report: checkNoGc(res.summary, RULES), summary: res.summary };
}

/**
 * The EXACT zero-retention gate: run `fn` through measureAllocs best-of-`reps` and
 * gate the min per-call retained bytes against ALLOC_RULES (maxBytesPerCall:0).
 * Best-of-N gates the minimum so the rare sub-byte estimator fluke on genuinely
 * zero-alloc code cannot fail the gate, while a real per-call allocation (~tens of
 * bytes on every rep) still trips it. The budget stays 0.
 *
 * @param {(i:number)=>void} fn      Sync hot body (one call = one op).
 * @param {{iterations?:number, batches?:number, reps?:number}} [opts]
 */
export function runAllocGate(fn, opts) {
    const iterations = opts && opts.iterations ? opts.iterations : 20000;
    const batches = opts && opts.batches ? opts.batches : 8;
    const reps = opts && opts.reps ? opts.reps : 5;
    let best = null;
    for (let k = 0; k < reps; k++) {
        const res = measureAllocs(fn, { iterations, batches });
        if (best === null || res.bytesPerCall < best.bytesPerCall) best = res;
    }
    return { report: checkAllocs(best, ALLOC_RULES), result: best };
}
