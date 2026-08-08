/**
 * @zakkster/lite-cellular -- boundary & adversarial coverage (C0 QA pass).
 *
 * Extends test/Cellular.test.js: the degenerate/adversarial value matrix at
 * euclidean (C0) scope, world-scale precision pinned as OBSERVED behaviour
 * (not a designed C4 limit), out-reuse/re-entrant guarantees, reseed
 * reproducibility, and a strengthened id-constant-within-cell /
 * differs-across-neighbours law -- decision 0004's actual claim, not just
 * "distinct > 1" over an arbitrary sample.
 *
 * Every pinned literal below was captured by running the FROZEN, reviewed
 * Cellular.js directly (node -e, no editing) -- these are not design targets,
 * they document what C0 does today so a future change is caught as a diff.
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCellular } from '../Cellular.js';

// ---------------------------------------------------------------------------
// 1. Degenerate / adversarial coordinate matrix (euclidean, C0 scope)
// ---------------------------------------------------------------------------

test('boundary: 0 and -0 coordinates are indistinguishable (bit-identical outputs)', () => {
    const c = createCellular(42);
    const r00 = c.cellular2(0, 0, { f1: 0, f2: 0, id: 0 });
    const rNegNeg = c.cellular2(-0, -0, { f1: 0, f2: 0, id: 0 });
    const rNeg0 = c.cellular2(-0, 0, { f1: 0, f2: 0, id: 0 });
    const r0Neg = c.cellular2(0, -0, { f1: 0, f2: 0, id: 0 });
    for (const r of [rNegNeg, rNeg0, r0Neg]) {
        assert.equal(r.f1, r00.f1);
        assert.equal(r.f2, r00.f2);
        assert.equal(r.id, r00.id);
    }
});

test('boundary: +Inf/-Inf/NaN throw at the door in every sign combination', () => {
    const c = createCellular(42);
    const bad = [Infinity, -Infinity, NaN];
    const finite = [0, -0, 1, -1];
    for (const bx of bad) {
        for (const y of finite) {
            assert.throws(() => c.cellular2(bx, y), /requires finite x and y/, `(${bx},${y})`);
            assert.throws(() => c.cellular2(y, bx), /requires finite x and y/, `(${y},${bx})`);
        }
    }
    for (const bx of bad) {
        for (const by of bad) {
            assert.throws(() => c.cellular2(bx, by), /requires finite x and y/, `(${bx},${by})`);
        }
    }
});

test('boundary: subnormal-magnitude coord (1e-45) does not throw and collapses to the (0,0) result', () => {
    const c = createCellular(42);
    const r0 = c.cellular2(0, 0, { f1: 0, f2: 0, id: 0 });
    const rs = c.cellular2(1e-45, 1e-45, { f1: 0, f2: 0, id: 0 });
    assert.equal(rs.f1, r0.f1,
        'a coordinate 1e-45 is below the fx-x subtraction ULP at this scale -- indistinguishable from 0');
    assert.equal(rs.f2, r0.f2);
    assert.equal(rs.id, r0.id);
});

test('boundary: f32-max-magnitude coord (3.4e38) does not throw; pins the OBSERVED float64 precision collapse', () => {
    // At this magnitude the float64 ULP (~7.5e22) swallows the +/-1 cell
    // offset entirely: cx = ix + gx is bit-identical for gx in {-1,0,1}, so
    // the 3x3 neighbourhood degenerates onto ONE cell coordinate along that
    // axis. This is OBSERVED current-C0 behaviour -- world-scale precision is
    // out of C0's scope (a future session may bound it); this test exists so
    // a change to that behaviour is caught, not silently shipped.
    const c = createCellular(42);
    const r = c.cellular2(3.4e38, 3.4e38, { f1: 0, f2: 0, id: 0 });
    assert.equal(r.f1, 0, 'PINNED: both axes collapse -- every scanned candidate is the same point (f1=0)');
    assert.equal(r.f2, 0, 'PINNED: f2 collapses identically to f1 at this magnitude');
    assert.ok(Number.isInteger(r.id));

    const r2 = c.cellular2(3.4e38, 0, { f1: 0, f2: 0, id: 0 });
    assert.ok(Number.isFinite(r2.f1) && Number.isFinite(r2.f2));
    assert.equal(r2.f1, r2.f2,
        'PINNED: x-axis collapses but y stays precise near 0 -- f1 ties f2 at 0.353474885225296');
    assert.ok(Math.abs(r2.f1 - 0.353474885225296) < 1e-12);
});

test('boundary: integer pair 16777216/16777217 (2^24, the float32 integer limit) are distinct and finite in float64', () => {
    const c = createCellular(42);
    const rA = c.cellular2(16777216, 0, { f1: 0, f2: 0, id: 0 });
    const rB = c.cellular2(16777217, 0, { f1: 0, f2: 0, id: 0 });
    for (const r of [rA, rB]) {
        assert.ok(Number.isFinite(r.f1) && Number.isFinite(r.f2));
        assert.ok(r.f1 <= r.f2);
    }
    // float64 carries ~52 bits of integer precision (vs float32's 24), so C0
    // (float64 throughout) resolves the two adjacent integers as different
    // cells -- not the same one, unlike the 3.4e38 case above.
    assert.notEqual(rA.id, rB.id, '2^24 and 2^24+1 must resolve to different cells in float64');
    assert.notEqual(rA.f1, rB.f1);
});

test('boundary: coords straddling a cell edge (x=1) resolve to different owner cells either side', () => {
    const c = createCellular(42, { jitter: 0 });
    const below = c.cellular2(0.999999999, 0.5, { f1: 0, f2: 0, id: 0 });
    const above = c.cellular2(1.000000001, 0.5, { f1: 0, f2: 0, id: 0 });
    assert.notEqual(below.id, above.id, 'crossing x=1 must cross a Voronoi/cell boundary under jitter=0');
    // jitter=0: f1 is the distance to the nearest of the two adjacent centres,
    // symmetric about the boundary to within 1e-8.
    assert.ok(Math.abs(below.f1 - 0.5) < 1e-8);
    assert.ok(Math.abs(above.f1 - 0.5) < 1e-8);
});

test('boundary: coords straddling x=0 resolve to different owner cells either side (not a special case)', () => {
    const c = createCellular(42, { jitter: 0 });
    const neg = c.cellular2(-0.000000001, 0.5, { f1: 0, f2: 0, id: 0 });
    const pos = c.cellular2(0.000000001, 0.5, { f1: 0, f2: 0, id: 0 });
    assert.notEqual(neg.id, pos.id, 'crossing x=0 must cross a cell boundary the same way any other integer does');
});

test('boundary: adversarial -- a frozen `out` throws TypeError instead of silently no-op writing', () => {
    // Neither the C0 brief nor the planner named this case: cellular2 writes
    // f1/f2/id via plain assignment. Cellular.js is an ESM module (strict
    // mode), so assigning to a non-writable property of a frozen object
    // THROWS rather than silently failing -- a caller who freezes their
    // out-struct gets a loud TypeError, not a corrupted read. Pinned so a
    // future refactor (e.g. Object.defineProperty) cannot silently turn this
    // into a no-op.
    const c = createCellular(42);
    const frozen = Object.freeze({ f1: 0, f2: 0, id: 0 });
    assert.throws(() => c.cellular2(1, 1, frozen), TypeError);
    assert.equal(frozen.f1, 0);
    assert.equal(frozen.f2, 0);
    assert.equal(frozen.id, 0);
});

test('boundary: adversarial -- a throwing call does not partially mutate a supplied `out` (re-entrant safety)', () => {
    const c = createCellular(42);
    const out = { f1: -999, f2: -999, id: -999 };
    assert.throws(() => c.cellular2(NaN, 1, out), /requires finite x and y/);
    // The door guard runs before any write, so a call that throws must leave
    // a caller-supplied out completely untouched -- no torn/partial write.
    assert.equal(out.f1, -999);
    assert.equal(out.f2, -999);
    assert.equal(out.id, -999);
});

test('boundary: the kernel returns exactly {f1, f2, id} -- no extra properties (0002)', () => {
    const c = createCellular(42);
    const implicit = c.cellular2(1, 1);
    assert.deepEqual(Object.keys(implicit).sort(), ['f1', 'f2', 'id']);
    const explicit = c.cellular2(1, 1, { f1: 0, f2: 0, id: 0 });
    assert.deepEqual(Object.keys(explicit).sort(), ['f1', 'f2', 'id']);
});

test('boundary: id is a signed int32 SMI-safe value, and negative ids do occur (0004: `| 0`, not `>>> 0`)', () => {
    const c = createCellular(42);
    let sawNegative = false;
    for (let i = 0; i < 64; i++) {
        const r = c.cellular2(i * 3.7 - 100, i * 2.3 - 60, { f1: 0, f2: 0, id: 0 });
        assert.ok(Number.isInteger(r.id));
        assert.ok(r.id >= -2147483648 && r.id <= 2147483647, `id=${r.id} out of int32 range`);
        // The SMI-safety claim (0004) is only meaningful if the raw uint32
        // hash sometimes has its high bit set -- `| 0` must actually be
        // producing negative values sometimes, not just be a no-op cast.
        if (r.id < 0) sawNegative = true;
    }
    assert.ok(sawNegative, 'no negative id observed over the sweep -- the `| 0` (vs `>>> 0`) distinction is unverified');
});

test('boundary: adversarial -- seed accepts any value via int32 coercion; NaN/Infinity/null/undefined silently become 0', () => {
    // Unlike metric and jitter (which validate and throw), seed has no
    // "invalid" range: `seed | 0` (ToInt32) is a total function over every JS
    // value, so the constructor never rejects a seed. Pinning the observed
    // coercions so this is understood as a design property, not confused
    // with a fail-closed gap.
    const cases = [
        [NaN, 0], [Infinity, 0], [-Infinity, 0], [null, 0], [undefined, 0],
        [2 ** 32, 0], [-1, -1], [1.9, 1], ['7', 7],
    ];
    for (const [seed, expected] of cases) {
        const c = createCellular(seed);
        assert.equal(c._seed, expected, `seed=${String(seed)}`);
    }
});

// ---------------------------------------------------------------------------
// 2. World-scale precision (1e6 / 1e7 / 2^24) -- pinning OBSERVED behaviour
// ---------------------------------------------------------------------------

test('world-scale: 1e6, 1e7, and 2^24 remain fully precise -- no neighbourhood collapse there', () => {
    // Contrast with the 3.4e38 case above: at these magnitudes float64's ULP
    // is still far smaller than 1 (ULP(1e7) ~ 2e-9), so the +/-1 cell offsets
    // survive and f1/f2 stay distinct. This is the observed C0 behaviour, not
    // a designed guarantee for arbitrary world scale.
    const c = createCellular(42);
    for (const mag of [1e6, 1e7, 16777216]) {
        const r = c.cellular2(mag + 0.5, mag + 0.5, { f1: 0, f2: 0, id: 0 });
        assert.ok(Number.isFinite(r.f1) && Number.isFinite(r.f2), `mag=${mag}`);
        assert.ok(r.f1 <= r.f2, `mag=${mag}`);
        assert.ok(r.f1 < r.f2, `mag=${mag}: expected no neighbourhood collapse at this scale (unlike 3.4e38)`);
    }
});

test('world-scale: at 1e6/1e7/2^24 jitter=0 still matches the independently-computed nearest-centre distance', () => {
    const c0 = createCellular(1, { jitter: 0 });
    for (const mag of [1e6, 1e7, 16777216]) {
        const x = mag + 0.3, y = mag + 0.7;
        const r = c0.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const cxc = Math.round(x - 0.5) + 0.5;
        const cyc = Math.round(y - 0.5) + 0.5;
        const expected = Math.hypot(cxc - x, cyc - y);
        assert.ok(Math.abs(r.f1 - expected) < 1e-6, `mag=${mag} f1=${r.f1} expected=${expected}`);
    }
});

// ---------------------------------------------------------------------------
// 3. `out` reuse identity and re-entrant aliasing
// ---------------------------------------------------------------------------

test('out reuse: an explicit `out` is written in place and returned by reference', () => {
    const c = createCellular(9);
    const out = { f1: -1, f2: -1, id: -1 };
    const r = c.cellular2(2.2, 3.3, out);
    assert.equal(r, out);
    assert.notEqual(out.f1, -1);
});

test('out reuse: omitted `out` returns the SAME reused instance struct across many calls', () => {
    const c = createCellular(9);
    const first = c.cellular2(0.1, 0.1);
    const identities = new Set();
    for (let i = 0; i < 50; i++) {
        const r = c.cellular2(i * 0.37, i * 0.51);
        identities.add(r);
    }
    assert.equal(identities.size, 1, 'every omitted-out call must return the identical object');
    assert.ok(identities.has(first));
    assert.equal([...identities][0], c._out);
});

test('out reuse: adversarial -- a retained reference to the default out is silently overwritten by the next call (documented scratch)', () => {
    const c = createCellular(9);
    const held = c.cellular2(1.1, 1.1);
    const heldF1 = held.f1, heldId = held.id;
    c.cellular2(50.5, 60.5); // a second call the caller does NOT read into a fresh out
    // the retained reference now reflects the SECOND call, not the first --
    // this is the documented contract ("holding scratch the next call
    // overwrites"), and this test fails loudly if a future change makes
    // cellular2 allocate a fresh object per call instead.
    assert.equal(held.f1 !== heldF1 || held.id !== heldId, true,
        'the retained reference should reflect the second call, proving it is the SAME reused struct');
});

// ---------------------------------------------------------------------------
// 4. reseed reproducibility
// ---------------------------------------------------------------------------

test('reseed: reproducible across repeated reseed cycles, and returns `this`', () => {
    const c = createCellular(100);
    const snapshots = [];
    for (const seed of [100, 200, 300, 100, 200]) {
        assert.equal(c.reseed(seed), c);
        const r = c.cellular2(4.4, 5.5, { f1: 0, f2: 0, id: 0 });
        snapshots.push({ seed, f1: r.f1, id: r.id });
    }
    assert.deepEqual(snapshots[0], snapshots[3], 'reseed(100) after other seeds reproduces the original field exactly');
    assert.deepEqual(snapshots[1], snapshots[4], 'reseed(200) after other seeds reproduces exactly');
});

test('reseed: adversarial -- reseed(NaN) coerces to 0 exactly like construction (no divergent path)', () => {
    const byCtor = createCellular(0);
    const byReseed = createCellular(999).reseed(NaN);
    assert.equal(byReseed._seed, byCtor._seed);
    const r1 = byCtor.cellular2(7.7, 8.8, { f1: 0, f2: 0, id: 0 });
    const r2 = byReseed.cellular2(7.7, 8.8, { f1: 0, f2: 0, id: 0 });
    assert.deepEqual(r1, r2);
});

// ---------------------------------------------------------------------------
// 5. Strengthened id law: CONSTANT within one cell, DIFFERS across neighbours
//    (decision 0004's actual claim -- not merely "distinct > 1" over a batch)
// ---------------------------------------------------------------------------

test('id law: id is constant across many interior samples of ONE cell (jitter=0)', () => {
    const c = createCellular(77, { jitter: 0 });
    let expected = null;
    for (let sy = 0.05; sy <= 0.95; sy += 0.05) {
        for (let sx = 0.05; sx <= 0.95; sx += 0.05) {
            const r = c.cellular2(3 + sx, -2 + sy, { f1: 0, f2: 0, id: 0 });
            if (expected === null) expected = r.id;
            else assert.equal(r.id, expected, `(${3 + sx},${-2 + sy}) id drifted within cell (3,-2)`);
        }
    }
    assert.ok(Number.isInteger(expected));
});

test('id law: id DIFFERS between every pair of the four direct neighbours of a centre cell (jitter=0)', () => {
    const c = createCellular(77, { jitter: 0 });
    // Sample the interior centre of cell (0,0) and its four axis-adjacent
    // neighbours (1,0), (-1,0), (0,1), (0,-1) -- the actual "differs across
    // cells" claim, not an arbitrary batch where only 2 of 25 might differ.
    const cells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const ids = cells.map(([cx, cy]) => c.cellular2(cx + 0.5, cy + 0.5, { f1: 0, f2: 0, id: 0 }).id);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            assert.notEqual(ids[i], ids[j],
                `cells ${JSON.stringify(cells[i])} and ${JSON.stringify(cells[j])} share id ${ids[i]}`);
        }
    }
});

test('id law: id is metric-instance-scoped -- two instances, same seed, sampled at the same point agree (single metric in C0)', () => {
    // C0 has exactly one metric, so this pins the OTHER half of 0004's claim
    // that is testable now: id is a pure function of (seed, cx, cy) alone,
    // reproducible across independently-constructed instances.
    const a = createCellular(555, { jitter: 0 });
    const b = createCellular(555, { jitter: 0 });
    for (let i = 0; i < 20; i++) {
        const x = i * 1.3 - 10, y = i * 0.7 - 5;
        const ra = a.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        const rb = b.cellular2(x, y, { f1: 0, f2: 0, id: 0 });
        assert.equal(ra.id, rb.id);
    }
});
