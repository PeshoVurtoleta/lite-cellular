/**
 * T3 -- adversarial coordinate stress: the world-scale precision walk, per metric.
 *
 * Fills the C0-reserved slot for the new metrics. At large coords the float64 ULP
 * eventually exceeds the sub-cell offset and `floor(x)`/placement degenerate (the
 * A-01 class). The full 2D+3D sweep is C4's; v1.0.0 PINS the limit here so it is
 * decided when the metrics land, not discovered later.
 *
 * PINNED world-scale precision limit for v1.0.0 (documented in the README):
 *   - At |coord| <= WORLD_SCALE_PRECISE (1e12) the 3x3 neighbourhood is intact:
 *     f1 < f2 stay distinct and a jitter=0 field's f1 matches the independently
 *     computed nearest-centre distance in that metric to < 1e-6, for all three
 *     metrics. Tested at 1, 1e3, 1e6, 1e7, 2^24, 1e8, 1e9, 1e12.
 *   - The hard degeneration boundary is 2^52 (float64 integer precision): at and
 *     beyond it the +/-1 cell offset falls below the ULP, `ix + gx` is identical
 *     for gx in {-1,0,1}, the neighbourhood collapses onto one cell, and f1 == f2.
 *     A documented VALUE (not a throw -- the coord is finite), pinned so a change
 *     is caught.
 *   - Non-finite coords are the throw case (covered by T1).
 *
 * @license MIT
 */

import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { assertHot } from './harness.mjs';

/** Pinned: at or below this magnitude the field stays fully precise (all metrics). */
export const WORLD_SCALE_PRECISE = 1e12;

/** Pinned: the float64 integer-precision cliff where the neighbourhood collapses. */
export const WORLD_SCALE_DEGENERATE = 2 ** 52;

const METRIC_IDS = [
    ['euclid', METRIC_EUCLIDEAN],
    ['manhat', METRIC_MANHATTAN],
    ['cheby', METRIC_CHEBYSHEV],
];

const PRECISE_MAGS = [1, 1e3, 1e6, 1e7, 16777216, 1e8, 1e9, 1e12];

function expected(id, ax, ay) {
    if (id === METRIC_EUCLIDEAN) return Math.sqrt(ax * ax + ay * ay);
    if (id === METRIC_MANHATTAN) return ax + ay;
    return Math.max(ax, ay); // chebyshev
}

export function run() {
    const a = { f1: 0, f2: 0, id: 0 };

    for (const [name, id] of METRIC_IDS) {
        const c = createCellular(42, { metric: id, jitter: 1 });
        const c0 = createCellular(42, { metric: id, jitter: 0 });

        for (const mag of PRECISE_MAGS) {
            assertHot(mag <= WORLD_SCALE_PRECISE,
                () => `T3[${name}]: test magnitude ${mag} exceeds the pinned precise limit`);

            // Distinctness at jitter=1: the neighbourhood is intact, f1 < f2.
            c.cellular2(mag + 0.5, mag + 0.5, a);
            assertHot(Number.isFinite(a.f1) && Number.isFinite(a.f2) && a.f1 < a.f2,
                () => `T3[${name}].distinct: neighbourhood collapse at |coord|=${mag} (f1=${a.f1} f2=${a.f2})`);

            // jitter=0 grid distance still matches the independent nearest-centre
            // computation in this metric.
            const x = mag + 0.3, y = mag + 0.7;
            c0.cellular2(x, y, a);
            const cxc = Math.round(x - 0.5) + 0.5;
            const cyc = Math.round(y - 0.5) + 0.5;
            const exp = expected(id, Math.abs(cxc - x), Math.abs(cyc - y));
            assertHot(Math.abs(a.f1 - exp) < 1e-6,
                () => `T3[${name}].grid: f1=${a.f1} != nearest-centre ${exp} at |coord|=${mag}`);
        }

        // The pinned degeneration boundary: finite coords, no throw, but the
        // neighbourhood has collapsed so f1 == f2.
        c.cellular2(WORLD_SCALE_DEGENERATE, WORLD_SCALE_DEGENERATE, a);
        assertHot(Number.isFinite(a.f1) && a.f1 === a.f2,
            () => `T3[${name}].degenerate: expected f1==f2 at 2^52 (f1=${a.f1} f2=${a.f2}) -- pinned boundary moved`);
    }

    // --- C2: bake + tile parameter extremes (each case decided, none silent) ---
    const inst = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });

    // 1x1 bake: writes exactly one value; equals the per-query at the origin coord.
    {
        const one = new Float64Array(1);
        inst.fillCellField2(one, 1, 1, { combo: 'f1', ox: 3.5, oy: 7.5 });
        inst.cellular2(3.5, 7.5, a);
        assertHot(one[0] === a.f1, () => `T3.bake-1x1: single pixel != per-query f1 (${one[0]} vs ${a.f1})`);
    }

    // Large-ish bake: finite everywhere, no throw, dst buffer intact.
    {
        const LW = 128, LH = 96;
        const big = new Float64Array(LW * LH);
        const before = big.buffer.byteLength;
        inst.fillCellField2(big, LW, LH, { combo: 'f2-f1', scale: 0.02, normalize: true });
        let allFinite = true;
        for (let i = 0; i < big.length; i++) if (!Number.isFinite(big[i]) || big[i] < 0 || big[i] > 1) { allFinite = false; break; }
        assertHot(allFinite, () => `T3.bake-large: a normalized pixel left [0,1] or went non-finite`);
        assertHot(big.buffer.byteLength === before, () => `T3.bake-large: dst buffer reallocated`);
    }

    // Periods at 1 (a single-cell tile) and huge: both finite, no throw.
    {
        inst.tileableCell2(0.3, 0.7, 1, 1, a);
        assertHot(Number.isFinite(a.f1) && Number.isFinite(a.f2) && a.f1 <= a.f2,
            () => `T3.tile-period1: non-finite or f1>f2 at period 1x1`);
        inst.tileableCell2(12345.5, -6789.5, 1 << 20, 1 << 20, a);
        assertHot(Number.isFinite(a.f1) && Number.isFinite(a.f2) && a.f1 <= a.f2,
            () => `T3.tile-huge: non-finite or f1>f2 at a huge period`);
    }

    // World-scale ox/oy: the bake's origin walk hits the same precision limit as the
    // per-query path -- finite, decided, not silent.
    {
        const scan = new Float64Array(4);
        inst.fillCellField2(scan, 4, 1, { combo: 'f1', scale: 1, ox: 1e9, oy: 1e9 });
        let ok = true;
        for (let i = 0; i < 4; i++) if (!Number.isFinite(scan[i]) || scan[i] < 0) ok = false;
        assertHot(ok, () => `T3.bake-worldscale: a pixel at ox=1e9 went non-finite or negative`);
    }

    // combo at each valid value: no throw; and an unknown combo THROWS (fail closed).
    {
        const px = new Float64Array(4);
        for (const combo of ['f1', 'f2-f1', 'cracks', 'f2']) {
            let threw = false;
            try { inst.fillCellField2(px, 4, 1, { combo }); } catch (e) { threw = true; }
            assertHot(!threw, () => `T3.bake-combo: valid combo '${combo}' threw`);
        }
        let threwUnknown = false;
        try { inst.fillCellField2(px, 4, 1, { combo: 'f3' }); } catch (e) { threwUnknown = /unknown combo/.test(e.message); }
        assertHot(threwUnknown, () => `T3.bake-combo: an unknown combo 'f3' did not throw`);
    }

    // Fail-closed period + dst + dim guards on the bake and the query.
    {
        const px = new Float64Array(4);
        let n = 0;
        for (const [P, Q] of [[0, 4], [4, 0], [-1, 4], [4, 1.5], [NaN, 4], [4, Infinity]]) {
            try { inst.tileableCell2(0.5, 0.5, P, Q, a); } catch (e) { n++; }
        }
        assertHot(n === 6, () => `T3.tile-guard: only ${n}/6 bad periods threw`);
        let dtErr = 0;
        try { inst.fillCellField2([0, 0, 0, 0], 4, 1, {}); } catch (e) { dtErr++; }        // not a typed array
        try { inst.fillCellField2(new Float64Array(2), 4, 1, {}); } catch (e) { dtErr++; } // too small
        try { inst.fillCellField2(px, 0, 1, {}); } catch (e) { dtErr++; }                   // non-positive w
        try { inst.fillCellField2(px, 2.5, 1, {}); } catch (e) { dtErr++; }                 // non-integer w
        assertHot(dtErr === 4, () => `T3.bake-guard: only ${dtErr}/4 bad dst/dim throws fired`);
    }

    // --- C3: the world-scale limit applies PER AXIS in 3D (0007) --------------
    // A large z degenerates the same as a large x: the pinned precise limit holds in
    // R^3, and the 2^52 cliff collapses the neighbourhood so f1==f2.
    for (const [name, id] of METRIC_IDS) {
        const c = createCellular(42, { metric: id, jitter: 1 });
        const c0 = createCellular(42, { metric: id, jitter: 0 });
        for (const mag of PRECISE_MAGS) {
            // Large on the z axis specifically -- the axis the 2D sweep never touched.
            c.cellular3(0.5, 0.5, mag + 0.5, a);
            assertHot(Number.isFinite(a.f1) && Number.isFinite(a.f2) && a.f1 < a.f2,
                () => `T3.3D[${name}].distinct-z: neighbourhood collapse at |z|=${mag} (f1=${a.f1} f2=${a.f2})`);
            // jitter=0 grid distance still matches the independent nearest-centre, large z.
            const x = 0.3, y = 0.7, z = mag + 0.3;
            c0.cellular3(x, y, z, a);
            const cxc = Math.round(x - 0.5) + 0.5;
            const cyc = Math.round(y - 0.5) + 0.5;
            const czc = Math.round(z - 0.5) + 0.5;
            const ax = Math.abs(cxc - x), ay = Math.abs(cyc - y), az = Math.abs(czc - z);
            const exp = expected(id, ax, ay) === Math.max(ax, ay) && id === METRIC_CHEBYSHEV
                ? Math.max(ax, ay, az)
                : id === METRIC_MANHATTAN ? ax + ay + az
                : id === METRIC_EUCLIDEAN ? Math.sqrt(ax * ax + ay * ay + az * az)
                : Math.max(ax, ay, az);
            assertHot(Math.abs(a.f1 - exp) < 1e-6,
                () => `T3.3D[${name}].grid-z: f1=${a.f1} != nearest-centre ${exp} at |z|=${mag}`);
        }
        // The 2^52 cliff in 3D: finite, no throw, neighbourhood collapsed -> f1==f2.
        c.cellular3(WORLD_SCALE_DEGENERATE, WORLD_SCALE_DEGENERATE, WORLD_SCALE_DEGENERATE, a);
        assertHot(Number.isFinite(a.f1) && a.f1 === a.f2,
            () => `T3.3D[${name}].degenerate: expected f1==f2 at 2^52 (f1=${a.f1} f2=${a.f2}) -- pinned boundary moved`);
    }

    // C3: extreme periodZ, d=1, and a larger volume bake -- finite, decided, not silent.
    {
        const c = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        c.tileableCell3(0.3, 0.7, 12345.5, 4, 4, 1 << 20, a);
        assertHot(Number.isFinite(a.f1) && Number.isFinite(a.f2) && a.f1 <= a.f2,
            () => `T3.3D.tile-hugeZ: non-finite or f1>f2 at a huge periodZ`);
        // d=1 slab: one z-plane, writes exactly w*h; equals per-query at oz.
        const slab = new Float64Array(5 * 4);
        c.fillCellField3(slab, 5, 4, 1, { combo: 'f1', scale: 0.06, ox: 0.3, oy: -0.2, oz: 2.5 });
        const o = { f1: 0, f2: 0, id: 0 };
        let idx = 0, py = -0.2;
        for (let yy = 0; yy < 4; yy++) {
            let px = 0.3;
            for (let xx = 0; xx < 5; xx++) {
                c.cellular3(px, py, 2.5, o);   // pz fixed at oz=2.5 (d=1)
                assertHot(slab[idx++] === o.f1, () => `T3.3D.bake-d1: slab voxel (${xx},${yy}) != per-query f1`);
                px += 0.06;
            }
            py += 0.06;
        }
        // Larger volume: finite everywhere, no throw, buffer intact.
        const VW = 24, VH = 20, VD = 12;
        const big = new Float64Array(VW * VH * VD);
        const before = big.buffer.byteLength;
        c.fillCellField3(big, VW, VH, VD, { combo: 'f2-f1', scale: 0.03, normalize: true });
        let ok = true;
        for (let i = 0; i < big.length; i++) if (!Number.isFinite(big[i]) || big[i] < 0 || big[i] > 1) { ok = false; break; }
        assertHot(ok, () => `T3.3D.bake-large: a normalized voxel left [0,1] or went non-finite`);
        assertHot(big.buffer.byteLength === before, () => `T3.3D.bake-large: dst buffer reallocated`);
        // Fail-closed guards: bad periods, bad dims.
        let n = 0;
        for (const [P, Q, R] of [[0, 4, 4], [4, 0, 4], [4, 4, 0], [4, 4, 1.5], [NaN, 4, 4], [4, 4, Infinity]]) {
            try { c.tileableCell3(0.5, 0.5, 0.5, P, Q, R, a); } catch (e) { n++; }
        }
        assertHot(n === 6, () => `T3.3D.tile-guard: only ${n}/6 bad periods threw`);
        let dErr = 0;
        try { c.fillCellField3([0, 0], 2, 1, 1, {}); } catch (e) { dErr++; }              // not a typed array
        try { c.fillCellField3(new Float64Array(2), 2, 2, 2, {}); } catch (e) { dErr++; } // too small
        try { c.fillCellField3(new Float64Array(8), 2, 2, 0, {}); } catch (e) { dErr++; } // non-positive d
        try { c.fillCellField3(new Float64Array(8), 2, 2, 1.5, {}); } catch (e) { dErr++; } // non-integer d
        assertHot(dErr === 4, () => `T3.3D.bake-guard: only ${dErr}/4 bad dst/dim throws fired`);
    }
}
