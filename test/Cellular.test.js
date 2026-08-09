/**
 * @zakkster/lite-cellular -- node:test unit suite (v1.0.0 / C1).
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
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, METRICS, digest } from '../goldens/gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Construction -----------------------------------------------------------

test('construction: exported surface and defaults', () => {
    assert.equal(VERSION, '1.0.0');
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

// --- Goldens ----------------------------------------------------------------

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
