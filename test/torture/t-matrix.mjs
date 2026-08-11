/**
 * T-MATRIX (C4) -- the cross-product edge-case matrix.
 *
 * Every prior tier gated ONE axis. C4 crosses them:
 *
 *     metric  in { euclidean, manhattan, chebyshev }        (3)
 *     combo   in { f1, f2-f1, f2 }                           (3)  -- bake surfaces only
 *     surface in { cellular, tileable, bake, bake-tiling }   (4)
 *     dim     in { 2D, 3D }                                  (2)
 *
 * and crosses each applicable combination with the adversarial VALUE SET:
 *
 *     0, -0, +Inf, -Inf, NaN, 1e-45 (subnormal), 3.4e38 (f32 max),
 *     16777216 / 16777217 (2^24 int boundary), values one ULP apart,
 *     coords at 1, 1e3, 1e6, 1e7, 2^24 and beyond (the precision walk),
 *     coords straddling 0 and a cell boundary, jitter at exactly 0 and 1,
 *     periods at 1 and huge, bake dims at 1x1(x1) and large.
 *
 * Every cell has a DECIDED outcome -- a `throw`, a documented VALUE, or the pinned
 * precision LIMIT -- behind a NAMED assertion. "Silently returns garbage" is not an
 * allowed outcome: an unpinned cell is the hole, not the pin. The ugly answers (a NaN
 * in -> a pinned throw, a coord past the precision limit -> the pinned collapse) are
 * pinned exactly like the clean ones.
 *
 * CELLULAR_TORTURE_BREAK_MATRIX=1 corrupts ONE pinned answer (via broken.mjs
 * `matrixWrongCell`) so the matrix's equality assertion fires -- proof the matrix
 * ASSERTS, not merely runs. A gate that cannot fail is decorative.
 *
 * @license MIT
 */

import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { assertHot, BREAK_MATRIX } from './harness.mjs';
import { matrixWrongCell } from './broken.mjs';
import { WORLD_SCALE_PRECISE, WORLD_SCALE_DEGENERATE } from './t3-worldscale.mjs';

const METRICS = [
    ['euclid', METRIC_EUCLIDEAN],
    ['manhat', METRIC_MANHATTAN],
    ['cheby', METRIC_CHEBYSHEV],
];

// The value set, split by DECIDED outcome so each group carries one named assertion.
const NONFINITE = [['+Inf', Infinity], ['-Inf', -Infinity], ['NaN', NaN]];   // -> throw
const SUBNORMAL = 1e-45;                        // float32 subnormal; finite ~0 in f64
const F32MAX = 3.4e38;                          // > 2^52 -> degenerate (collapsed)
const INT_LO = 16777216, INT_HI = 16777217;     // 2^24 boundary; both f64-exact, precise
const ULP_A = 1000.5, ULP_B = 1000.5 + 0.00048828125;  // one f64 ULP apart at ~1000 (2^-11)
const PRECISE_MAGS = [1, 1e3, 1e6, 1e7, INT_LO, INT_HI, WORLD_SCALE_PRECISE];
const DEGEN_MAGS = [WORLD_SCALE_DEGENERATE, F32MAX];

/** Metric distance of an axis-offset tuple (jitter=0 nearest-centre helper). */
function metricDist(id, ax, ay, az) {
    if (id === METRIC_MANHATTAN) return az === undefined ? ax + ay : ax + ay + az;
    if (id === METRIC_CHEBYSHEV) return az === undefined ? Math.max(ax, ay) : Math.max(ax, ay, az);
    return az === undefined ? Math.sqrt(ax * ax + ay * ay) : Math.sqrt(ax * ax + ay * ay + az * az);
}

function threw(fn) { try { fn(); return false; } catch (e) { return true; } }

/**
 * Apply the matrix-break corruption to ONE canary expectation. Off the break path this
 * is the identity, so the pin is the real answer; under BREAK_MATRIX it is corrupted so
 * the equality assertion must fail (exiting the run non-zero).
 */
function pin(expected, isCanary) {
    return isCanary && BREAK_MATRIX ? matrixWrongCell(expected) : expected;
}

export function run() {
    run2D();
    run3D();
}

function run2D() {
    const a = { f1: 0, f2: 0, id: 0 };
    const b = { f1: 0, f2: 0, id: 0 };
    const one = new Float64Array(1);
    const big = new Float64Array(64 * 48);
    let canaryUsed = false;

    for (const [mname, id] of METRICS) {
        const j1 = createCellular(42, { metric: id, jitter: 1 });
        const j0 = createCellular(42, { metric: id, jitter: 0 });
        const combos = [['f1', 0], ['f2-f1', 1], ['f2', 2]];

        // -- surface: cellular (query) -------------------------------------------
        // NaN / +/-Inf coord on either axis -> THROW (finite guard, fail closed).
        for (const [vn, v] of NONFINITE) {
            assertHot(threw(() => j1.cellular2(v, 0.5, a)),
                () => `matrix.2D.cellular[${mname}]: coord x=${vn} did not throw`);
            assertHot(threw(() => j1.cellular2(0.5, v, a)),
                () => `matrix.2D.cellular[${mname}]: coord y=${vn} did not throw`);
        }
        // 0 and -0 -> finite, and BIT-IDENTICAL (float -0 === +0 for these kernels).
        j1.cellular2(0, 0, a); j1.cellular2(-0, -0, b);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.2D.cellular[${mname}]: (0,0) not finite/ordered`);
        assertHot(a.f1 === b.f1 && a.f2 === b.f2 && a.id === b.id,
            () => `matrix.2D.cellular[${mname}]: -0 differs from +0 (f1 ${a.f1} vs ${b.f1})`);
        // subnormal -> finite, ordered (treated as ~0).
        j1.cellular2(SUBNORMAL, SUBNORMAL, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.2D.cellular[${mname}]: subnormal not finite/ordered`);
        // int boundary + ULP pair + precise walk -> DISTINCT (f1 < f2), neighbourhood intact.
        for (const mag of PRECISE_MAGS) {
            assertHot(mag <= WORLD_SCALE_PRECISE, () => `matrix.2D.cellular[${mname}]: mag ${mag} exceeds pinned precise limit`);
            j1.cellular2(mag + 0.5, mag + 0.5, a);
            assertHot(Number.isFinite(a.f1) && a.f1 < a.f2,
                () => `matrix.2D.cellular[${mname}]: neighbourhood collapse at precise |coord|=${mag} (f1=${a.f1} f2=${a.f2})`);
        }
        for (const v of [ULP_A, ULP_B]) {
            j1.cellular2(v, v, a);
            assertHot(Number.isFinite(a.f1) && a.f1 < a.f2, () => `matrix.2D.cellular[${mname}]: ULP coord ${v} not distinct`);
        }
        // Beyond the limit (2^52, f32-max) -> PINNED collapse: finite, f1 === f2.
        for (const mag of DEGEN_MAGS) {
            assertHot(mag >= WORLD_SCALE_DEGENERATE, () => `matrix.2D.cellular[${mname}]: degen mag ${mag} below pinned cliff`);
            j1.cellular2(mag, mag, a);
            assertHot(Number.isFinite(a.f1) && a.f1 === a.f2,
                () => `matrix.2D.cellular[${mname}]: expected pinned collapse f1===f2 at ${mag} (f1=${a.f1} f2=${a.f2})`);
        }
        // Cell-boundary straddle + zero-straddle -> finite, ordered, decided.
        for (const base of [0, 5, -3]) {
            for (const d of [0, -1e-9, 1e-9]) {
                j1.cellular2(base + d, base - d, a);
                assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2,
                    () => `matrix.2D.cellular[${mname}]: boundary straddle ${base}+${d} not finite/ordered`);
            }
        }
        // jitter=0 grid: f1 === nearest-centre distance (a pinned VALUE), with a canary.
        {
            const x = 3.3, y = 7.7;
            j0.cellular2(x, y, a);
            const ax = Math.abs(Math.round(x - 0.5) + 0.5 - x), ay = Math.abs(Math.round(y - 0.5) + 0.5 - y);
            const want = metricDist(id, ax, ay);
            const isCanary = !canaryUsed && id === METRIC_EUCLIDEAN;
            if (isCanary) canaryUsed = true;
            assertHot(Math.abs(a.f1 - pin(want, isCanary)) < 1e-9,
                () => `matrix.2D.cellular[${mname}] jitter=0: f1=${a.f1} != nearest-centre ${want}`);
        }

        // -- surface: tileable (query) -------------------------------------------
        for (const [vn, v] of NONFINITE) {
            assertHot(threw(() => j1.tileableCell2(v, 0.5, 8, 8, a)),
                () => `matrix.2D.tileable[${mname}]: coord x=${vn} did not throw`);
        }
        // Bad periods -> THROW (fail closed: 0, negative, non-integer, NaN, Infinity).
        for (const [pn, P, Q] of [['0', 0, 8], ['-1', -1, 8], ['1.5', 1.5, 8], ['NaN', NaN, 8], ['Inf', Infinity, 8]]) {
            assertHot(threw(() => j1.tileableCell2(0.5, 0.5, P, Q, a)),
                () => `matrix.2D.tileable[${mname}]: bad period ${pn} did not throw`);
        }
        // Period 1 (single-cell tile) and huge -> finite, ordered.
        j1.tileableCell2(0.3, 0.7, 1, 1, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.2D.tileable[${mname}]: period 1x1 not finite/ordered`);
        j1.tileableCell2(12345.5, -678.5, 1 << 20, 1 << 20, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.2D.tileable[${mname}]: huge period not finite/ordered`);
        // Exact periodicity across a +period shift (a decided VALUE: bit-identical).
        // Dyadic coord: rx = x - floor(x) is bit-stable under +period only on a
        // representable fraction (0006 Decision 2), so 0.25 not 0.3.
        j1.tileableCell2(0.25, 0.75, 4, 4, a);
        j1.tileableCell2(0.25 + 4, 0.75, 4, 4, b);
        assertHot(a.f1 === b.f1 && a.f2 === b.f2 && a.id === b.id,
            () => `matrix.2D.tileable[${mname}]: not bit-identical across +periodX`);
        // Precise + degenerate walk under tiling (local frame stays precise for the
        // fraction, the wrapped cell stays exact): finite, ordered.
        for (const mag of [1, 1e6, WORLD_SCALE_PRECISE]) {
            j1.tileableCell2(mag + 0.3, mag + 0.7, 16, 16, a);
            assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2,
                () => `matrix.2D.tileable[${mname}]: |coord|=${mag} not finite/ordered under tiling`);
        }

        // -- surface: bake + bake-tiling (scalar per combo) ----------------------
        for (const [combo, sel] of combos) {
            // NaN / Inf origin -> THROW (the finite guard fires inside the loop).
            for (const [vn, v] of NONFINITE) {
                assertHot(threw(() => j1.fillCellField2(one, 1, 1, { combo, ox: v, oy: 0 })),
                    () => `matrix.2D.bake[${mname}/${combo}]: ox=${vn} did not throw`);
            }
            // Bad dims -> THROW.
            assertHot(threw(() => j1.fillCellField2(one, 0, 1, { combo })),
                () => `matrix.2D.bake[${mname}/${combo}]: w=0 did not throw`);
            assertHot(threw(() => j1.fillCellField2(new Float64Array(1), 2, 2, { combo })),
                () => `matrix.2D.bake[${mname}/${combo}]: undersized dst did not throw`);
            // 1x1 bake == per-query combo at the same coord (a pinned VALUE).
            j1.fillCellField2(one, 1, 1, { combo, ox: 3.5, oy: 7.5 });
            j1.cellular2(3.5, 7.5, a);
            const want = sel === 0 ? a.f1 : sel === 1 ? a.f2 - a.f1 : a.f2;
            assertHot(one[0] === want, () => `matrix.2D.bake[${mname}/${combo}]: 1x1 pixel ${one[0]} != per-query ${want}`);
            // Large bake: finite everywhere, dst buffer NOT reallocated.
            const before = big.buffer.byteLength;
            j1.fillCellField2(big, 64, 48, { combo, scale: 0.02 });
            let allFinite = true;
            for (let i = 0; i < 64 * 48; i++) if (!Number.isFinite(big[i])) { allFinite = false; break; }
            assertHot(allFinite, () => `matrix.2D.bake[${mname}/${combo}]: large bake produced a non-finite pixel`);
            assertHot(big.buffer.byteLength === before, () => `matrix.2D.bake[${mname}/${combo}]: dst buffer reallocated`);
            // Degenerate origin: combo f2-f1 collapses to exactly 0 (pinned).
            if (sel === 1) {
                j1.fillCellField2(one, 1, 1, { combo, ox: WORLD_SCALE_DEGENERATE, oy: WORLD_SCALE_DEGENERATE });
                assertHot(one[0] === 0,
                    () => `matrix.2D.bake[${mname}/f2-f1]: expected pinned 0 at degenerate origin (got ${one[0]})`);
            }
            // bake-tiling: partial period -> THROW; full period 1x1 == per-query tile.
            assertHot(threw(() => j1.fillCellField2(one, 1, 1, { combo, periodX: 4 })),
                () => `matrix.2D.bake-tiling[${mname}/${combo}]: partial period did not throw`);
            j1.fillCellField2(one, 1, 1, { combo, ox: 0.5, oy: 0.5, periodX: 4, periodY: 4 });
            j1.tileableCell2(0.5, 0.5, 4, 4, a);
            const wantT = sel === 0 ? a.f1 : sel === 1 ? a.f2 - a.f1 : a.f2;
            assertHot(one[0] === wantT, () => `matrix.2D.bake-tiling[${mname}/${combo}]: 1x1 pixel ${one[0]} != per-query tile ${wantT}`);
        }
    }
}

function run3D() {
    const a = { f1: 0, f2: 0, id: 0 };
    const b = { f1: 0, f2: 0, id: 0 };
    const one = new Float64Array(1);
    const vol = new Float64Array(16 * 12 * 8);

    for (const [mname, id] of METRICS) {
        const j1 = createCellular(42, { metric: id, jitter: 1 });
        const j0 = createCellular(42, { metric: id, jitter: 0 });
        const combos = [['f1', 0], ['f2-f1', 1], ['f2', 2]];

        // -- surface: cellular3 (query) ------------------------------------------
        // Non-finite on ANY of the three axes -> THROW.
        for (const [vn, v] of NONFINITE) {
            assertHot(threw(() => j1.cellular3(v, 0.5, 0.5, a)), () => `matrix.3D.cellular[${mname}]: x=${vn} did not throw`);
            assertHot(threw(() => j1.cellular3(0.5, v, 0.5, a)), () => `matrix.3D.cellular[${mname}]: y=${vn} did not throw`);
            assertHot(threw(() => j1.cellular3(0.5, 0.5, v, a)), () => `matrix.3D.cellular[${mname}]: z=${vn} did not throw`);
        }
        // 0 / -0 on z -> finite and bit-identical.
        j1.cellular3(0.5, 0.5, 0, a); j1.cellular3(0.5, 0.5, -0, b);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.3D.cellular[${mname}]: z=0 not finite/ordered`);
        assertHot(a.f1 === b.f1 && a.f2 === b.f2 && a.id === b.id, () => `matrix.3D.cellular[${mname}]: z=-0 differs from +0`);
        // subnormal z -> finite.
        j1.cellular3(0.5, 0.5, SUBNORMAL, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.3D.cellular[${mname}]: subnormal z not finite/ordered`);
        // Precise walk on the z axis -> distinct.
        for (const mag of PRECISE_MAGS) {
            j1.cellular3(0.5, 0.5, mag + 0.5, a);
            assertHot(Number.isFinite(a.f1) && a.f1 < a.f2,
                () => `matrix.3D.cellular[${mname}]: z-neighbourhood collapse at precise |z|=${mag} (f1=${a.f1} f2=${a.f2})`);
        }
        // Degenerate on z -> pinned collapse f1===f2.
        for (const mag of DEGEN_MAGS) {
            j1.cellular3(mag, mag, mag, a);
            assertHot(Number.isFinite(a.f1) && a.f1 === a.f2,
                () => `matrix.3D.cellular[${mname}]: expected pinned collapse f1===f2 at ${mag} (f1=${a.f1} f2=${a.f2})`);
        }
        // jitter=0 3D grid: f1 === nearest 3D cell-centre distance (pinned VALUE).
        {
            const x = 3.3, y = 7.7, z = 1.4;
            j0.cellular3(x, y, z, a);
            const ax = Math.abs(Math.round(x - 0.5) + 0.5 - x);
            const ay = Math.abs(Math.round(y - 0.5) + 0.5 - y);
            const az = Math.abs(Math.round(z - 0.5) + 0.5 - z);
            const want = metricDist(id, ax, ay, az);
            assertHot(Math.abs(a.f1 - want) < 1e-9, () => `matrix.3D.cellular[${mname}] jitter=0: f1=${a.f1} != nearest-centre ${want}`);
        }

        // -- surface: tileableCell3 (query) --------------------------------------
        for (const [vn, v] of NONFINITE) {
            assertHot(threw(() => j1.tileableCell3(0.5, 0.5, v, 8, 8, 8, a)), () => `matrix.3D.tileable[${mname}]: z=${vn} did not throw`);
        }
        for (const [pn, P, Q, R] of [['0', 0, 8, 8], ['-1', 8, -1, 8], ['1.5z', 8, 8, 1.5], ['NaN', 8, 8, NaN], ['Inf', 8, 8, Infinity]]) {
            assertHot(threw(() => j1.tileableCell3(0.5, 0.5, 0.5, P, Q, R, a)),
                () => `matrix.3D.tileable[${mname}]: bad period ${pn} did not throw`);
        }
        j1.tileableCell3(0.3, 0.7, 0.4, 1, 1, 1, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.3D.tileable[${mname}]: period 1x1x1 not finite/ordered`);
        j1.tileableCell3(0.3, 0.7, 0.4, 1 << 20, 4, 4, a);
        assertHot(Number.isFinite(a.f1) && a.f1 <= a.f2, () => `matrix.3D.tileable[${mname}]: huge periodX not finite/ordered`);
        // Exact periodicity on the z axis (bit-identical across +periodZ). Dyadic z so
        // rz is bit-stable under +period (0006 Decision 2).
        j1.tileableCell3(0.25, 0.75, 0.5, 4, 4, 4, a);
        j1.tileableCell3(0.25, 0.75, 0.5 + 4, 4, 4, 4, b);
        assertHot(a.f1 === b.f1 && a.f2 === b.f2 && a.id === b.id,
            () => `matrix.3D.tileable[${mname}]: not bit-identical across +periodZ`);

        // -- surface: bake3 + bake3-tiling (scalar per combo) --------------------
        for (const [combo, sel] of combos) {
            for (const [vn, v] of NONFINITE) {
                assertHot(threw(() => j1.fillCellField3(one, 1, 1, 1, { combo, oz: v })),
                    () => `matrix.3D.bake[${mname}/${combo}]: oz=${vn} did not throw`);
            }
            assertHot(threw(() => j1.fillCellField3(one, 1, 1, 0, { combo })),
                () => `matrix.3D.bake[${mname}/${combo}]: d=0 did not throw`);
            assertHot(threw(() => j1.fillCellField3(new Float64Array(1), 2, 2, 2, { combo })),
                () => `matrix.3D.bake[${mname}/${combo}]: undersized dst did not throw`);
            // 1x1x1 bake == per-query cellular3 combo.
            j1.fillCellField3(one, 1, 1, 1, { combo, ox: 3.5, oy: 7.5, oz: 1.5 });
            j1.cellular3(3.5, 7.5, 1.5, a);
            const want = sel === 0 ? a.f1 : sel === 1 ? a.f2 - a.f1 : a.f2;
            assertHot(one[0] === want, () => `matrix.3D.bake[${mname}/${combo}]: 1x1x1 pixel ${one[0]} != per-query ${want}`);
            // Large volume: finite everywhere, dst buffer intact.
            const before = vol.buffer.byteLength;
            j1.fillCellField3(vol, 16, 12, 8, { combo, scale: 0.03 });
            let allFinite = true;
            for (let i = 0; i < 16 * 12 * 8; i++) if (!Number.isFinite(vol[i])) { allFinite = false; break; }
            assertHot(allFinite, () => `matrix.3D.bake[${mname}/${combo}]: large volume produced a non-finite voxel`);
            assertHot(vol.buffer.byteLength === before, () => `matrix.3D.bake[${mname}/${combo}]: dst buffer reallocated`);
            if (sel === 1) {
                j1.fillCellField3(one, 1, 1, 1, { combo, ox: WORLD_SCALE_DEGENERATE, oy: WORLD_SCALE_DEGENERATE, oz: WORLD_SCALE_DEGENERATE });
                assertHot(one[0] === 0, () => `matrix.3D.bake[${mname}/f2-f1]: expected pinned 0 at degenerate origin (got ${one[0]})`);
            }
            // bake3-tiling: partial period -> THROW; full 1x1x1 == per-query tile.
            assertHot(threw(() => j1.fillCellField3(one, 1, 1, 1, { combo, periodX: 4, periodY: 4 })),
                () => `matrix.3D.bake-tiling[${mname}/${combo}]: partial period did not throw`);
            j1.fillCellField3(one, 1, 1, 1, { combo, ox: 0.5, oy: 0.5, oz: 0.5, periodX: 4, periodY: 4, periodZ: 4 });
            j1.tileableCell3(0.5, 0.5, 0.5, 4, 4, 4, a);
            const wantT = sel === 0 ? a.f1 : sel === 1 ? a.f2 - a.f1 : a.f2;
            assertHot(one[0] === wantT, () => `matrix.3D.bake-tiling[${mname}/${combo}]: 1x1x1 pixel ${one[0]} != per-query tile ${wantT}`);
        }
    }
}
