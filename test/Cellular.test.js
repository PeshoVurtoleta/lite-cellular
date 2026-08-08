/**
 * @zakkster/lite-cellular -- node:test unit suite (v0.1.0 / C0).
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
import { createCellular, Cellular, VERSION, METRIC_EUCLIDEAN } from '../Cellular.js';
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, digest } from '../goldens/gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Construction -----------------------------------------------------------

test('construction: exported surface and defaults', () => {
    assert.equal(VERSION, '0.1.0');
    assert.equal(METRIC_EUCLIDEAN, 0);
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

test('construction: an unknown metric id throws (fail-closed)', () => {
    assert.throws(() => createCellular(0, { metric: 1 }), /unknown metric id/);
    assert.throws(() => createCellular(0, { metric: 2 }), /unknown metric id/);
    assert.throws(() => createCellular(0, { metric: 'euclidean' }), /unknown metric id/);
    assert.throws(() => createCellular(0, { metric: null }), /unknown metric id/);
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

// --- Golden -----------------------------------------------------------------

test('golden: committed euclidean digest re-derives bit-for-bit', () => {
    const committed = JSON.parse(readFileSync(join(HERE, '../goldens/euclidean.json'), 'utf8'));
    assert.equal(committed.metricId, METRIC_EUCLIDEAN);
    assert.equal(committed.seed, GOLD_SEED);
    assert.equal(committed.jitter, GOLD_JITTER);
    const cell = createCellular(GOLD_SEED, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
    assert.equal(digest(cell, COORDS), committed.digest,
        'a mismatch is a breaking kernel change -- regenerate with node goldens/gen.mjs');
});
