/**
 * @zakkster/lite-cellular -- C2 boundary & adversarial coverage (QA pass, v1.1.0).
 *
 * Extends test/Cellular.test.js (which already covers the C2-BRIEF SS4 groups --
 * Field bake / Combo / Normalize / Tileable / Seam -- at happy-path + first-order
 * boundary scope) and test/torture/t0-laws.mjs (which already proves bake==per-query
 * and combo algebra as METAMORPHIC LAWS over a fuzz corpus, and exact periodicity
 * over a dyadic corpus). This file adds the QA-tier boundary MATRIX the planner's
 * own tests did not enumerate: the 0/1/N-1/N/N+1/empty/null/undefined/NaN/-0 grid
 * applied to every NEW C2 entry point (`fillCellField2`, `tileableCell2`), the
 * combo=null/undefined pin (falls to 'f1', decided so it cannot silently drift),
 * re-entrant/aliasing adversarial cases against the new surfaces, and one
 * numeric-overflow adversarial case not named in the planner's brief.
 *
 * Does not repeat any case already covered at Cellular.test.js / boundary.test.js /
 * boundary-c1.test.js scope. Every pinned literal below was captured by running the
 * FROZEN, reviewed Cellular.js directly (node -e, no editing) -- documents observed
 * behaviour so a future change is caught as a diff, per decisions/0005 and 0006.
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
// 1. fillCellField2 `dst` boundary matrix: 0/1/N-1/N/N+1/empty/null/undefined
//    + wrong-type + DataView + detached buffer + Proxy-wrapped valid array
//    (N = w*h = 16 for a 4x4 field throughout this section)
// ---------------------------------------------------------------------------

test('fillCellField2/dst: length 0 (empty) throws', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(new Float64Array(0), 4, 4), /dst too small/);
});

test('fillCellField2/dst: length 1 (far undersized) throws', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(new Float64Array(1), 4, 4), /dst too small/);
});

test('fillCellField2/dst: length N-1 = 15 (undersized by exactly one) throws', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(new Float64Array(15), 4, 4),
        /dst too small -- length 15 < w\*h 16/);
});

test('fillCellField2/dst: length N = 16 (exact fit) does not throw', () => {
    const c = createCellular(1);
    assert.doesNotThrow(() => c.fillCellField2(new Float64Array(16), 4, 4));
});

test('fillCellField2/dst: length N+1 = 17 (oversized) does not throw; the trailing element is left untouched', () => {
    const c = createCellular(1);
    const dst = new Float64Array(17).fill(-12345);
    c.fillCellField2(dst, 4, 4, { combo: 'f1' });
    for (let i = 0; i < 16; i++) assert.notEqual(dst[i], -12345, 'pixel ' + i + ' must be written');
    assert.equal(dst[16], -12345, 'index 16 is past w*h=16 and must be left untouched -- no over-write');
});

test('fillCellField2/dst: null and undefined both throw the typed-array message', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(null, 4, 4), /typed-array dst/);
    assert.throws(() => c.fillCellField2(undefined, 4, 4), /typed-array dst/);
});

test('fillCellField2/dst: a DataView (a view, but not a typed array with BYTES_PER_ELEMENT) throws', () => {
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(new DataView(new ArrayBuffer(128)), 4, 4), /typed-array dst/);
});

test('fillCellField2/dst: adversarial -- a detached (transferred) ArrayBuffer view throws via the length check, not a crash', () => {
    const buf = new ArrayBuffer(128);
    const dst = new Float64Array(buf);
    structuredClone(buf, { transfer: [buf] }); // synchronously detaches buf
    assert.equal(dst.length, 0, 'precondition: the view is now detached (length collapses to 0)');
    const c = createCellular(1);
    assert.throws(() => c.fillCellField2(dst, 4, 4), /dst too small -- length 0/);
});

test('fillCellField2/dst: adversarial -- a Proxy wrapping an otherwise-valid Float64Array is rejected cleanly, with no TypeError leak (ArrayBuffer.isView is internal-slot-based, not duck-typed)', () => {
    // ArrayBuffer.isView() checks the object's OWN [[TypedArrayName]]/[[DataView]]
    // internal slot, which a Proxy exotic object never has -- ArrayBuffer.isView
    // (unlike `.length`, a brand-checked accessor that THROWS "incompatible
    // receiver" when called on a Proxy receiver) returns a clean `false` for a
    // Proxy, no throw. Because the guard is a short-circuiting `||` starting with
    // `!ArrayBuffer.isView(dst)`, it never reaches the brand-checked `dst.length`
    // read that would otherwise leak a raw TypeError -- the library surfaces its
    // own clean fail-closed Error instead. Fail-closed, not a bug: an object that
    // merely LOOKS like a typed array is not trusted as `dst`.
    const c = createCellular(1);
    const real = new Float64Array(16);
    const proxied = new Proxy(real, {});
    assert.equal(ArrayBuffer.isView(proxied), false, 'precondition: isView is false for a Proxy, even around a real typed array');
    assert.throws(() => c.fillCellField2(proxied, 4, 4), /typed-array dst/);
});

// ---------------------------------------------------------------------------
// 2. fillCellField2 `w`/`h` boundary matrix
// ---------------------------------------------------------------------------

test('fillCellField2/w,h: 1x1 (the minimum valid field) writes exactly one pixel, no throw', () => {
    const c = createCellular(1);
    const dst = new Float64Array(1).fill(-1);
    const r = c.fillCellField2(dst, 1, 1, { combo: 'f1' });
    assert.equal(r, dst);
    assert.ok(dst[0] >= 0 && Number.isFinite(dst[0]));
});

test('fillCellField2/w,h: null, undefined, string, and -0 all throw (fail closed, not just NaN/Infinity)', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    for (const bad of [null, undefined, '4', -0]) {
        assert.throws(() => c.fillCellField2(dst, bad, 4), /positive integer w and h/, 'w=' + String(bad));
        assert.throws(() => c.fillCellField2(dst, 4, bad), /positive integer w and h/, 'h=' + String(bad));
    }
});

test('fillCellField2/w,h: adversarial -- w*h that overflows to +Infinity (both w and h individually pass Number.isInteger) throws cleanly, no hang', () => {
    // Neither the C2-BRIEF nor the coder's own tests name this: w=1e300 and h=1e300
    // are each finite, positive, and Number.isInteger()===true (their float64 ULP at
    // that magnitude is already >= 1, so they have no fractional part) -- so the w/h
    // guard alone cannot reject them. The multiply need = w*h overflows to +Infinity;
    // `dst.length < Infinity` is true for any finite dst, so the SAME "dst too small"
    // guard catches it. Proves the two guards compose safely under numeric overflow
    // rather than falling through into an unbounded loop.
    const c = createCellular(1);
    const dst = new Float64Array(16);
    assert.throws(() => c.fillCellField2(dst, 1e300, 1e300), /dst too small -- length 16 < w\*h Infinity/);
});

// ---------------------------------------------------------------------------
// 3. combo pin: null/undefined default to 'f1' (cannot silently drift); non-string
//    values throw the SAME unknown-combo error as an unrecognised string
// ---------------------------------------------------------------------------

test("combo: explicit null and explicit undefined both default to 'f1' -- pinned so this cannot silently drift", () => {
    const c = createCellular(7, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const byNull = new Float64Array(4), byUndef = new Float64Array(4), byOmit = new Float64Array(4), byF1 = new Float64Array(4);
    c.fillCellField2(byNull, 2, 2, { combo: null, scale: 0.1 });
    c.fillCellField2(byUndef, 2, 2, { combo: undefined, scale: 0.1 });
    c.fillCellField2(byOmit, 2, 2, { scale: 0.1 });
    c.fillCellField2(byF1, 2, 2, { combo: 'f1', scale: 0.1 });
    for (let i = 0; i < 4; i++) {
        assert.equal(byNull[i], byF1[i], "combo:null pixel " + i);
        assert.equal(byUndef[i], byF1[i], "combo:undefined pixel " + i);
        assert.equal(byOmit[i], byF1[i], "omitted-combo pixel " + i);
    }
});

test('combo: a number or a bare object is NOT coerced to a string key -- both throw the unknown-combo error', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { combo: 0 }), /unknown combo '0'/);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { combo: 1 }), /unknown combo '1'/);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { combo: {} }), /unknown combo '\[object Object\]'/);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { combo: [] }), /unknown combo ''/);
});

// ---------------------------------------------------------------------------
// 4. periodX/periodY fail-closed matrix -- fillCellField2 AND tileableCell2
// ---------------------------------------------------------------------------

test('fillCellField2: a PARTIAL period (only periodX or only periodY given) throws -- both-or-neither is enforced', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { periodX: 4 }),
        /tiling requires positive integer periodX and periodY \(got 4, undefined\)/);
    assert.throws(() => c.fillCellField2(dst, 4, 4, { periodY: 4 }),
        /tiling requires positive integer periodX and periodY \(got undefined, 4\)/);
});

test('fillCellField2: periodX/periodY NaN / +Inf / -Inf / 1.5 / 0 / -1 all throw', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    for (const bad of [NaN, Infinity, -Infinity, 1.5, 0, -1]) {
        assert.throws(() => c.fillCellField2(dst, 4, 4, { periodX: bad, periodY: 4 }),
            /tiling requires positive integer periodX and periodY/, 'periodX=' + bad);
        assert.throws(() => c.fillCellField2(dst, 4, 4, { periodX: 4, periodY: bad }),
            /tiling requires positive integer periodX and periodY/, 'periodY=' + bad);
    }
});

test('tileableCell2: periodX/periodY as -0, a boxed Number, a string, or -Infinity all throw (non-number and non-primitive-integer forms)', () => {
    const c = createCellular(1);
    for (const bad of [-0, new Number(4), '4', -Infinity, null, undefined, {}]) {
        assert.throws(() => c.tileableCell2(0.5, 0.5, bad, 4), /positive integer periodX and periodY/, 'periodX=' + String(bad));
        assert.throws(() => c.tileableCell2(0.5, 0.5, 4, bad), /positive integer periodX and periodY/, 'periodY=' + String(bad));
    }
});

// ---------------------------------------------------------------------------
// 5. Bake == per-query differential, bit-for-bit, at MULTIPLE world coords, for
//    EACH combo, PLAIN and TILING (the core correctness proof, at unit-test
//    granularity -- torture T0 proves this too, over a fuzz corpus; this pins
//    it as a deterministic, always-run node:test with negative ox/oy and a
//    non-default metric, which the existing unit suite's single-case test for
//    'field bake: a hand-pinned small field...' does not exercise)
// ---------------------------------------------------------------------------

test('bake==per-query: PLAIN field, every combo, negative ox/oy, chebyshev metric, bit-for-bit', () => {
    const c = createCellular(9001, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const w = 6, h = 5, scale = 0.11, ox = -3.7, oy = -1.3;
    const o = { f1: 0, f2: 0, id: 0 };
    for (const [combo, pick] of [['f1', 'f1'], ['f2', 'f2'], ['f2-f1', 'd'], ['cracks', 'd']]) {
        const dst = new Float64Array(w * h);
        c.fillCellField2(dst, w, h, { combo, scale, ox, oy });
        let idx = 0, py = oy;
        for (let y = 0; y < h; y++) {
            let px = ox;
            for (let x = 0; x < w; x++) {
                c.cellular2(px, py, o);
                const expected = pick === 'f1' ? o.f1 : pick === 'f2' ? o.f2 : o.f2 - o.f1;
                assert.equal(dst[idx++], expected, `combo=${combo} pixel (${x},${y})`);
                px += scale;
            }
            py += scale;
        }
    }
});

test('bake==per-query: TILING field, every combo, negative ox/oy, manhattan metric, bit-for-bit', () => {
    const c = createCellular(9001, { metric: METRIC_MANHATTAN, jitter: 1 });
    const w = 7, h = 6, scale = 0.13, ox = -2.4, oy = 5.6, P = 4, Q = 3;
    const o = { f1: 0, f2: 0, id: 0 };
    for (const [combo, pick] of [['f1', 'f1'], ['f2', 'f2'], ['f2-f1', 'd'], ['cracks', 'd']]) {
        const dst = new Float64Array(w * h);
        c.fillCellField2(dst, w, h, { combo, scale, ox, oy, periodX: P, periodY: Q });
        let idx = 0, py = oy;
        for (let y = 0; y < h; y++) {
            let px = ox;
            for (let x = 0; x < w; x++) {
                c.tileableCell2(px, py, P, Q, o);
                const expected = pick === 'f1' ? o.f1 : pick === 'f2' ? o.f2 : o.f2 - o.f1;
                assert.equal(dst[idx++], expected, `combo=${combo} pixel (${x},${y})`);
                px += scale;
            }
            py += scale;
        }
    }
});

// ---------------------------------------------------------------------------
// 6. Combo algebra on a TILING bake (Cellular.test.js only checks the algebra on
//    a PLAIN bake -- the tiling loop is a structurally separate branch in the
//    source, so the algebra must be re-proven there too)
// ---------------------------------------------------------------------------

test('combo algebra on a TILING bake: f2-f1 == f2 - f1 pixelwise, cracks === f2-f1, exact', () => {
    const c = createCellular(7, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const w = 12, h = 12, n = w * h, P = 6, Q = 6;
    const f1 = new Float64Array(n), f2 = new Float64Array(n), d = new Float64Array(n), cr = new Float64Array(n);
    const bakeOpts = { scale: 6 / w, periodX: P, periodY: Q };
    c.fillCellField2(f1, w, h, { ...bakeOpts, combo: 'f1' });
    c.fillCellField2(f2, w, h, { ...bakeOpts, combo: 'f2' });
    c.fillCellField2(d, w, h, { ...bakeOpts, combo: 'f2-f1' });
    c.fillCellField2(cr, w, h, { ...bakeOpts, combo: 'cracks' });
    for (let i = 0; i < n; i++) {
        assert.equal(d[i], f2[i] - f1[i], 'tiling f2-f1 pixel ' + i);
        assert.equal(cr[i], d[i], 'tiling cracks alias pixel ' + i);
    }
});

// ---------------------------------------------------------------------------
// 7. Exact periodicity: cross-tile wrap well OUTSIDE [0,P), negative bases, and
//    a -0 coordinate pin on the tiling kernel (the C1 boundary suite pinned -0
//    for cellular2; this is the C2-surface companion)
// ---------------------------------------------------------------------------

test('tileable: exact periodicity holds for a shift many tiles away (x+5P, y-7Q), negative bases, all three metrics', () => {
    for (const id of [METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(1337, { metric: id, jitter: 1 });
        const P = 4, Q = 8;
        const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
        for (const [x, y] of [[-3.25, -7.5], [0.125, -0.125], [100.5, -200.25]]) {
            c.tileableCell2(x, y, P, Q, a);
            c.tileableCell2(x + 5 * P, y - 7 * Q, P, Q, b);
            assert.equal(b.f1, a.f1, `metric ${id} f1 at (${x},${y}) across a 5-tile/7-tile shift`);
            assert.equal(b.f2, a.f2, `metric ${id} f2`);
            assert.equal(b.id, a.id, `metric ${id} id`);
        }
    }
});

test('tileable: -0/-0 coordinate is bit-identical to +0/+0 under a period (companion to the C1 cellular2 -0 pin)', () => {
    // Object.is(-0, 0) is false, so pin with an explicit numeric-value comparison
    // (assert.equal on the RESULT fields, which are never raw -0 themselves here --
    // they are ordinary positive floats) rather than asserting anything about the
    // sign of the INPUT coordinate itself.
    const c = createCellular(1337, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const P = 4, Q = 8;
    const rNeg = c.tileableCell2(-0, -0, P, Q, { f1: 0, f2: 0, id: 0 });
    const rPos = c.tileableCell2(0, 0, P, Q, { f1: 0, f2: 0, id: 0 });
    assert.equal(rNeg.f1, rPos.f1);
    assert.equal(rNeg.f2, rPos.f2);
    assert.equal(rNeg.id, rPos.id);
});

// ---------------------------------------------------------------------------
// 8. Normalize edge cases beyond Cellular.test.js's jitter=0-grid constant field:
//    a genuine 1x1 field (range is 0 by DEFINITION, for any content, any combo)
// ---------------------------------------------------------------------------

test('normalize: a 1x1 field (n=1, min===max by construction) maps to 0, never NaN, for every combo', () => {
    const c = createCellular(11, { jitter: 1 });
    for (const combo of ['f1', 'f2-f1', 'cracks', 'f2']) {
        const dst = new Float64Array(1);
        c.fillCellField2(dst, 1, 1, { combo, normalize: true });
        assert.equal(dst[0], 0, `combo=${combo}: 1x1 normalized field must be exactly 0, not NaN`);
        assert.equal(Number.isNaN(dst[0]), false, `combo=${combo}`);
    }
});

// ---------------------------------------------------------------------------
// 9. out-struct reuse parity -- tileableCell2 (0006's companion to cellular2's
//    C1 out-reuse contract, not yet pinned for the new method)
// ---------------------------------------------------------------------------

test('tileableCell2: omitted `out` returns the instance\'s reused out-struct (identity, not a copy)', () => {
    const c = createCellular(42, { jitter: 1 });
    const r1 = c.tileableCell2(1.5, 2.5, 4, 4);
    assert.equal(r1, c._out, 'omitted out must be the SAME object as c._out');
});

test('tileableCell2: with vs without an explicit `out`, the VALUES are identical; the explicit out is returned BY REFERENCE (not a copy)', () => {
    const c = createCellular(42, { jitter: 1 });
    const implicit = c.tileableCell2(1.5, 2.5, 4, 4, undefined);
    const implicitSnap = { f1: implicit.f1, f2: implicit.f2, id: implicit.id };
    const explicit = { f1: -1, f2: -1, id: -1 };
    const r = c.tileableCell2(1.5, 2.5, 4, 4, explicit);
    assert.equal(r, explicit, 'passing an explicit out must return THAT object, by identity');
    assert.notEqual(r, c._out, 'an explicit out must NOT be (or alias) the instance scratch struct');
    assert.equal(r.f1, implicitSnap.f1);
    assert.equal(r.f2, implicitSnap.f2);
    assert.equal(r.id, implicitSnap.id);
});

// ---------------------------------------------------------------------------
// 10. Aliasing: bake into a subarray/view; two DIFFERENT instances baking into
//     different buffers, interleaved (synchronously re-entrant), do not
//     cross-contaminate
// ---------------------------------------------------------------------------

test('aliasing: fillCellField2 into a subarray VIEW writes only the view\'s window; bytes outside it (same backing buffer) are untouched', () => {
    const c = createCellular(1);
    const big = new Float64Array(24).fill(-999);
    const view = big.subarray(4, 20); // 16 elements, backed by the SAME buffer as `big`
    c.fillCellField2(view, 4, 4, { combo: 'f1' });
    for (let i = 0; i < 4; i++) assert.equal(big[i], -999, 'bytes before the view must be untouched, index ' + i);
    for (let i = 20; i < 24; i++) assert.equal(big[i], -999, 'bytes after the view must be untouched, index ' + i);
    for (let i = 4; i < 20; i++) assert.notEqual(big[i], -999, 'every element inside the view must be written, index ' + i);
});

test('aliasing: adversarial -- an opts getter that triggers a NESTED bake on a DIFFERENT instance/buffer mid-setup does not perturb the outer bake', () => {
    // `opts.scale` is read exactly once, at setup, before the pixel loop runs. A
    // getter that re-enters the library (a different instance, a different dst) at
    // that read point is a legal (if hostile) caller. Because all per-call state
    // (seed, jitter, scale, combo, kernel refs) lives in LOCALS captured before the
    // loop, and each instance owns its OWN `_out` scratch, the interleaved call on
    // instance `b` must have zero effect on instance `a`'s bake.
    const a = createCellular(11, { metric: METRIC_EUCLIDEAN });
    const b = createCellular(22, { metric: METRIC_MANHATTAN });
    const dstA = new Float64Array(16);
    const dstB = new Float64Array(9);
    let triggered = false;
    const opts = {
        get scale() {
            if (!triggered) { triggered = true; b.fillCellField2(dstB, 3, 3, { combo: 'f2' }); }
            return 0.05;
        },
        combo: 'f1',
    };
    a.fillCellField2(dstA, 4, 4, opts);
    assert.ok(triggered, 'the nested call did not fire -- test is not exercising interleaving');
    const refA = new Float64Array(16);
    a.fillCellField2(refA, 4, 4, { combo: 'f1', scale: 0.05 });
    for (let i = 0; i < 16; i++) assert.equal(dstA[i], refA[i], 'pixel ' + i + ' perturbed by the interleaved instance b bake');
    for (let i = 0; i < 9; i++) assert.ok(Number.isFinite(dstB[i]), 'instance b bake pixel ' + i + ' must itself complete correctly');
});

// ---------------------------------------------------------------------------
// 11. Re-entrant write: the shared per-instance scratch (`c._out`) is a documented
//     "next call overwrites it" contract (see cellular2's doc comment) -- this
//     section pins what happens when a caller installs accessor properties on
//     THAT object and re-enters the SAME instance mid-write. This is the
//     adversarial case beyond boundary-c1.test.js's re-entrant test, which used
//     a FRESH custom `out` for both the outer and nested call and therefore never
//     touched the shared scratch object at all.
// ---------------------------------------------------------------------------

test('re-entrant (adversarial, informational): instrumenting c._out with an accessor that re-enters cellular2 on the SAME instance can tear the shared scratch write', () => {
    // OBSERVED behaviour, not a contract: `c._out` is an internal field (the
    // underscore prefix; it is not part of the documented public API -- only the
    // `out` PARAMETER is). A caller who reaches into it with Object.defineProperty
    // and installs a re-entrant setter is doing something no public API enables.
    // Pinned here so a change to this internal behaviour is caught as a diff, and
    // to prove the boundary matrix's "re-entrant write" case was actually measured
    // for the C2 surface, not merely asserted safe by resemblance to the C1 test.
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
                c.cellular2(99.9, 88.8); // omitted out -> the SAME c._out, re-entered
            }
        },
    });
    const outer = c.cellular2(5.5, 6.6); // omitted out -> also c._out
    assert.ok(nestedRan, 'the nested re-entrant call did not fire -- test is not exercising the hazard');
    const refOuter = c.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    const refNested = c.cellular2(99.9, 88.8, { f1: 0, f2: 0, id: 0 });
    // OBSERVED: f2 and id (written by the OUTER call AFTER the f1 setter returns)
    // survive intact -- the outer call's own locals are unaffected by the nested
    // call's kernel run.
    assert.equal(outer.f2, refOuter.f2, 'f2 (written after the hazard point) must be the OUTER value');
    assert.equal(outer.id, refOuter.id, 'id (written after the hazard point) must be the OUTER value');
    // OBSERVED: f1 (written, via the setter, BEFORE and then again as a SIDE
    // EFFECT of the nested call reusing the same shared object) ends up holding
    // the NESTED call's value, not the outer one -- a torn/mixed read on this one
    // field. Documented as a finding for the coder/reviewer, not silently patched
    // here (this file may only add tests, not change Cellular.js).
    assert.equal(outer.f1, refNested.f1,
        'OBSERVED: f1 reflects the NESTED call after a re-entrant accessor on the shared scratch (see QA finding)');
});

// ---------------------------------------------------------------------------
// 12. "dispose" -- N/A for the C2 surface too (documented, not silently skipped,
//     mirroring boundary-c1.test.js SS6); pin idempotent repeated bakes and a
//     bake-during-a-caller-loop instead, since there is no lifecycle to double-
//     free or call mid-iteration
// ---------------------------------------------------------------------------

test('dispose semantics (C2): N/A -- fillCellField2/tileableCell2 own no external resource; repeated bakes into the same dst are a clean overwrite, not a double-free', () => {
    const c = createCellular(1);
    const dst = new Float64Array(16);
    c.fillCellField2(dst, 4, 4, { combo: 'f1' });
    const first = Array.from(dst);
    c.fillCellField2(dst, 4, 4, { combo: 'f1', scale: 0.2 }); // "duplicate dispose" analogue: call again
    const second = Array.from(dst);
    assert.notDeepEqual(second, first, 'a different scale must produce a different bake (proves the second call actually ran, not a no-op)');
    // "dispose-during-iteration" analogue: bake repeatedly from inside a caller loop.
    for (let i = 0; i < 5; i++) {
        c.reseed(i);
        c.fillCellField2(dst, 4, 4, { combo: 'f2' });
        c.tileableCell2(i, i, 4, 4);
    }
    assert.ok(true, 'no throw across repeated in-loop bakes/tile-queries with interleaved reseed');
});
