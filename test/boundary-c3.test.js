/**
 * @zakkster/lite-cellular -- C3 boundary & adversarial coverage (QA pass, v1.2.0).
 *
 * Extends test/Cellular.test.js's 3D metrics/bake/tileable/goldens groups (which
 * already cover the C3-BRIEF SS4 table -- non-finite door guard, jitter=0 hand-pin,
 * metric-sanity ordering, f1<=f2 sweep, bake writes/matches-per-query/combo-select,
 * undersized/wrong-type/bad-dims/unknown-combo, exact periodicity, id-repeats,
 * period fail-closed, goldens) at happy-path + first-order boundary scope, and
 * test/torture/t0-laws.mjs + t6-alloc.mjs (which already prove bake==per-query and
 * exact periodicity as METAMORPHIC LAWS over a fuzz corpus, and zero-alloc across
 * both dimensions). This file adds the QA-tier boundary MATRIX the planner's own
 * tests did not enumerate, mirroring test/boundary-c2.test.js's discipline one
 * dimension up: the 0/1/N-1/N/N+1/empty/null/undefined/NaN/-0 grid applied to every
 * NEW C3 entry point (`fillCellField3`, `tileableCell3`), the combo=null/undefined
 * pin, dst-type/view aliasing, re-entrant/aliasing adversarial cases, "dispose"
 * N/A analogues, and one numeric-overflow / one silent-fail-open adversarial case
 * not named in the planner's brief.
 *
 * Does not repeat any case already covered at Cellular.test.js / boundary.test.js /
 * boundary-c1.test.js / boundary-c2.test.js scope. Every pinned literal below was
 * captured by running the FROZEN, reviewer-APPROVED Cellular.js directly (node -e,
 * no editing) -- documents observed behaviour so a future change is caught as a
 * diff, per decisions/0005, 0006, and 0007 (the verbatim 3D lift).
 *
 * This file is ADD-ONLY: it does not modify Cellular.js, any decisions/ record, or
 * any existing test file.
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCellular,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '../Cellular.js';

// ---------------------------------------------------------------------------
// 1. fillCellField3 `dst` type/boundary matrix: Float64Array vs Float32Array vs
//    plain Array (must throw) vs undersized (len == w*h*d-1 throws) vs exact fit
//    (len == w*h*d passes); a subarray/offset VIEW of a larger buffer bakes
//    correctly and does not touch bytes outside its w*h*d window.
//    (N = w*h*d = 8 for a 2x2x2 volume unless noted)
// ---------------------------------------------------------------------------

test('fillCellField3/dst: Float64Array and Float32Array both accepted (typed-array, not type-pinned)', () => {
    const c = createCellular(1);
    assert.doesNotThrow(() => c.fillCellField3(new Float64Array(8), 2, 2, 2, { combo: 'f1' }));
    const f32 = new Float32Array(8);
    assert.doesNotThrow(() => c.fillCellField3(f32, 2, 2, 2, { combo: 'f1' }));
    for (let i = 0; i < 8; i++) assert.ok(Number.isFinite(f32[i]), 'voxel ' + i);
});

test('fillCellField3/dst: a plain Array (not a typed array) throws the typed-array message', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField3([0, 0, 0, 0, 0, 0, 0, 0], 2, 2, 2),
        /typed-array dst/);
    assert.throws(() => c.fillCellField3(null, 2, 2, 2), /typed-array dst/);
    assert.throws(() => c.fillCellField3(undefined, 2, 2, 2), /typed-array dst/);
});

test('fillCellField3/dst: length w*h*d-1 = 7 (undersized by exactly one) throws; length w*h*d = 8 (exact fit) does not', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField3(new Float64Array(7), 2, 2, 2),
        /dst too small -- length 7 < w\*h\*d 8/);
    assert.doesNotThrow(() => c.fillCellField3(new Float64Array(8), 2, 2, 2));
});

test('fillCellField3/dst: a subarray/offset VIEW of a larger buffer bakes correctly and leaves bytes outside its w*h*d window untouched', () => {
    // w*h*d = 2*3*4 = 24; the view is offset by 6 elements into a 40-element buffer,
    // and 10 elements are left AFTER it (6 + 24 + 10 = 40) -- both sides checked.
    const c = createCellular(1);
    const big = new Float64Array(40).fill(-999);
    const view = big.subarray(6, 30); // 24 elements, backed by the SAME buffer as `big`
    const r = c.fillCellField3(view, 2, 3, 4, { combo: 'f1' });
    assert.equal(r, view, 'returns the view reference, not the backing buffer');
    for (let i = 0; i < 6; i++) assert.equal(big[i], -999, 'bytes before the view must be untouched, index ' + i);
    for (let i = 30; i < 40; i++) assert.equal(big[i], -999, 'bytes after the view must be untouched, index ' + i);
    for (let i = 6; i < 30; i++) assert.notEqual(big[i], -999, 'every element inside the view must be written, index ' + i);
});

// ---------------------------------------------------------------------------
// 2. fillCellField3 `w`/`h`/`d` boundary matrix: 0, 1, -1, 1.5, NaN, Infinity,
//    null, undefined, -0, and a w*h*d product that overflows to +Infinity (each of
//    w, h, d individually a valid-looking positive integer) -> throws cleanly, no
//    hang. Applied per-axis (w, then h, then d) so a coder who validated only one
//    axis is caught.
// ---------------------------------------------------------------------------

test('fillCellField3/w,h,d: 1x1x1 (the minimum valid volume) writes exactly one voxel, no throw', () => {
    const c = createCellular(1);
    const dst = new Float64Array(1).fill(-1);
    const r = c.fillCellField3(dst, 1, 1, 1, { combo: 'f1' });
    assert.equal(r, dst);
    assert.ok(dst[0] >= 0 && Number.isFinite(dst[0]));
});

test('fillCellField3/w,h,d: 0, -1, 1.5, NaN, Infinity, null, undefined, and -0 each throw on EVERY axis independently (fail closed)', () => {
    const c = createCellular(1);
    const dst = new Float64Array(64);
    for (const bad of [0, -1, 1.5, NaN, Infinity, null, undefined, -0]) {
        assert.throws(() => c.fillCellField3(dst, bad, 4, 4), /positive integer w, h and d/, 'w=' + String(bad));
        assert.throws(() => c.fillCellField3(dst, 4, bad, 4), /positive integer w, h and d/, 'h=' + String(bad));
        assert.throws(() => c.fillCellField3(dst, 4, 4, bad), /positive integer w, h and d/, 'd=' + String(bad));
    }
});

test('fillCellField3/w,h,d: adversarial -- w*h*d that overflows to +Infinity (w, h, and d each individually pass Number.isInteger) throws cleanly, no hang', () => {
    // Each of w=h=d=1e300 is finite, positive, and Number.isInteger()===true (their
    // float64 ULP at that magnitude already has no fractional part), so the w/h/d
    // guard alone cannot reject them. The product need = w*h*d overflows to
    // +Infinity; `dst.length < Infinity` is true for any finite dst, so the SAME
    // "dst too small" guard catches it -- proves the two guards compose safely
    // under numeric overflow, in 3D, rather than falling through into an unbounded
    // triple loop (the 3D analogue of the C2 boundary suite's 2D overflow case).
    const c = createCellular(1);
    const dst = new Float64Array(16);
    assert.throws(() => c.fillCellField3(dst, 1e300, 1e300, 1e300),
        /dst too small -- length 16 < w\*h\*d Infinity/);
});

// ---------------------------------------------------------------------------
// 3. combo pin: null/undefined default to 'f1' (cannot silently drift); 'cracks'
//    is exactly the 'f2-f1' alias; unknown combo throws.
// ---------------------------------------------------------------------------

test("fillCellField3 combo: explicit null and explicit undefined both default to 'f1' -- pinned so this cannot silently drift", () => {
    const c = createCellular(7, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const byNull = new Float64Array(8), byUndef = new Float64Array(8), byOmit = new Float64Array(8), byF1 = new Float64Array(8);
    c.fillCellField3(byNull, 2, 2, 2, { combo: null, scale: 0.1 });
    c.fillCellField3(byUndef, 2, 2, 2, { combo: undefined, scale: 0.1 });
    c.fillCellField3(byOmit, 2, 2, 2, { scale: 0.1 });
    c.fillCellField3(byF1, 2, 2, 2, { combo: 'f1', scale: 0.1 });
    for (let i = 0; i < 8; i++) {
        assert.equal(byNull[i], byF1[i], 'combo:null voxel ' + i);
        assert.equal(byUndef[i], byF1[i], 'combo:undefined voxel ' + i);
        assert.equal(byOmit[i], byF1[i], 'omitted-combo voxel ' + i);
    }
});

test("fillCellField3 combo: 'cracks' is exactly the 'f2-f1' alias, bit-for-bit, over a volume", () => {
    const c = createCellular(23, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const diff = new Float64Array(27), cr = new Float64Array(27);
    c.fillCellField3(diff, 3, 3, 3, { combo: 'f2-f1', scale: 0.09 });
    c.fillCellField3(cr, 3, 3, 3, { combo: 'cracks', scale: 0.09 });
    for (let i = 0; i < 27; i++) assert.equal(cr[i], diff[i], 'cracks alias voxel ' + i);
});

test('fillCellField3 combo: unknown string, a number, and a bare object all throw the same unknown-combo error', () => {
    const c = createCellular(1);
    const dst = new Float64Array(8);
    assert.throws(() => c.fillCellField3(dst, 2, 2, 2, { combo: 'f3' }), /unknown combo 'f3'/);
    assert.throws(() => c.fillCellField3(dst, 2, 2, 2, { combo: 0 }), /unknown combo '0'/);
    assert.throws(() => c.fillCellField3(dst, 2, 2, 2, { combo: {} }), /unknown combo '\[object Object\]'/);
});

// ---------------------------------------------------------------------------
// 4. periodX/periodY/periodZ fail-closed matrix -- ALL THREE axes, independently,
//    for BOTH fillCellField3 and tileableCell3: 0, -1, 1.5, NaN, Infinity, null all
//    throw; only all-three-positive-integers passes.
// ---------------------------------------------------------------------------

test('fillCellField3: 0, -1, 1.5, NaN, Infinity, null on periodX, periodY, or periodZ (independently) all throw', () => {
    const c = createCellular(1);
    const dst = new Float64Array(64);
    for (const bad of [0, -1, 1.5, NaN, Infinity, null]) {
        assert.throws(() => c.fillCellField3(dst, 4, 4, 4, { periodX: bad, periodY: 4, periodZ: 4 }),
            /tiling requires positive integer periodX, periodY and periodZ/, 'periodX=' + String(bad));
        assert.throws(() => c.fillCellField3(dst, 4, 4, 4, { periodX: 4, periodY: bad, periodZ: 4 }),
            /tiling requires positive integer periodX, periodY and periodZ/, 'periodY=' + String(bad));
        assert.throws(() => c.fillCellField3(dst, 4, 4, 4, { periodX: 4, periodY: 4, periodZ: bad }),
            /tiling requires positive integer periodX, periodY and periodZ/, 'periodZ=' + String(bad));
    }
});

test('fillCellField3: only all-three-positive-integer periods pass (no partial period silently ignored)', () => {
    const c = createCellular(1);
    const dst = new Float64Array(64);
    assert.doesNotThrow(() => c.fillCellField3(dst, 4, 4, 4, { periodX: 4, periodY: 4, periodZ: 4 }));
    // Partial (only one or two of three given) must ALSO throw -- both-or-neither-
    // of-three is enforced, the 3D analogue of C2's both-or-neither-of-two.
    assert.throws(() => c.fillCellField3(dst, 4, 4, 4, { periodX: 4 }),
        /tiling requires positive integer periodX, periodY and periodZ \(got 4, undefined, undefined\)/);
    assert.throws(() => c.fillCellField3(dst, 4, 4, 4, { periodX: 4, periodY: 4 }),
        /tiling requires positive integer periodX, periodY and periodZ \(got 4, 4, undefined\)/);
});

test('tileableCell3: 0, -1, 1.5, NaN, Infinity, null on periodX, periodY, or periodZ (independently) all throw', () => {
    const c = createCellular(1);
    for (const bad of [0, -1, 1.5, NaN, Infinity, null]) {
        assert.throws(() => c.tileableCell3(0.5, 0.5, 0.5, bad, 4, 4),
            /positive integer periodX, periodY and periodZ/, 'periodX=' + String(bad));
        assert.throws(() => c.tileableCell3(0.5, 0.5, 0.5, 4, bad, 4),
            /positive integer periodX, periodY and periodZ/, 'periodY=' + String(bad));
        assert.throws(() => c.tileableCell3(0.5, 0.5, 0.5, 4, 4, bad),
            /positive integer periodX, periodY and periodZ/, 'periodZ=' + String(bad));
    }
});

test('tileableCell3: only all-three-positive-integer periods pass', () => {
    const c = createCellular(1);
    const r = c.tileableCell3(0.5, 0.5, 0.5, 4, 4, 4);
    assert.ok(Number.isFinite(r.f1) && Number.isFinite(r.f2) && r.f1 <= r.f2);
});

// ---------------------------------------------------------------------------
// 5. Bake == per-query differential in 3D (each combo, plain AND tiling) at
//    non-default metric/offsets not already exercised by Cellular.test.js's single
//    manhattan-combo-f2 case; a full-tile scan proof of tileableCell3's exact
//    periodicity on all three axes (every voxel of a whole tile, not sampled
//    points -- the C3-BRIEF's own periodicity test samples a coordinate grid, this
//    scans every integer cell of the tile).
// ---------------------------------------------------------------------------

test('bake==per-query: PLAIN volume, every combo, negative ox/oy/oz, chebyshev metric, bit-for-bit', () => {
    const c = createCellular(9001, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const w = 4, h = 3, d = 3, scale = 0.11, ox = -3.7, oy = -1.3, oz = 2.9;
    const o = { f1: 0, f2: 0, id: 0 };
    for (const [combo, pick] of [['f1', 'f1'], ['f2', 'f2'], ['f2-f1', 'diff'], ['cracks', 'diff']]) {
        const dst = new Float64Array(w * h * d);
        c.fillCellField3(dst, w, h, d, { combo, scale, ox, oy, oz });
        let idx = 0, pz = oz;
        for (let z = 0; z < d; z++) {
            let py = oy;
            for (let y = 0; y < h; y++) {
                let px = ox;
                for (let x = 0; x < w; x++) {
                    c.cellular3(px, py, pz, o);
                    const expected = pick === 'f1' ? o.f1 : pick === 'f2' ? o.f2 : o.f2 - o.f1;
                    assert.equal(dst[idx++], expected, `combo=${combo} voxel (${x},${y},${z})`);
                    px += scale;
                }
                py += scale;
            }
            pz += scale;
        }
    }
});

test('bake==per-query: TILING volume, every combo, negative ox/oy/oz, euclidean metric, bit-for-bit', () => {
    const c = createCellular(9001, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const w = 5, h = 4, d = 3, scale = 0.13, ox = -2.4, oy = 5.6, oz = -0.8, P = 4, Q = 3, R = 5;
    const o = { f1: 0, f2: 0, id: 0 };
    for (const [combo, pick] of [['f1', 'f1'], ['f2', 'f2'], ['f2-f1', 'diff'], ['cracks', 'diff']]) {
        const dst = new Float64Array(w * h * d);
        c.fillCellField3(dst, w, h, d, { combo, scale, ox, oy, oz, periodX: P, periodY: Q, periodZ: R });
        let idx = 0, pz = oz;
        for (let z = 0; z < d; z++) {
            let py = oy;
            for (let y = 0; y < h; y++) {
                let px = ox;
                for (let x = 0; x < w; x++) {
                    c.tileableCell3(px, py, pz, P, Q, R, o);
                    const expected = pick === 'f1' ? o.f1 : pick === 'f2' ? o.f2 : o.f2 - o.f1;
                    assert.equal(dst[idx++], expected, `combo=${combo} voxel (${x},${y},${z})`);
                    px += scale;
                }
                py += scale;
            }
            pz += scale;
        }
    }
});

test('tileableCell3: FULL-TILE scan (every integer cell centre of a 3x3x3-tile volume, not sampled points) is bit-identical to the same scan shifted by one full period on EACH axis independently', () => {
    const c = createCellular(555, { metric: METRIC_MANHATTAN, jitter: 1 });
    const P = 3, Q = 3, R = 3;
    const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
    for (let z = 0; z < P; z++) {
        for (let y = 0; y < Q; y++) {
            for (let x = 0; x < R; x++) {
                const wx = x + 0.5, wy = y + 0.5, wz = z + 0.5;
                c.tileableCell3(wx, wy, wz, P, Q, R, a);
                c.tileableCell3(wx + P, wy, wz, P, Q, R, b);
                assert.equal(b.f1, a.f1, `+P shift f1 at cell (${x},${y},${z})`);
                assert.equal(b.f2, a.f2, `+P shift f2 at cell (${x},${y},${z})`);
                assert.equal(b.id, a.id, `+P shift id at cell (${x},${y},${z})`);
                c.tileableCell3(wx, wy + Q, wz, P, Q, R, b);
                assert.equal(b.f1, a.f1, `+Q shift f1 at cell (${x},${y},${z})`);
                assert.equal(b.f2, a.f2, `+Q shift f2 at cell (${x},${y},${z})`);
                assert.equal(b.id, a.id, `+Q shift id at cell (${x},${y},${z})`);
                c.tileableCell3(wx, wy, wz + R, P, Q, R, b);
                assert.equal(b.f1, a.f1, `+R shift f1 at cell (${x},${y},${z})`);
                assert.equal(b.f2, a.f2, `+R shift f2 at cell (${x},${y},${z})`);
                assert.equal(b.id, a.id, `+R shift id at cell (${x},${y},${z})`);
            }
        }
    }
});

// ---------------------------------------------------------------------------
// 6. out-struct reuse parity -- cellular3 with an explicit out === the instance
//    out-struct path; a foreign out returns it by reference and does NOT perturb
//    this._out.
// ---------------------------------------------------------------------------

test('cellular3: omitted `out` returns the SAME object as `c._out` (identity, not a copy)', () => {
    const c = createCellular(42, { jitter: 1 });
    const r1 = c.cellular3(1.5, 2.5, 3.5);
    assert.equal(r1, c._out, 'omitted out must be the SAME object as c._out');
});

test('cellular3: passing `c._out` itself back in as an explicit `out` writes in place and returns the same identity (the instance out-struct IS a valid explicit-out argument)', () => {
    const c = createCellular(42, { jitter: 1 });
    const r0 = c.cellular3(1.5, 2.5, 3.5); // populates c._out first
    const before = { f1: r0.f1, f2: r0.f2, id: r0.id };
    const r1 = c.cellular3(9.9, 8.8, 7.7, c._out); // explicit out === this._out
    assert.equal(r1, c._out, 'explicit out === this._out round-trips by identity');
    assert.notEqual(r1.f1, before.f1, 'the write actually ran (different query point)');
});

test('cellular3: a FOREIGN explicit `out` is returned by reference and does not perturb `this._out`', () => {
    const c = createCellular(42, { jitter: 1 });
    const r1 = c.cellular3(1.5, 2.5, 3.5); // c._out now holds this result
    const snapshot = { f1: c._out.f1, f2: c._out.f2, id: c._out.id };
    const foreign = { f1: -1, f2: -1, id: -1 };
    const r2 = c.cellular3(9.9, 8.8, 7.7, foreign);
    assert.equal(r2, foreign, 'a foreign out must be returned BY REFERENCE, not copied');
    assert.notEqual(r2, c._out, 'a foreign out must not alias the instance scratch struct');
    assert.equal(c._out.f1, snapshot.f1, 'c._out.f1 must be untouched by a call using a foreign out');
    assert.equal(c._out.f2, snapshot.f2, 'c._out.f2 must be untouched by a call using a foreign out');
    assert.equal(c._out.id, snapshot.id, 'c._out.id must be untouched by a call using a foreign out');
});

// ---------------------------------------------------------------------------
// 7. Normalize edge cases in 3D: a degenerate jitter=0 constant volume, and a
//    genuine 1x1x1 volume (range is 0 by DEFINITION for any content, any combo) --
//    both must map to exactly 0, never NaN / divide-by-zero.
// ---------------------------------------------------------------------------

test('normalize: a 1x1x1 volume (n=1, min===max by construction) maps to 0, never NaN, for every combo', () => {
    const c = createCellular(11, { jitter: 1 });
    for (const combo of ['f1', 'f2-f1', 'cracks', 'f2']) {
        const dst = new Float64Array(1);
        c.fillCellField3(dst, 1, 1, 1, { combo, normalize: true });
        assert.equal(dst[0], 0, `combo=${combo}: 1x1x1 normalized volume must be exactly 0, not NaN`);
        assert.equal(Number.isNaN(dst[0]), false, `combo=${combo}`);
    }
});

test('normalize: jitter=0 degenerate CONSTANT volume (every voxel queried at an exact cell centre, f1 identically 0) maps to all-zero, never NaN, for every combo', () => {
    const c = createCellular(3, { jitter: 0 });
    for (const combo of ['f1', 'f2-f1', 'cracks']) {
        const flat = new Float64Array(2 * 2 * 2);
        c.fillCellField3(flat, 2, 2, 2, { combo, scale: 1, ox: 0.5, oy: 0.5, oz: 0.5, normalize: true });
        for (let i = 0; i < flat.length; i++) {
            assert.equal(flat[i], 0, `combo=${combo} constant volume voxel ${i} -> 0, not NaN`);
            assert.equal(Number.isNaN(flat[i]), false, `combo=${combo} voxel ${i}`);
        }
    }
});

// ---------------------------------------------------------------------------
// 8. id law in 3D: negative ids DO occur (int32 `| 0`, not `>>> 0`); id is stable
//    within a single 3D cell (any interior query returns the same id); the
//    gz,gy,gx scan-order tie-break is deterministic (identical seed/coords ->
//    identical id, repeatedly, across independent instances).
// ---------------------------------------------------------------------------

test('id (3D): negative ids DO occur over a sweep (int32 `| 0`, not `>>> 0`)', () => {
    const c = createCellular(99, { jitter: 1 });
    let sawNegative = false, sawPositive = false;
    for (let i = 0; i < 500 && !(sawNegative && sawPositive); i++) {
        const r = c.cellular3(i * 0.37 - 50, i * 0.91 - 30, i * 1.13 - 20);
        assert.ok(Number.isInteger(r.id) && (r.id | 0) === r.id, `id ${r.id} must be a signed int32`);
        if (r.id < 0) sawNegative = true; else if (r.id > 0) sawPositive = true;
    }
    assert.ok(sawNegative, 'no negative id observed over the sweep -- id may have been coerced with `>>> 0` instead of `| 0`');
    assert.ok(sawPositive, 'no positive id observed over the sweep (sanity: the sweep itself must be varied enough)');
});

test('id (3D): constant across MANY interior samples of ONE cell (jitter=0, so f1=0 at the centre and the owner is fixed)', () => {
    const c = createCellular(7, { jitter: 0 });
    const centre = c.cellular3(4.5, 4.5, 4.5);
    for (const [dx, dy, dz] of [[0.01, 0, 0], [-0.01, 0, 0], [0, 0.3, 0], [0, -0.3, 0], [0, 0, 0.4], [0.2, 0.2, -0.2], [-0.4, 0.1, 0.15]]) {
        const r = c.cellular3(4.5 + dx, 4.5 + dy, 4.5 + dz);
        assert.equal(r.id, centre.id, `id must be constant within the cell at offset (${dx},${dy},${dz})`);
    }
});

test('id (3D): the gz,gy,gx scan-order tie-break is deterministic -- two INDEPENDENT instances with the same seed/metric/jitter agree on id at every query in a sweep, repeatedly', () => {
    const a = createCellular(4242, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const b = createCellular(4242, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    for (let i = 0; i < 200; i++) {
        const x = i * 0.53 - 40, y = i * 1.07 - 25, z = i * 0.29 - 10;
        const ra = a.cellular3(x, y, z, { f1: 0, f2: 0, id: 0 });
        const rb = b.cellular3(x, y, z, { f1: 0, f2: 0, id: 0 });
        assert.equal(rb.id, ra.id, `id disagreement at (${x},${y},${z}) -- the scan-order tie-break is not deterministic`);
        assert.equal(rb.f1, ra.f1);
        assert.equal(rb.f2, ra.f2);
    }
});

// ---------------------------------------------------------------------------
// 9. Per-metric bake==per-query correctness across all three metrics -- the
//    reviewer's nit: torture's T6 3D bake alloc lane (test/torture/t6-alloc.mjs,
//    `bakeInst3`) only binds METRIC_EUCLIDEAN, so the zero-alloc gate on
//    `fillCellField3` is proven for euclidean only, not manhattan/chebyshev. That
//    ALLOC cross-product (3 metrics x {plain,tiling} x 4 combos = 24 gated lanes)
//    is judged to be C4's cross-product territory, not C3's -- the C3-BRIEF SS7
//    NON-GOALS line says exactly this: "the full 2D/3D cross-product are C4's, not
//    C3's", and 0007's Hot path already gates the alloc CONTRACT (T6.3D bake
//    is gated, just single-metric) rather than every metric's bake lane
//    individually. What IS this session's to pin, and was NOT yet pinned anywhere
//    (Cellular.test.js's 3D bake group uses euclidean/manhattan across different
//    tests but never proves f2/cracks/f2-f1 bake correctness for chebyshev,
//    volume-tiling, in one place): bake==per-query CORRECTNESS (not the alloc
//    gate) for fillCellField3, plain AND tiling, across ALL THREE metrics.
// ---------------------------------------------------------------------------

test('bake==per-query CORRECTNESS across all three 3D metrics (euclidean/manhattan/chebyshev), plain and tiling -- the alloc-gate cross-product itself is C4 territory (see comment above), this pins correctness only', () => {
    const w = 3, h = 3, d = 3, n = w * h * d;
    const o = { f1: 0, f2: 0, id: 0 };
    for (const metric of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(31337, { metric, jitter: 1 });
        // Plain.
        {
            const dst = new Float64Array(n);
            const scale = 0.17, ox = 0.4, oy = -0.6, oz = 0.2;
            c.fillCellField3(dst, w, h, d, { combo: 'f1', scale, ox, oy, oz });
            let idx = 0, pz = oz;
            for (let z = 0; z < d; z++) {
                let py = oy;
                for (let y = 0; y < h; y++) {
                    let px = ox;
                    for (let x = 0; x < w; x++) {
                        c.cellular3(px, py, pz, o);
                        assert.equal(dst[idx++], o.f1, `metric=${metric} plain voxel (${x},${y},${z})`);
                        px += scale;
                    }
                    py += scale;
                }
                pz += scale;
            }
        }
        // Tiling.
        {
            const P = 3, Q = 3, R = 3;
            const dst = new Float64Array(n);
            const scale = P / w;
            c.fillCellField3(dst, w, h, d, { combo: 'f2', scale, periodX: P, periodY: Q, periodZ: R });
            let idx = 0, pz = 0;
            for (let z = 0; z < d; z++) {
                let py = 0;
                for (let y = 0; y < h; y++) {
                    let px = 0;
                    for (let x = 0; x < w; x++) {
                        c.tileableCell3(px, py, pz, P, Q, R, o);
                        assert.equal(dst[idx++], o.f2, `metric=${metric} tiling voxel (${x},${y},${z})`);
                        px += scale;
                    }
                    py += scale;
                }
                pz += scale;
            }
        }
    }
});

// ---------------------------------------------------------------------------
// 10. Aliasing: bake into a subarray view is covered in section 1; here, two
//     DIFFERENT instances baking into different buffers, interleaved
//     (synchronously re-entrant via a hostile opts getter), do not cross-
//     contaminate -- the 3D companion to boundary-c2.test.js's 2D aliasing case.
// ---------------------------------------------------------------------------

test('aliasing: adversarial -- an opts getter that triggers a NESTED 3D bake on a DIFFERENT instance/buffer mid-setup does not perturb the outer bake', () => {
    const a = createCellular(11, { metric: METRIC_EUCLIDEAN });
    const b = createCellular(22, { metric: METRIC_MANHATTAN });
    const dstA = new Float64Array(8);
    const dstB = new Float64Array(27);
    let triggered = false;
    const opts = {
        get scale() {
            if (!triggered) { triggered = true; b.fillCellField3(dstB, 3, 3, 3, { combo: 'f2' }); }
            return 0.05;
        },
        combo: 'f1',
    };
    a.fillCellField3(dstA, 2, 2, 2, opts);
    assert.ok(triggered, 'the nested call did not fire -- test is not exercising interleaving');
    const refA = new Float64Array(8);
    a.fillCellField3(refA, 2, 2, 2, { combo: 'f1', scale: 0.05 });
    for (let i = 0; i < 8; i++) assert.equal(dstA[i], refA[i], 'voxel ' + i + ' perturbed by the interleaved instance b bake');
    for (let i = 0; i < 27; i++) assert.ok(Number.isFinite(dstB[i]), 'instance b bake voxel ' + i + ' must itself complete correctly');
});

// ---------------------------------------------------------------------------
// 11. Re-entrant write on the shared per-instance scratch (`c._out`) via `cellular3`
//     -- the 3D companion to boundary-c2.test.js section 11's 2D finding. `cellular3`
//     writes through `out || this._out` exactly like `cellular2`, so the same
//     shared-scratch tear hazard is expected to reproduce; pinned here so a change
//     to this OBSERVED (not contractual) behaviour is caught as a diff for the 3D
//     surface specifically, not merely assumed identical by resemblance to 2D.
// ---------------------------------------------------------------------------

test('re-entrant (adversarial, informational): instrumenting c._out with an accessor that re-enters cellular3 on the SAME instance can tear the shared scratch write', () => {
    const c = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    let nestedRan = false;
    let stored = 0;
    Object.defineProperty(c._out, 'f1', {
        configurable: true,
        get() { return stored; },
        set(v) {
            stored = v;
            if (!nestedRan) {
                nestedRan = true;
                c.cellular3(99.9, 88.8, 77.7); // omitted out -> the SAME c._out, re-entered
            }
        },
    });
    const outer = c.cellular3(5.5, 6.6, 7.7); // omitted out -> also c._out
    assert.ok(nestedRan, 'the nested re-entrant call did not fire -- test is not exercising the hazard');
    const refOuter = c.cellular3(5.5, 6.6, 7.7, { f1: 0, f2: 0, id: 0 });
    const refNested = c.cellular3(99.9, 88.8, 77.7, { f1: 0, f2: 0, id: 0 });
    // OBSERVED, mirroring the C2 finding: f2 and id (written by the OUTER call
    // AFTER the f1 setter returns) survive intact.
    assert.equal(outer.f2, refOuter.f2, 'f2 (written after the hazard point) must be the OUTER value');
    assert.equal(outer.id, refOuter.id, 'id (written after the hazard point) must be the OUTER value');
    // OBSERVED: f1 ends up holding the NESTED call's value -- a torn/mixed read,
    // reproducing the C2 finding one dimension up. Documented, not silently
    // patched here (this file may only add tests, not change Cellular.js).
    assert.equal(outer.f1, refNested.f1,
        'OBSERVED: f1 reflects the NESTED call after a re-entrant accessor on the shared scratch (see QA finding, 3D companion to the C2 finding)');
});

// ---------------------------------------------------------------------------
// 12. "dispose" -- N/A for the C3 surface too (documented, not silently skipped,
//     mirroring boundary-c1.test.js SS6 and boundary-c2.test.js section 12); pin
//     idempotent repeated 3D bakes and a bake-during-a-caller-loop instead, since
//     there is no lifecycle to double-free or call mid-iteration.
// ---------------------------------------------------------------------------

test('dispose semantics (C3): N/A -- fillCellField3/tileableCell3 own no external resource; repeated bakes into the same dst are a clean overwrite, not a double-free', () => {
    const c = createCellular(1);
    const dst = new Float64Array(8);
    c.fillCellField3(dst, 2, 2, 2, { combo: 'f1' });
    const first = Array.from(dst);
    c.fillCellField3(dst, 2, 2, 2, { combo: 'f1', scale: 0.2 }); // "duplicate dispose" analogue: call again
    const second = Array.from(dst);
    assert.notDeepEqual(second, first, 'a different scale must produce a different bake (proves the second call actually ran, not a no-op)');
    // "dispose-during-iteration" analogue: bake repeatedly from inside a caller loop,
    // interleaved with reseed and a tileableCell3 query.
    for (let i = 0; i < 5; i++) {
        c.reseed(i);
        c.fillCellField3(dst, 2, 2, 2, { combo: 'f2' });
        c.tileableCell3(i, i, i, 4, 4, 4);
    }
    assert.ok(true, 'no throw across repeated in-loop 3D bakes/tile-queries with interleaved reseed');
});

// ---------------------------------------------------------------------------
// 13. Fail-closed -- the `opts.jitter` OVERRIDE on BOTH bakers is bounds-validated,
//     mirroring the constructor's `jitter` guard VERBATIM. qa surfaced that the
//     override was previously fail-OPEN (jitter:NaN silently wrote an Infinity
//     volume; jitter:50 let feature points escape the neighbourhood the 0007
//     sufficiency proof depends on). The C3 fix validates the override ONCE at
//     setup, off the hot loop: NaN, Infinity, out-of-[0,1], null, and non-numbers
//     all throw with the SAME Error/message as the constructor; an omitted jitter
//     falls back to the instance's already-validated value (no throw, the common
//     allocation-free path is unchanged). Applies to fillCellField2 AND
//     fillCellField3 (the 2D baker carries the identical fix). See CHANGELOG 1.2.0.
// ---------------------------------------------------------------------------

test('bakers: opts.jitter override is bounds-validated (fail-closed, matching the constructor) in both fillCellField2 and fillCellField3', () => {
    const c = createCellular(1, { jitter: 1 }); // a validly-constructed instance
    const bad = [NaN, Infinity, -Infinity, 50, -0.1, 1.1, null, 'x'];

    // 3D baker: every out-of-domain override throws with the constructor's message.
    const dst3 = new Float64Array(8);
    for (const j of bad) {
        assert.throws(() => c.fillCellField3(dst3, 2, 2, 2, { combo: 'f1', jitter: j }),
            /jitter must be a finite number/, `fillCellField3 jitter=${String(j)} must throw`);
    }
    // A valid override still bakes, and an OMITTED jitter falls back to the instance
    // default without throwing (the common path is unchanged).
    assert.doesNotThrow(() => c.fillCellField3(dst3, 2, 2, 2, { combo: 'f1', jitter: 0.5 }));
    assert.doesNotThrow(() => c.fillCellField3(dst3, 2, 2, 2, { combo: 'f1' }));

    // 2D baker: the identical fix.
    const dst2 = new Float64Array(8);
    for (const j of bad) {
        assert.throws(() => c.fillCellField2(dst2, 4, 2, { combo: 'f1', jitter: j }),
            /jitter must be a finite number/, `fillCellField2 jitter=${String(j)} must throw`);
    }
    assert.doesNotThrow(() => c.fillCellField2(dst2, 4, 2, { combo: 'f1', jitter: 0.5 }));
    assert.doesNotThrow(() => c.fillCellField2(dst2, 4, 2, { combo: 'f1' }));
});
