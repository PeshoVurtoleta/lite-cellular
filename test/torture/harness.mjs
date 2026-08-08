/**
 * @zakkster/lite-cellular -- torture harness.
 *
 * Shared scratch pool, a zero-alloc assertion, a seeded PRNG, and the
 * lite-gc-profiler gate wrapper. Every tier imports from here so the discipline
 * lives in one place:
 *
 *   - All scratch (the out-struct, the sample Cellular instance) is allocated
 *     ONCE, here, outside every loop. No `createCellular()` and no out-object
 *     literal on a hot path.
 *   - `assertHot()` builds its message string only on failure -- a template
 *     literal per iteration is an allocation that would fail the T6 gate.
 *   - The PRNG is a seeded xorshift32. On any failure a tier prints SEED and the
 *     op index so the case replays with `TORTURE_SEED=... node test/torture.mjs`.
 *   - lite-gc-profiler is one-measurement-at-a-time; tiers run sequentially,
 *     never nested. `runOpsGate` opens and closes a single window per call.
 *
 * @license MIT
 */

import { measureOps, checkNoGc } from '@zakkster/lite-gc-profiler';
import { createCellular, METRIC_EUCLIDEAN } from '../../Cellular.js';

/** Seed for every PRNG in the run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x1234abcd;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n; // xorshift32 must not be seeded with 0
})();

/** Deliberately-broken control mode: injects a per-iteration allocation into T6. */
export const BREAK = process.env.CELLULAR_TORTURE_BREAK === '1';

/** Base zero-GC rules. maxArrayBuffersGrowth needs measureOps `stabilize:'deep'`. */
export const RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 };

/** The seed the shared sample instance is built with (goldens use 42 separately). */
export const SAMPLE_SEED = 1337;

/**
 * One shared out-struct and one shared Cellular instance, both created ONCE. A
 * tier that samples uses these; nothing on a hot path allocates.
 */
export const OUT = { f1: 0, f2: 0, id: 0 };
export const SAMPLE = createCellular(SAMPLE_SEED, { metric: METRIC_EUCLIDEAN, jitter: 1 });

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
 * Run `fn(i)` under a single measured window and gate it against RULES. Uses
 * `stabilize:'deep'` so `maxArrayBuffersGrowth` is resolvable (ArrayBuffer
 * backing stores live outside the V8 heap where a plain heap gate is blind).
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
