/**
 * @zakkster/lite-cellular -- node:test unit suite (v1.1.0 / C2).
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    createCellular, Cellular, VERSION,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
    cellular2 as moduleCellular2, seedCellular,
} from '../Cellular.js';
import {
    COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, METRICS, digest,
    COORDS3, METRICS3, digest3,
} from '../goldens/gen.mjs';
import { createNoise } from '@zakkster/lite-noise';
import { seamlessScore } from '@zakkster/lite-patternforge';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Construction -----------------------------------------------------------

test('construction: exported surface and defaults', () => {
    assert.equal(VERSION, '1.2.0');
    assert.equal(METRIC_EUCLIDEAN, 0);
    assert.equal(METRIC_MANHATTAN, 1);
    assert.equal(METRIC_CHEBYSHEV, 2);
    const c = createCellular(42);
    assert.ok(c instanceof Cellular);
    // Defaults: euclidean metric, jitter 1.
    assert.equal(c._metric, METRIC_EUCLIDEAN);
    assert.equal(c._jitter, 1);
    assert.equal(c._seed, 42);
});

test('construction: explicit valid metric and jitter accepted', () => {
    const c = createCellular(1, { metric: METRIC_EUCLIDEAN, jitter: 0 });
    assert.equal(c._jitter, 0);
    const d = createCellular(1, { jitter: 0.5 });
    assert.equal(d._jitter, 0.5);
    const e = createCellular(1, { jitter: 1 });
    assert.equal(e._jitter, 1);
});

test('construction: all three metric ids 0/1/2 construct (C1 opens 1 and 2)', () => {
    for (const id of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(7, { metric: id });
        assert.equal(c._metric, id);
        // sampling works and returns the shape
        const r = c.cellular2(1.5, 2.5);
        assert.deepEqual(Object.keys(r).sort(), ['f1', 'f2', 'id']);
    }
});

test('construction: an out-of-set metric id throws (fail-closed, guard widened not loosened)', () => {
    // 0/1/2 are accepted; everything else still throws.
    for (const bad of [3, -1, 1.5, 'euclidean', null, NaN, Infinity]) {
        assert.throws(() => createCellular(0, { metric: bad }), /unknown metric id/, 'metric=' + String(bad));
    }
});

test('construction: out-of-range or non-finite jitter throws', () => {
    for (const bad of [-0.1, 1.1, NaN, Infinity, -Infinity, '0.5', null]) {
        assert.throws(() => createCellular(0, { jitter: bad }),
            /jitter must be a finite number/, 'jitter=' + String(bad));
    }
});

test('construction: jitter boundary values 0 and 1 are accepted', () => {
    assert.doesNotThrow(() => createCellular(0, { jitter: 0 }));
    assert.doesNotThrow(() => createCellular(0, { jitter: 1 }));
});

// --- cellular2: the door ----------------------------------------------------

test('cellular2: non-finite coords are rejected at the door', () => {
    const c = createCellular(3);
    for (const [x, y] of [[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [NaN, NaN]]) {
        assert.throws(() => c.cellular2(x, y), /requires finite x and y/,
            `(${x},${y})`);
    }
});

// --- cellular2: values ------------------------------------------------------

test('cellular2: jitter=0 hand-pinned distances (exact)', () => {
    const c = createCellular(7, { jitter: 0 });
    // Query exactly at cell (2,2)'s centre -> f1 = 0, f2 = 1 (a neighbour centre).
    const r = c.cellular2(2.5, 2.5);
    assert.equal(r.f1, 0);
    assert.equal(r.f2, 1);
    // id is a signed int32 (SMI-safe): equal to its own `| 0`, an integer.
    assert.ok(Number.isInteger(r.id));
    assert.equal(r.id | 0, r.id);
});

test('cellular2: jitter=0 off-centre distance matches nearest cell centre', () => {
    const c = createCellular(11, { jitter: 0 });
    const x = 5.3, y = 8.8;
    const r = c.cellular2(x, y);
    const cxc = Math.round(x - 0.5) + 0.5;
    const cyc = Math.round(y - 0.5) + 0.5;
    const expected = Math.hypot(cxc - x, cyc - y);
    assert.ok(Math.abs(r.f1 - expected) < 1e-12, `f1=${r.f1} expected=${expected}`);
});

test('cellular2: f1 <= f2 and both >= 0 over a sweep', () => {
    const c = createCellular(99, { jitter: 1 });
    for (let i = 0; i < 500; i++) {
        const x = (i * 7.31) - 100;
        const y = (i * 3.97) - 40;
        const r = c.cellular2(x, y);
        assert.ok(r.f1 >= 0 && r.f2 >= 0 && r.f1 <= r.f2 && Number.isFinite(r.f2),
            `f1=${r.f1} f2=${r.f2} at (${x},${y})`);
    }
});

test('cellular2: out is written in place and returned', () => {
    const c = createCellular(5);
    const out = { f1: -1, f2: -1, id: -1 };
    const r = c.cellular2(1.25, 6.75, out);
    assert.equal(r, out, 'returns the same out reference');
    assert.notEqual(out.f1, -1);
    assert.ok(out.f1 <= out.f2);
});

test('cellular2: omitted out returns the reused instance struct', () => {
    const c = createCellular(5);
    const r1 = c.cellular2(1.25, 6.75);
    assert.equal(r1, c._out, 'omitted out returns the reused instance struct');
    const f1a = r1.f1;
    const r2 = c.cellular2(20.5, 30.5);
    assert.equal(r2, r1, 'same object identity is reused across calls');
    assert.notEqual(r2.f1, f1a, 'values are overwritten in place');
});

// --- Determinism ------------------------------------------------------------

test('determinism: same seed + coord -> identical f1/f2/id', () => {
    const a = createCellular(2024);
    const b = createCellular(2024);
    for (let i = 0; i < 100; i++) {
        const x = i * 1.618 - 30, y = i * 2.414 - 50;
        const ra = a.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const rb = b.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        assert.equal(ra.f1, rb.f1);
        assert.equal(ra.f2, rb.f2);
        assert.equal(ra.id, rb.id);
    }
});

test('reseed: changes the field and is reproducible', () => {
    const c = createCellular(1, { jitter: 1 });
    const base = c.cellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    const baseF1 = base.f1, baseId = base.id;

    c.reseed(2);
    const other = c.cellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    // A different seed should move the field (id near-certainly changes).
    assert.notEqual(other.id, baseId);

    // Reseeding back reproduces the original field exactly.
    c.reseed(1);
    const again = c.cellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    assert.equal(again.f1, baseF1);
    assert.equal(again.id, baseId);
});

test('reseed: returns this for chaining', () => {
    const c = createCellular(1);
    assert.equal(c.reseed(9), c);
});

// --- Metrics ----------------------------------------------------------------

test('metrics: jitter=0 hand-pinned manhattan and chebyshev distances (exact)', () => {
    // jitter=0 -> feature points sit at cell centres. Query at cell (2,2)'s centre:
    // f1 = 0 (the centre itself); f2 = the nearest neighbour centre, which is 1
    // away in BOTH manhattan (|1|+|0|) and chebyshev (max(1,0)) units.
    for (const id of [METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(7, { metric: id, jitter: 0 });
        const r = c.cellular2(2.5, 2.5);
        assert.equal(r.f1, 0, 'metric ' + id + ' f1 at centre');
        assert.equal(r.f2, 1, 'metric ' + id + ' f2 to nearest neighbour centre');
        assert.ok(Number.isInteger(r.id) && (r.id | 0) === r.id);
    }
    // An off-centre manhattan case: nearest centre of (5,8) from (5.3,8.8) is
    // (5.5,8.5), so L1 = |5.5-5.3| + |8.5-8.8| = 0.2 + 0.3 = 0.5.
    const man = createCellular(11, { metric: METRIC_MANHATTAN, jitter: 0 });
    const rm = man.cellular2(5.3, 8.8);
    assert.ok(Math.abs(rm.f1 - 0.5) < 1e-12, `manhattan f1=${rm.f1} expected 0.5`);
    // Chebyshev at the same point: Linf = max(0.2, 0.3) = 0.3.
    const cheb = createCellular(11, { metric: METRIC_CHEBYSHEV, jitter: 0 });
    const rc = cheb.cellular2(5.3, 8.8);
    assert.ok(Math.abs(rc.f1 - 0.3) < 1e-12, `chebyshev f1=${rc.f1} expected 0.3`);
});

test('metrics: sanity ordering cheby <= euclid <= manhattan on a fixed triple (f1 AND f2)', () => {
    // Same seed + jitter -> identical feature placement, so this is purely the
    // Linf <= L2 <= L1 order-statistic inequality. f2 is checked too: the ordering
    // holds for the second rank because order statistics are monotone under
    // elementwise domination -- do NOT drop the f2 line as redundant.
    const e = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const m = createCellular(42, { metric: METRIC_MANHATTAN, jitter: 1 });
    const c = createCellular(42, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    for (const [x, y] of [[3.5, 7.25], [0.1, 0.9], [-4.4, 2.2], [123.4, -56.7]]) {
        const re = e.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const rm = m.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const rc = c.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        assert.ok(rc.f1 <= re.f1 + 1e-9 && re.f1 <= rm.f1 + 1e-9, `f1 order at (${x},${y})`);
        assert.ok(rc.f2 <= re.f2 + 1e-9 && re.f2 <= rm.f2 + 1e-9, `f2 order at (${x},${y})`);
    }
});

test('metrics: manhattan/chebyshev report LINEAR units (no sqrt) -- f1/f2 are raw distances', () => {
    // A jitter=0 grid gives an exact reference: manhattan f2 to the diagonal
    // neighbour (1,1) away is 2 (|1|+|1|), chebyshev is 1 (max(1,1)).
    const man = createCellular(3, { metric: METRIC_MANHATTAN, jitter: 0 });
    const cheb = createCellular(3, { metric: METRIC_CHEBYSHEV, jitter: 0 });
    // At an exact centre, f1=0; f2 is the nearest of the 8 neighbour centres.
    const rm = man.cellular2(0.5, 0.5);
    const rc = cheb.cellular2(0.5, 0.5);
    assert.equal(rm.f2, 1, 'manhattan nearest neighbour centre is an axis cell (L1=1)');
    assert.equal(rc.f2, 1, 'chebyshev nearest neighbour centre (Linf=1)');
});

// --- Module surface ---------------------------------------------------------

test('module surface: module cellular2 == an equivalent euclidean instance at the same shared seed', () => {
    seedCellular(2024);
    const inst = createCellular(2024, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    for (const [x, y] of [[3.5, 7.25], [-1.1, 2.2], [42.5, 42.5]]) {
        const rmod = moduleCellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const rins = inst.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        assert.equal(rmod.f1, rins.f1);
        assert.equal(rmod.f2, rins.f2);
        assert.equal(rmod.id, rins.id);
    }
});

test('module surface: seedCellular changes the module field and is reproducible', () => {
    seedCellular(1);
    const a = moduleCellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    const aId = a.id;
    seedCellular(2);
    const b = moduleCellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    assert.notEqual(b.id, aId, 'a different module seed moves the field');
    seedCellular(1);
    const again = moduleCellular2(3.3, 4.4, { f1: 0, f2: 0, id: 0 });
    assert.equal(again.id, aId, 'reseeding back reproduces the module field exactly');
});

test('module surface: seedCellular dev-warn fires once on the 2nd call', async () => {
    // The warn-once counter is module-global and already tripped by earlier tests
    // in this process, so import a FRESH module instance (cache-busted) to observe
    // the first-2nd-call behaviour from a clean _seedCalls = 0.
    const fresh = await import('../Cellular.js?warnonce=1');
    const origWarn = console.warn;
    const origEnv = process.env.NODE_ENV;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
        delete process.env.NODE_ENV; // ensure NOT production so the dev-warn can fire
        fresh.seedCellular(1);
        assert.equal(warned, 0, 'first call must be silent');
        fresh.seedCellular(2);
        assert.equal(warned, 1, 'second call fires the dev-warn once');
        fresh.seedCellular(3);
        assert.equal(warned, 1, 'the warning fires only once, not on every subsequent call');
    } finally {
        console.warn = origWarn;
        if (origEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = origEnv;
    }
});

test('module surface: seedCellular is silent when NODE_ENV===production', async () => {
    const fresh = await import('../Cellular.js?warnprod=1');
    const origWarn = console.warn;
    const origEnv = process.env.NODE_ENV;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
        process.env.NODE_ENV = 'production';
        fresh.seedCellular(1);
        fresh.seedCellular(2);
        fresh.seedCellular(3);
        assert.equal(warned, 0, 'seedCellular must be silent when NODE_ENV===production');
    } finally {
        console.warn = origWarn;
        if (origEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = origEnv;
    }
});

// --- Isolation (the unit-test companion to torture T5) ----------------------

test('isolation: two instances do not cross-contaminate', () => {
    const a = createCellular(111, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const b = createCellular(222, { metric: METRIC_MANHATTAN, jitter: 1 });
    const snap = [];
    for (let i = 0; i < 16; i++) snap.push(a.cellular2(i * 1.3 - 8, i * 0.7 - 4, { f1: 0, f2: 0, id: 0 }).id);
    // Sample and reseed b -- must not touch a.
    for (let i = 0; i < 16; i++) b.cellular2(i * 1.3 - 8, i * 0.7 - 4);
    b.reseed(333);
    for (let i = 0; i < 16; i++) b.cellular2(i * 1.3 - 8, i * 0.7 - 4);
    for (let i = 0; i < 16; i++) {
        const id = a.cellular2(i * 1.3 - 8, i * 0.7 - 4, { f1: 0, f2: 0, id: 0 }).id;
        assert.equal(id, snap[i], 'instance a perturbed by activity on instance b');
    }
});

test('isolation: seedCellular does not perturb an instance', () => {
    const inst = createCellular(111, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const before = inst.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 }).id;
    for (const s of [1, 2, 3, 999]) seedCellular(s);
    const after = inst.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 }).id;
    assert.equal(after, before, 'an instance must never read the shared module seed');
});

// --- Field bake (C2) --------------------------------------------------------

test('field bake: writes w*h in place, returns dst', () => {
    const c = createCellular(42);
    const dst = new Float64Array(8 * 6).fill(-1);
    const r = c.fillCellField2(dst, 8, 6, { combo: 'f1', scale: 0.05 });
    assert.equal(r, dst, 'returns the same dst reference');
    for (let i = 0; i < dst.length; i++) assert.ok(dst[i] >= 0 && Number.isFinite(dst[i]), 'pixel ' + i);
});

test('field bake: a hand-pinned small field matches per-query values, bit-for-bit', () => {
    const c = createCellular(2024, { metric: METRIC_MANHATTAN, jitter: 1 });
    const w = 5, h = 4, scale = 0.07, ox = 0.3, oy = -0.2;
    const dst = new Float64Array(w * h);
    c.fillCellField2(dst, w, h, { combo: 'f2', scale, ox, oy });
    const o = { f1: 0, f2: 0, id: 0 };
    let idx = 0, py = oy;
    for (let y = 0; y < h; y++) {
        let px = ox;
        for (let x = 0; x < w; x++) {
            c.cellular2(px, py, o);
            assert.equal(dst[idx++], o.f2, `pixel (${x},${y})`);
            px += scale;
        }
        py += scale;
    }
});

test('field bake: Float32Array dst is accepted', () => {
    const c = createCellular(1);
    const dst = new Float32Array(16);
    assert.doesNotThrow(() => c.fillCellField2(dst, 4, 4, { combo: 'f1' }));
});

test('field bake: undersized or wrong-type dst throws (fail closed)', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(new Float64Array(3), 4, 4), /dst too small/);
    assert.throws(() => c.fillCellField2([0, 0, 0, 0], 2, 2), /typed-array dst/);
    assert.throws(() => c.fillCellField2(new DataView(new ArrayBuffer(64)), 2, 2), /typed-array dst/);
});

test('field bake: non-positive-integer w/h throws', () => {
    const c = createCellular(1);
    const dst = new Float64Array(64);
    for (const [w, h] of [[0, 4], [4, 0], [-1, 4], [2.5, 4], [4, NaN], [4, Infinity]]) {
        assert.throws(() => c.fillCellField2(dst, w, h), /positive integer w and h/, `(${w},${h})`);
    }
});

// --- Combo (C2) -------------------------------------------------------------

test('combo: f1 / f2-f1 / cracks / f2 select correctly; cracks == f2-f1', () => {
    const c = createCellular(7);
    const w = 12, h = 12, n = w * h;
    const f1 = new Float64Array(n), f2 = new Float64Array(n), d = new Float64Array(n), cr = new Float64Array(n);
    c.fillCellField2(f1, w, h, { combo: 'f1' });
    c.fillCellField2(f2, w, h, { combo: 'f2' });
    c.fillCellField2(d, w, h, { combo: 'f2-f1' });
    c.fillCellField2(cr, w, h, { combo: 'cracks' });
    for (let i = 0; i < n; i++) {
        assert.equal(d[i], f2[i] - f1[i], 'f2-f1 pixel ' + i);
        assert.equal(cr[i], d[i], 'cracks alias pixel ' + i);
        assert.ok(f1[i] <= f2[i], 'f1<=f2 pixel ' + i);
    }
});

test('combo: an unknown combo throws with a did-you-mean hint', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { combo: 'f3' }),
        /unknown combo 'f3'.*'f1', 'f2-f1' \(alias 'cracks'\), or 'f2'/);
});

// --- Normalize (C2) ---------------------------------------------------------

test('normalize: opt-in remaps to [0,1]; off by default leaves the raw range', () => {
    const c = createCellular(11);
    const w = 20, h = 20, n = w * h;
    const raw = new Float64Array(n), nrm = new Float64Array(n);
    c.fillCellField2(raw, w, h, { combo: 'f1', scale: 0.05 });
    c.fillCellField2(nrm, w, h, { combo: 'f1', scale: 0.05, normalize: true });
    // Off by default leaves the raw distance range: raw min is not pinned to 0 nor max to 1.
    let rawMin = Infinity, rawMax = -Infinity;
    for (let i = 0; i < n; i++) { rawMin = Math.min(rawMin, raw[i]); rawMax = Math.max(rawMax, raw[i]); }
    assert.ok(!(Math.abs(rawMin) < 1e-12 && Math.abs(rawMax - 1) < 1e-12), 'raw field is NOT already [0,1] (normalize is a real op)');
    // Opt-in remaps to exact [0,1].
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { mn = Math.min(mn, nrm[i]); mx = Math.max(mx, nrm[i]); }
    assert.ok(Math.abs(mn - 0) < 1e-12 && Math.abs(mx - 1) < 1e-12, `normalized range [${mn},${mx}]`);
    // The normalized field preserves ordering: argmin(raw) -> 0, argmax(raw) -> 1.
    for (let i = 0; i < n; i++) {
        if (raw[i] === rawMin) assert.ok(Math.abs(nrm[i]) < 1e-12, 'raw min maps to 0');
        if (raw[i] === rawMax) assert.ok(Math.abs(nrm[i] - 1) < 1e-12, 'raw max maps to 1');
    }
});

test('normalize: a constant field maps to all-zero (no NaN, no divide-by-zero)', () => {
    // jitter=0 at each cell centre gives f1=0 everywhere -> a constant (zero) field.
    const c = createCellular(3, { jitter: 0 });
    const w = 4, h = 4, n = w * h;
    const dst = new Float64Array(n);
    // Sample exactly at cell centres: ox=0.5, scale=1 -> every pixel is a centre, f1=0.
    c.fillCellField2(dst, w, h, { combo: 'f1', scale: 1, ox: 0.5, oy: 0.5, normalize: true });
    for (let i = 0; i < n; i++) assert.equal(dst[i], 0, 'constant field pixel ' + i + ' -> 0, not NaN');
});

// --- Tileable (C2) ----------------------------------------------------------

test('tileable: exact periodicity on opposite edges (bit-identical f1/f2/id)', () => {
    for (const id of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(1337, { metric: id, jitter: 1 });
        const P = 4, Q = 8;
        const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
        // Dyadic coords so the query fraction is bit-stable across the +period shift.
        for (let k = -3; k <= 3; k++) for (let j = 0; j < 64; j += 7) {
            const x = k + j / 64, y = (k * 2) + (j % 32) / 64;
            c.tileableCell2(x, y, P, Q, a);
            c.tileableCell2(x + P, y, P, Q, b);
            assert.equal(b.f1, a.f1); assert.equal(b.f2, a.f2); assert.equal(b.id, a.id);
            c.tileableCell2(x, y + Q, P, Q, b);
            assert.equal(b.f1, a.f1); assert.equal(b.f2, a.f2); assert.equal(b.id, a.id);
        }
    }
});

test('tileable: id repeats across tiles (a region tag flat-shades every copy)', () => {
    const c = createCellular(99, { jitter: 1 });
    const P = 3, Q = 3;
    const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
    c.tileableCell2(1.5, 1.5, P, Q, a);
    c.tileableCell2(1.5 + P, 1.5 + Q, P, Q, b);
    assert.equal(b.id, a.id, 'id at (1.5,1.5) repeats at (1.5+P, 1.5+Q)');
});

test('tileable: non-integer / <1 / NaN / Infinity period throws (fail closed)', () => {
    const c = createCellular(1);
    for (const [P, Q] of [[0, 4], [4, 0], [-1, 4], [4, -2], [1.5, 4], [4, 2.5], [NaN, 4], [4, NaN], [Infinity, 4], [4, Infinity]]) {
        assert.throws(() => c.tileableCell2(0.5, 0.5, P, Q), /positive integer periodX and periodY/, `(${P},${Q})`);
    }
});

test('tileable: period 1x1 and a huge period are finite, no throw', () => {
    const c = createCellular(1);
    for (const [P, Q] of [[1, 1], [1 << 20, 1 << 20]]) {
        const r = c.tileableCell2(3.3, 4.4, P, Q);
        assert.ok(Number.isFinite(r.f1) && Number.isFinite(r.f2) && r.f1 <= r.f2, `period ${P}x${Q}`);
    }
});

// --- Seam (C2) --------------------------------------------------------------

function paintSeamU32(field, w, h, lut) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;
    const tex = new Uint32Array(field.length);
    for (let i = 0; i < field.length; i++) tex[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;
    return tex;
}

test('seam: cellular tile seamlessScore is near-zero and below a gradient tile', () => {
    const W = 256, H = 256, P = 4;
    const lut = bakeGradientToLut(gradientOcean, 256);
    const cell = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const cf = new Float64Array(W * H);
    cell.fillCellField2(cf, W, H, { combo: 'f1', scale: P / W, periodX: P, periodY: P });
    const cellScore = seamlessScore(paintSeamU32(cf, W, H, lut), W, H);

    const noise = createNoise(42);
    const nf = new Float64Array(W * H);
    noise.tileableField2(nf, W, H, { model: 'fbm', periodX: P, periodY: P, octaves: 5 });
    const gradScore = seamlessScore(paintSeamU32(nf, W, H, lut), W, H);

    assert.ok(cellScore.overall < 0.02, `cellular overall ${cellScore.overall} not near-zero (< 0.02)`);
    assert.ok(cellScore.overall < gradScore.overall,
        `cellular ${cellScore.overall} not below gradient ${gradScore.overall}`);
});

// --- 3D metrics (C3) --------------------------------------------------------

test('cellular3: non-finite coords are rejected at the door (x, y, or z)', () => {
    const c = createCellular(3);
    for (const [x, y, z] of [[NaN, 0, 0], [0, NaN, 0], [0, 0, NaN], [Infinity, 0, 0], [0, -Infinity, 0], [0, 0, Infinity]]) {
        assert.throws(() => c.cellular3(x, y, z), /requires finite x, y and z/, `(${x},${y},${z})`);
    }
});

test('cellular3: jitter=0 hand-pinned distance to the known nearest 3D centre (exact)', () => {
    // jitter=0 -> feature points sit at cell centres. Query exactly at cell (2,2,2)'s
    // centre -> f1 = 0, f2 = 1 (an axis-neighbour centre, 1 away in all three metrics).
    for (const id of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(7, { metric: id, jitter: 0 });
        const r = c.cellular3(2.5, 2.5, 2.5);
        assert.equal(r.f1, 0, 'metric ' + id + ' f1 at centre');
        assert.equal(r.f2, 1, 'metric ' + id + ' f2 to nearest neighbour centre');
        assert.ok(Number.isInteger(r.id) && (r.id | 0) === r.id);
    }
    // Off-centre euclidean: nearest centre of (5,8,3) from (5.3,8.8,3.1) is
    // (5.5,8.5,3.5), so L2 = sqrt(0.2^2 + 0.3^2 + 0.4^2).
    const e = createCellular(11, { jitter: 0 });
    const re = e.cellular3(5.3, 8.8, 3.1);
    const exp = Math.sqrt(0.2 * 0.2 + 0.3 * 0.3 + 0.4 * 0.4);
    assert.ok(Math.abs(re.f1 - exp) < 1e-12, `euclid3 f1=${re.f1} expected ${exp}`);
    // Manhattan at the same point: 0.2 + 0.3 + 0.4 = 0.9.
    const m = createCellular(11, { metric: METRIC_MANHATTAN, jitter: 0 });
    const rm = m.cellular3(5.3, 8.8, 3.1);
    assert.ok(Math.abs(rm.f1 - 0.9) < 1e-12, `manhattan3 f1=${rm.f1} expected 0.9`);
    // Chebyshev: max(0.2, 0.3, 0.4) = 0.4.
    const ch = createCellular(11, { metric: METRIC_CHEBYSHEV, jitter: 0 });
    const rc = ch.cellular3(5.3, 8.8, 3.1);
    assert.ok(Math.abs(rc.f1 - 0.4) < 1e-12, `chebyshev3 f1=${rc.f1} expected 0.4`);
});

test('cellular3: sanity ordering cheby <= euclid <= manhattan in R^3 (f1 AND f2)', () => {
    const e = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const m = createCellular(42, { metric: METRIC_MANHATTAN, jitter: 1 });
    const c = createCellular(42, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    for (const [x, y, z] of [[3.5, 7.25, 1.1], [0.1, 0.9, 0.5], [-4.4, 2.2, 3.3], [123.4, -56.7, 8.8]]) {
        const re = e.cellular3(x, y, z, { f1: 0, f2: 0, id: 0 });
        const rm = m.cellular3(x, y, z, { f1: 0, f2: 0, id: 0 });
        const rc = c.cellular3(x, y, z, { f1: 0, f2: 0, id: 0 });
        assert.ok(rc.f1 <= re.f1 + 1e-9 && re.f1 <= rm.f1 + 1e-9, `f1 order at (${x},${y},${z})`);
        assert.ok(rc.f2 <= re.f2 + 1e-9 && re.f2 <= rm.f2 + 1e-9, `f2 order at (${x},${y},${z})`);
    }
});

test('cellular3: f1 <= f2 and both >= 0 over a sweep; shape is {f1,f2,id}', () => {
    const c = createCellular(99, { jitter: 1 });
    const r0 = c.cellular3(1.5, 2.5, 3.5);
    assert.deepEqual(Object.keys(r0).sort(), ['f1', 'f2', 'id']);
    for (let i = 0; i < 300; i++) {
        const x = (i * 7.31) - 100, y = (i * 3.97) - 40, z = (i * 2.13) - 30;
        const r = c.cellular3(x, y, z);
        assert.ok(r.f1 >= 0 && r.f2 >= 0 && r.f1 <= r.f2 && Number.isFinite(r.f2),
            `f1=${r.f1} f2=${r.f2} at (${x},${y},${z})`);
    }
});

// --- 3D bake (C3) -----------------------------------------------------------

test('fillCellField3: writes w*h*d in place, returns dst', () => {
    const c = createCellular(42);
    const w = 5, h = 4, d = 3;
    const dst = new Float64Array(w * h * d).fill(-1);
    const r = c.fillCellField3(dst, w, h, d, { combo: 'f1', scale: 0.05 });
    assert.equal(r, dst, 'returns the same dst reference');
    for (let i = 0; i < dst.length; i++) assert.ok(dst[i] >= 0 && Number.isFinite(dst[i]), 'voxel ' + i);
});

test('fillCellField3: matches per-query values bit-for-bit (z outermost)', () => {
    const c = createCellular(2024, { metric: METRIC_MANHATTAN, jitter: 1 });
    const w = 4, h = 3, d = 3, scale = 0.07, ox = 0.3, oy = -0.2, oz = 0.5;
    const dst = new Float64Array(w * h * d);
    c.fillCellField3(dst, w, h, d, { combo: 'f2', scale, ox, oy, oz });
    const o = { f1: 0, f2: 0, id: 0 };
    let idx = 0, pz = oz;
    for (let z = 0; z < d; z++) {
        let py = oy;
        for (let y = 0; y < h; y++) {
            let px = ox;
            for (let x = 0; x < w; x++) {
                c.cellular3(px, py, pz, o);
                assert.equal(dst[idx++], o.f2, `voxel (${x},${y},${z})`);
                px += scale;
            }
            py += scale;
        }
        pz += scale;
    }
});

test('fillCellField3: combo f1/f2-f1/cracks/f2 select correctly; cracks == f2-f1', () => {
    const c = createCellular(7);
    const w = 6, h = 5, d = 4, n = w * h * d;
    const f1 = new Float64Array(n), f2 = new Float64Array(n), diff = new Float64Array(n), cr = new Float64Array(n);
    c.fillCellField3(f1, w, h, d, { combo: 'f1' });
    c.fillCellField3(f2, w, h, d, { combo: 'f2' });
    c.fillCellField3(diff, w, h, d, { combo: 'f2-f1' });
    c.fillCellField3(cr, w, h, d, { combo: 'cracks' });
    for (let i = 0; i < n; i++) {
        assert.equal(diff[i], f2[i] - f1[i], 'f2-f1 voxel ' + i);
        assert.equal(cr[i], diff[i], 'cracks alias voxel ' + i);
        assert.ok(f1[i] <= f2[i], 'f1<=f2 voxel ' + i);
    }
});

test('fillCellField3: undersized / wrong-type / bad dims / unknown combo throw (fail closed)', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField3(new Float64Array(3), 2, 2, 2), /dst too small/);
    assert.throws(() => c.fillCellField3([0, 0, 0, 0, 0, 0, 0, 0], 2, 2, 2), /typed-array dst/);
    for (const [w, h, d] of [[0, 2, 2], [2, 0, 2], [2, 2, 0], [2.5, 2, 2], [2, 2, NaN], [2, 2, Infinity]]) {
        assert.throws(() => c.fillCellField3(new Float64Array(64), w, h, d), /positive integer w, h and d/, `(${w},${h},${d})`);
    }
    assert.throws(() => c.fillCellField3(new Float64Array(8), 2, 2, 2, { combo: 'f3' }),
        /unknown combo 'f3'.*'f1', 'f2-f1' \(alias 'cracks'\), or 'f2'/);
});

test('fillCellField3: normalize remaps to [0,1]; constant volume maps to all-zero', () => {
    const c = createCellular(11);
    const w = 8, h = 8, d = 4, n = w * h * d;
    const nrm = new Float64Array(n);
    c.fillCellField3(nrm, w, h, d, { combo: 'f1', scale: 0.05, normalize: true });
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { mn = Math.min(mn, nrm[i]); mx = Math.max(mx, nrm[i]); }
    assert.ok(Math.abs(mn - 0) < 1e-12 && Math.abs(mx - 1) < 1e-12, `normalized range [${mn},${mx}]`);
    // jitter=0 at each cell centre -> f1=0 everywhere -> constant field maps to all-zero.
    const c0 = createCellular(3, { jitter: 0 });
    const flat = new Float64Array(2 * 2 * 2);
    c0.fillCellField3(flat, 2, 2, 2, { combo: 'f1', scale: 1, ox: 0.5, oy: 0.5, oz: 0.5, normalize: true });
    for (let i = 0; i < flat.length; i++) assert.equal(flat[i], 0, 'constant volume voxel ' + i + ' -> 0, not NaN');
});

// --- 3D tileable (C3) -------------------------------------------------------

test('tileableCell3: exact periodicity on all three axes (bit-identical f1/f2/id)', () => {
    for (const id of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(1337, { metric: id, jitter: 1 });
        const P = 4, Q = 8, R = 6;
        const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
        for (let k = -2; k <= 2; k++) for (let j = 0; j < 64; j += 9) {
            const x = k + j / 64, y = (k * 2) + (j % 32) / 64, z = (k * 3) + (j % 16) / 64;
            c.tileableCell3(x, y, z, P, Q, R, a);
            c.tileableCell3(x + P, y, z, P, Q, R, b);
            assert.equal(b.f1, a.f1); assert.equal(b.f2, a.f2); assert.equal(b.id, a.id);
            c.tileableCell3(x, y + Q, z, P, Q, R, b);
            assert.equal(b.f1, a.f1); assert.equal(b.f2, a.f2); assert.equal(b.id, a.id);
            c.tileableCell3(x, y, z + R, P, Q, R, b);
            assert.equal(b.f1, a.f1); assert.equal(b.f2, a.f2); assert.equal(b.id, a.id);
        }
    }
});

test('tileableCell3: id repeats across tiles (a region tag flat-shades every copy)', () => {
    const c = createCellular(99, { jitter: 1 });
    const P = 3, Q = 3, R = 3;
    const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
    c.tileableCell3(1.5, 1.5, 1.5, P, Q, R, a);
    c.tileableCell3(1.5 + P, 1.5 + Q, 1.5 + R, P, Q, R, b);
    assert.equal(b.id, a.id, 'id repeats one tile over on every axis');
});

test('tileableCell3: non-integer / <1 / NaN / Infinity period throws (fail closed)', () => {
    const c = createCellular(1);
    for (const [P, Q, R] of [[0, 4, 4], [4, 0, 4], [4, 4, 0], [-1, 4, 4], [4, 1.5, 4], [4, 4, 2.5], [NaN, 4, 4], [4, 4, Infinity]]) {
        assert.throws(() => c.tileableCell3(0.5, 0.5, 0.5, P, Q, R), /positive integer periodX, periodY and periodZ/, `(${P},${Q},${R})`);
    }
});

test('tileableCell3: period 1x1x1 and a huge period are finite, no throw', () => {
    const c = createCellular(1);
    for (const [P, Q, R] of [[1, 1, 1], [1 << 16, 1 << 16, 1 << 16]]) {
        const r = c.tileableCell3(3.3, 4.4, 5.5, P, Q, R);
        assert.ok(Number.isFinite(r.f1) && Number.isFinite(r.f2) && r.f1 <= r.f2, `period ${P}x${Q}x${R}`);
    }
});

// --- Goldens ----------------------------------------------------------------

test('golden 3D: all three metric digests re-derive bit-for-bit', () => {
    for (const metric of METRICS3) {
        const committed = JSON.parse(readFileSync(join(HERE, '../goldens/' + metric.name + '.json'), 'utf8'));
        assert.equal(committed.metricId, metric.id);
        assert.equal(committed.seed, GOLD_SEED);
        assert.equal(committed.jitter, GOLD_JITTER);
        const cell = createCellular(GOLD_SEED, { metric: metric.id, jitter: GOLD_JITTER });
        assert.equal(digest3(cell, COORDS3), committed.digest,
            metric.name + ' mismatch is a breaking 3D kernel change -- regenerate with node goldens/gen.mjs');
    }
});

test('golden: all three metric digests re-derive bit-for-bit; euclidean stays 33a16e9e', () => {
    for (const metric of METRICS) {
        const committed = JSON.parse(readFileSync(join(HERE, '../goldens/' + metric.name + '.json'), 'utf8'));
        assert.equal(committed.metricId, metric.id);
        assert.equal(committed.seed, GOLD_SEED);
        assert.equal(committed.jitter, GOLD_JITTER);
        const cell = createCellular(GOLD_SEED, { metric: metric.id, jitter: GOLD_JITTER });
        assert.equal(digest(cell, COORDS), committed.digest,
            metric.name + ' mismatch is a breaking kernel change -- regenerate with node goldens/gen.mjs');
    }
    // The euclidean digest is the C0->C1 refactor anchor: it MUST be unchanged.
    const euclid = JSON.parse(readFileSync(join(HERE, '../goldens/euclidean.json'), 'utf8'));
    assert.equal(euclid.digest, '33a16e9e', 'euclidean numerics changed across the three-kernel split -- a bug');
});
