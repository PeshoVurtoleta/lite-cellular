/**
 * T5 -- the NS-01 isolation test. The reason C1's torture matters.
 *
 * The executable form of Law 6 and lite-noise's NS-01 lesson, over a fuzz corpus:
 *
 *   - Instance-vs-instance isolation. Snapshot instance `a`; construct/sample/reseed
 *     a second instance `b`; re-sample `a` -- BIT-IDENTICAL to the snapshot. Neither
 *     construction, sampling, nor reseeding of one instance perturbs another.
 *   - Module-vs-instance isolation. `seedCellular(X)` does NOT change any instance's
 *     field; an instance's `cellular2` never reads `_moduleSeed`.
 *   - reseed reproducibility. sample; reseed(T); reseed(S); re-sample -> identical.
 *   - Interleaved cross-contamination fuzz. Interleave ops on two instances and the
 *     module surface in random order; assert each stream equals running it alone.
 *
 * The positive control: a deliberately-broken build where two "instances" share one
 * seed must make the isolation law FAIL. Exposed as `sharedSeedFactory` so T9 runs
 * it in-process on every plain run, and as the env break
 * `CELLULAR_TORTURE_SHARED_SEED=1` which exits the whole run non-zero. A gate that
 * cannot fail is decorative.
 *
 * @license MIT
 */

import {
    createCellular, cellular2, seedCellular,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { makePrng, SEED, assertHot, die } from './harness.mjs';

/** Env break: run the shared-seed control and exit non-zero (the isolation gate). */
export const SHARED_SEED_BREAK = process.env.CELLULAR_TORTURE_SHARED_SEED === '1';

const SEED_A = 0xa11ce, SEED_B = 0xb0b, SEED_C = 0xc0ffee;
const COORDS = (() => {
    const p = makePrng(SEED ^ 0x5555);
    const arr = [];
    for (let i = 0; i < 64; i++) arr.push([((p() % 20000) / 71) - 140, ((p() % 20000) / 67) - 140]);
    return arr;
})();

/**
 * The correct construction: independent instances. `factory(seed)` returns an
 * object with `.cellular2(x,y,out)` and `.reseed(seed)`.
 */
export function isolatedFactory(seed) {
    return createCellular(seed | 0, { metric: METRIC_EUCLIDEAN, jitter: 1 });
}

/**
 * The BROKEN build: every "instance" from this factory shares one seed cell, so
 * constructing or reseeding one perturbs the others. `instanceIsolationHolds` must
 * return false for this factory -- that is the positive control.
 */
export function sharedSeedFactory() {
    const shared = { seed: 0 };
    return function brokenCreate(seed) {
        const real = createCellular(seed | 0, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        shared.seed = seed | 0;            // last construction wins -- shared, not owned
        return {
            cellular2(x, y, out) { real._seed = shared.seed; return real.cellular2(x, y, out); },
            reseed(s) { shared.seed = s | 0; return this; },
        };
    };
}

/**
 * The instance-vs-instance isolation law as a pure predicate over a factory.
 * Returns true iff instance `a` is bit-identical before and after another instance
 * is constructed, sampled, and reseeded. Zero heap churn beyond one snapshot array.
 *
 * @param {(seed:number)=>{cellular2:Function, reseed:Function}} make
 * @returns {boolean}
 */
export function instanceIsolationHolds(make) {
    const a = make(SEED_A);
    const out = { f1: 0, f2: 0, id: 0 };
    const snap = new Float64Array(COORDS.length * 3);
    for (let i = 0; i < COORDS.length; i++) {
        a.cellular2(COORDS[i][0], COORDS[i][1], out);
        snap[i * 3] = out.f1; snap[i * 3 + 1] = out.f2; snap[i * 3 + 2] = out.id;
    }
    // Construct, sample, and reseed a second instance -- none of which may touch a.
    const b = make(SEED_B);
    for (let i = 0; i < COORDS.length; i++) b.cellular2(COORDS[i][0], COORDS[i][1], out);
    b.reseed(SEED_C);
    for (let i = 0; i < COORDS.length; i++) b.cellular2(COORDS[i][0], COORDS[i][1], out);
    // Re-sample a: must equal the snapshot bit-for-bit.
    for (let i = 0; i < COORDS.length; i++) {
        a.cellular2(COORDS[i][0], COORDS[i][1], out);
        if (out.f1 !== snap[i * 3] || out.f2 !== snap[i * 3 + 1] || out.id !== snap[i * 3 + 2]) return false;
    }
    return true;
}

export function run() {
    // Positive control via env: run the broken build and exit non-zero either way
    // (the isolation gate either trips as designed, or is proven blind -- both fail).
    if (SHARED_SEED_BREAK) {
        if (instanceIsolationHolds(sharedSeedFactory())) {
            die('T5 shared-seed control: the isolation law did NOT catch a shared-seed build -- T5 is blind');
        }
        die('T5 shared-seed control tripped as designed (a shared _moduleSeed broke isolation) -- exiting non-zero');
        return;
    }

    // (1) Instance-vs-instance isolation on the REAL factory: must hold.
    assertHot(instanceIsolationHolds(isolatedFactory),
        () => `T5.isolation: two independent instances cross-contaminated (seed=${SEED})`);

    // (2) Module-vs-instance isolation: seedCellular must not perturb an instance.
    const inst = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const out = { f1: 0, f2: 0, id: 0 };
    const snap = new Float64Array(COORDS.length * 3);
    for (let i = 0; i < COORDS.length; i++) {
        inst.cellular2(COORDS[i][0], COORDS[i][1], out);
        snap[i * 3] = out.f1; snap[i * 3 + 1] = out.f2; snap[i * 3 + 2] = out.id;
    }
    for (const s of [1, 2, 3, 999, SEED_A, SEED_B]) {
        seedCellular(s);
        cellular2(COORDS[0][0], COORDS[0][1], out); // exercise the module surface
    }
    for (let i = 0; i < COORDS.length; i++) {
        inst.cellular2(COORDS[i][0], COORDS[i][1], out);
        assertHot(out.f1 === snap[i * 3] && out.f2 === snap[i * 3 + 1] && out.id === snap[i * 3 + 2],
            () => `T5.module-iso: seedCellular perturbed an instance at coord ${i} (seed=${SEED})`);
    }

    // (3) reseed reproducibility: sample; reseed away; reseed back; identical.
    const rr = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const first = new Float64Array(COORDS.length * 3);
    for (let i = 0; i < COORDS.length; i++) {
        rr.cellular2(COORDS[i][0], COORDS[i][1], out);
        first[i * 3] = out.f1; first[i * 3 + 1] = out.f2; first[i * 3 + 2] = out.id;
    }
    rr.reseed(SEED_B);
    rr.cellular2(COORDS[0][0], COORDS[0][1], out);
    rr.reseed(SEED_A);
    for (let i = 0; i < COORDS.length; i++) {
        rr.cellular2(COORDS[i][0], COORDS[i][1], out);
        assertHot(out.f1 === first[i * 3] && out.f2 === first[i * 3 + 1] && out.id === first[i * 3 + 2],
            () => `T5.reseed: reseed(B) then reseed(A) not reproducible at coord ${i} (seed=${SEED})`);
    }

    // (4) Interleaved cross-contamination fuzz. Build reference streams for two
    // instances and the module surface run ALONE, then run them interleaved in a
    // pseudo-random order and assert each stream matches its reference.
    const A = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const B = createCellular(SEED_B, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    seedCellular(SEED_C);

    const refA = streamAlone((x, y, o) => A.cellular2(x, y, o));
    const refB = streamAlone((x, y, o) => B.cellular2(x, y, o));
    const refM = streamAlone((x, y, o) => cellular2(x, y, o));

    // Reset stream cursors and run interleaved.
    const A2 = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const B2 = createCellular(SEED_B, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    seedCellular(SEED_C);
    const prng = makePrng(SEED ^ 0x9e37);
    const idx = [0, 0, 0];
    const gotA = new Float64Array(COORDS.length * 3);
    const gotB = new Float64Array(COORDS.length * 3);
    const gotM = new Float64Array(COORDS.length * 3);
    const total = COORDS.length * 3;
    for (let k = 0; k < total; k++) {
        let lane = prng() % 3;
        // find a lane that still has work
        while (idx[lane] >= COORDS.length) lane = (lane + 1) % 3;
        const j = idx[lane]++;
        const cx = COORDS[j][0], cy = COORDS[j][1];
        if (lane === 0) { A2.cellular2(cx, cy, out); gotA[j * 3] = out.f1; gotA[j * 3 + 1] = out.f2; gotA[j * 3 + 2] = out.id; }
        else if (lane === 1) { B2.cellular2(cx, cy, out); gotB[j * 3] = out.f1; gotB[j * 3 + 1] = out.f2; gotB[j * 3 + 2] = out.id; }
        else { cellular2(cx, cy, out); gotM[j * 3] = out.f1; gotM[j * 3 + 1] = out.f2; gotM[j * 3 + 2] = out.id; }
    }
    assertHot(eq(gotA, refA), () => `T5.interleave: instance A stream diverged when interleaved (seed=${SEED})`);
    assertHot(eq(gotB, refB), () => `T5.interleave: instance B stream diverged when interleaved (seed=${SEED})`);
    assertHot(eq(gotM, refM), () => `T5.interleave: module stream diverged when interleaved (seed=${SEED})`);

    // --- C2: bake determinism + isolation (0005/0006 fold into NS-01) ---------
    const BW = 24, BH = 20, BN = BW * BH;

    // (5) Two instances baking the SAME field do not cross-contaminate. Bake with a,
    // then bake+reseed b, then re-bake a: bit-identical to the first bake.
    {
        const a = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const b = createCellular(SEED_B, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const fa0 = new Float64Array(BN), fb = new Float64Array(BN), fa1 = new Float64Array(BN);
        a.fillCellField2(fa0, BW, BH, { combo: 'f2-f1', scale: 0.04 });
        b.fillCellField2(fb, BW, BH, { combo: 'f1', scale: 0.04 });
        b.reseed(SEED_C);
        b.fillCellField2(fb, BW, BH, { combo: 'f2', scale: 0.04 });
        a.fillCellField2(fa1, BW, BH, { combo: 'f2-f1', scale: 0.04 });
        assertHot(eq(fa0, fa1),
            () => `T5.bake-iso: instance a's bake changed after activity on instance b (seed=${SEED})`);
    }

    // (6) A bake is reproducible under reseed: bake; reseed away; reseed back; bake
    // again -> identical.
    {
        const c = createCellular(SEED_A, { metric: METRIC_MANHATTAN, jitter: 1 });
        const first = new Float64Array(BN), again = new Float64Array(BN);
        c.fillCellField2(first, BW, BH, { combo: 'f1', scale: 0.05, ox: 1.5, oy: -2.5 });
        c.reseed(SEED_B);
        c.fillCellField2(again, BW, BH, { combo: 'f1', scale: 0.05 });
        c.reseed(SEED_A);
        c.fillCellField2(again, BW, BH, { combo: 'f1', scale: 0.05, ox: 1.5, oy: -2.5 });
        assertHot(eq(first, again),
            () => `T5.bake-reseed: a bake was not reproducible after reseed(B) then reseed(A) (seed=${SEED})`);
    }

    // (7) A tiling bake is independent of the module seed: seedCellular(...) between
    // two identical tiling bakes must not move a single pixel.
    {
        const t = createCellular(SEED_C, { metric: METRIC_CHEBYSHEV, jitter: 1 });
        const before = new Float64Array(BN), after = new Float64Array(BN);
        t.fillCellField2(before, BW, BH, { combo: 'f2-f1', scale: 4 / BW, periodX: 4, periodY: 4 });
        for (const sv of [11, 22, 33, 999]) seedCellular(sv);
        t.fillCellField2(after, BW, BH, { combo: 'f2-f1', scale: 4 / BW, periodX: 4, periodY: 4 });
        assertHot(eq(before, after),
            () => `T5.bake-module-iso: seedCellular perturbed a tiling bake (seed=${SEED})`);
    }

    // --- C3: 3D instance isolation folds into NS-01; 3D bake reseed-reproducible ---

    // (8) Two instances running 3D surfaces do not cross-contaminate. Snapshot a's 3D
    // field; sample + reseed b (both 3D); re-sample a -> bit-identical to the snapshot.
    {
        const a = createCellular(SEED_A, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const b = createCellular(SEED_B, { metric: METRIC_MANHATTAN, jitter: 1 });
        const snap = new Float64Array(COORDS.length * 3);
        for (let i = 0; i < COORDS.length; i++) {
            a.cellular3(COORDS[i][0], COORDS[i][1], COORDS[i][0] - COORDS[i][1], out);
            snap[i * 3] = out.f1; snap[i * 3 + 1] = out.f2; snap[i * 3 + 2] = out.id;
        }
        for (let i = 0; i < COORDS.length; i++) b.cellular3(COORDS[i][0], COORDS[i][1], COORDS[i][0] - COORDS[i][1], out);
        b.reseed(SEED_C);
        for (let i = 0; i < COORDS.length; i++) b.cellular3(COORDS[i][0], COORDS[i][1], COORDS[i][0] - COORDS[i][1], out);
        for (const sv of [11, 22, 999]) seedCellular(sv);   // module churn must not touch a either
        for (let i = 0; i < COORDS.length; i++) {
            a.cellular3(COORDS[i][0], COORDS[i][1], COORDS[i][0] - COORDS[i][1], out);
            assertHot(out.f1 === snap[i * 3] && out.f2 === snap[i * 3 + 1] && out.id === snap[i * 3 + 2],
                () => `T5.3D-iso: instance a's 3D field changed after activity on b/module at coord ${i} (seed=${SEED})`);
        }
    }

    // (9) A 3D bake is reproducible under reseed: bake; reseed away; reseed back; bake
    // again -> identical (plain and tiling).
    {
        const c = createCellular(SEED_A, { metric: METRIC_CHEBYSHEV, jitter: 1 });
        const VW = 10, VH = 8, VD = 6, VN = VW * VH * VD;
        const first = new Float64Array(VN), again = new Float64Array(VN);
        c.fillCellField3(first, VW, VH, VD, { combo: 'f2-f1', scale: 0.05, ox: 1.5, oy: -2.5, oz: 0.5 });
        c.reseed(SEED_B);
        c.fillCellField3(again, VW, VH, VD, { combo: 'f1', scale: 0.05 });
        c.reseed(SEED_A);
        c.fillCellField3(again, VW, VH, VD, { combo: 'f2-f1', scale: 0.05, ox: 1.5, oy: -2.5, oz: 0.5 });
        assertHot(eq(first, again),
            () => `T5.3D-bake-reseed: a 3D bake was not reproducible after reseed(B) then reseed(A) (seed=${SEED})`);
        // A tiling 3D bake is independent of the module seed.
        const before = new Float64Array(VN), after = new Float64Array(VN);
        c.fillCellField3(before, VW, VH, VD, { combo: 'f2', scale: 4 / VW, periodX: 4, periodY: 4, periodZ: 4 });
        for (const sv of [7, 88, 555]) seedCellular(sv);
        c.fillCellField3(after, VW, VH, VD, { combo: 'f2', scale: 4 / VW, periodX: 4, periodY: 4, periodZ: 4 });
        assertHot(eq(before, after),
            () => `T5.3D-bake-module-iso: seedCellular perturbed a tiling 3D bake (seed=${SEED})`);
    }
}

function streamAlone(sample) {
    const out = { f1: 0, f2: 0, id: 0 };
    const buf = new Float64Array(COORDS.length * 3);
    for (let i = 0; i < COORDS.length; i++) {
        sample(COORDS[i][0], COORDS[i][1], out);
        buf[i * 3] = out.f1; buf[i * 3 + 1] = out.f2; buf[i * 3 + 2] = out.id;
    }
    return buf;
}

function eq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
