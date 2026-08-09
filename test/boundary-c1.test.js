/**
 * @zakkster/lite-cellular -- C1 boundary & adversarial coverage (QA pass).
 *
 * Extends test/boundary.test.js (C0-era, single-metric euclidean scope) to the
 * C1 surface: the three-metric guard, the manhattan/chebyshev branchless
 * abs/max distance line at exact-tie/one-ulp boundaries, the module free
 * surface's own throw/out-reuse contract, and re-entrant/aliasing adversarial
 * cases the planner's brief did not enumerate. Does not repeat any case
 * boundary.test.js already covers at euclidean/C0 scope.
 *
 * Every pinned literal below was captured by running the FROZEN, reviewed
 * Cellular.js directly (node -e, no editing) -- these document what C1 does
 * today so a future change is caught as a diff, per decisions/0001..0004.
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCellular,
    cellular2 as moduleCellular2,
    seedCellular,
    METRIC_EUCLIDEAN, METRIC_MANHATTAN, METRIC_CHEBYSHEV,
} from '../Cellular.js';

// ---------------------------------------------------------------------------
// 1. Metric guard boundary matrix (0001: widens the accepted set, never
//    loosens it -- 0/1/2 accepted, everything else throws)
// ---------------------------------------------------------------------------

test('guard: opts.metric === undefined does NOT throw -- defaults to euclidean (distinct from a bad value)', () => {
    // The planner's brief calls this out by name: undefined must NOT throw. It
    // is the "opts key present but unset" path, not merely "opts omitted".
    const c = createCellular(9, { metric: undefined });
    assert.equal(c._metric, METRIC_EUCLIDEAN);
    const r = c.cellular2(1.5, 2.5);
    assert.deepEqual(Object.keys(r).sort(), ['f1', 'f2', 'id']);
});

test('guard: opts omitted, opts={}, and opts=null all default identically to euclidean/jitter=1', () => {
    const byOmission = createCellular(9);
    const byEmpty = createCellular(9, {});
    const byNull = createCellular(9, null);
    for (const c of [byOmission, byEmpty, byNull]) {
        assert.equal(c._metric, METRIC_EUCLIDEAN);
        assert.equal(c._jitter, 1);
    }
});

test('guard: metric={} (a bare object) throws -- fail-closed on an object, not just primitives', () => {
    // Named explicitly in the QA brief: {} was not in the coder's bad-metric list.
    assert.throws(() => createCellular(0, { metric: {} }), /unknown metric id/);
});

test('guard: adversarial -- a boxed Number(1) metric throws (strict === rejects the box, not just the value)', () => {
    // new Number(1) is an object; `metric !== METRIC_MANHATTAN` etc. all use
    // strict ===, so a boxed primitive can never equal 0/1/2 and must be
    // rejected exactly like any other unknown id -- pinning that the guard is
    // not accidentally doing a `==` coercion anywhere.
    // eslint-disable-next-line no-new-wrappers
    assert.throws(() => createCellular(0, { metric: new Number(1) }), /unknown metric id/);
});

test('guard: adversarial -- metric=-0 is ACCEPTED (strict equality: -0 === 0) and behaves as euclidean', () => {
    // -0 !== METRIC_EUCLIDEAN (0) is false in JS (-0 === 0), so the guard lets
    // it through. `_metric` stores the literal -0 (Object.is distinguishes it
    // from +0), but the kernel binding (`metric === METRIC_MANHATTAN` etc.)
    // is equally insensitive to the sign of zero, so it still resolves to the
    // euclidean kernel. Documented so a future reader is not surprised that
    // `c._metric` can be `-0` while behaving exactly like `0`.
    const c = createCellular(9, { metric: -0 });
    assert.equal(Object.is(c._metric, -0), true, '_metric stores -0 literally, not coerced to +0');
    // node:assert/strict's `equal` uses SameValue (Object.is), which DOES
    // distinguish -0 from +0 -- unlike the `===` the guard itself uses. Assert
    // with `==` here to state precisely the guard's own comparison semantics.
    // eslint-disable-next-line eqeqeq
    assert.ok(c._metric == METRIC_EUCLIDEAN, '-0 == 0 under strict equality, so the guard accepts it');
    const withZero = createCellular(9, { metric: 0 }).cellular2(3.3, 4.4);
    const withNegZero = createCellular(9, { metric: -0 }).cellular2(3.3, 4.4);
    assert.deepEqual(withNegZero, withZero, 'metric=-0 must sample bit-identically to metric=0 (both bind the euclidean kernel)');
});

test('guard: N-1/N/N+1 at the top of the metric id space -- 1 and 2 construct, 3 throws', () => {
    assert.doesNotThrow(() => createCellular(0, { metric: 1 }));
    assert.doesNotThrow(() => createCellular(0, { metric: 2 }));
    assert.throws(() => createCellular(0, { metric: 3 }), /unknown metric id/);
});

// ---------------------------------------------------------------------------
// 2. Branchless abs/max at exact ties, one-ulp-apart, and dx=-0 -- pinning the
//    "digest-identical" claim (0001 Measured) as an explicit boundary
//    assertion, not just benign scattered coords.
// ---------------------------------------------------------------------------

test('branchless: manhattan/chebyshev EXACT tie at a jitter=0 cell boundary (x=1) -- f1===f2, first-scanned id wins (0004)', () => {
    for (const id of [METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(42, { metric: id, jitter: 0 });
        const r = c.cellular2(1, 0.5, { f1: 0, f2: 0, id: 0 });
        assert.equal(r.f1, 0.5, `metric ${id} f1 at exact boundary`);
        assert.equal(r.f2, 0.5, `metric ${id} f2 at exact boundary (a real tie)`);
        assert.equal(r.id, 3327947, `metric ${id} tie-break must resolve to the first-scanned (cx=0) cell (0004 scan-order rule)`);
    }
});

test('branchless: manhattan/chebyshev one ulp EACH SIDE of the x=1 boundary flips the id, pinned f1/f2', () => {
    // 1 - Number.EPSILON and 1 (both floor to cell 0's neighbourhood owner via
    // the tie-break) share one id; 1 + Number.EPSILON crosses into cell 1's
    // domain (floor(1+eps)=1) and the id flips. Pins the branchless abs path at
    // the tightest possible float64 spacing around a boundary.
    for (const id of [METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(42, { metric: id, jitter: 0 });
        const below = c.cellular2(1 - Number.EPSILON, 0.5, { f1: 0, f2: 0, id: 0 });
        const at = c.cellular2(1, 0.5, { f1: 0, f2: 0, id: 0 });
        const above = c.cellular2(1 + Number.EPSILON, 0.5, { f1: 0, f2: 0, id: 0 });
        assert.equal(below.f1, 0.4999999999999998, `metric ${id} below.f1`);
        assert.equal(below.f2, 0.5000000000000002, `metric ${id} below.f2`);
        assert.equal(below.id, 3327947, `metric ${id} below.id`);
        assert.equal(at.f1, 0.5, `metric ${id} at.f1 (exact tie)`);
        assert.equal(at.f2, 0.5, `metric ${id} at.f2 (exact tie)`);
        assert.equal(at.id, 3327947, `metric ${id} at.id must match "below", not "above" (tie-break favours the lower/first-scanned cell)`);
        assert.equal(above.f1, 0.4999999999999998, `metric ${id} above.f1`);
        assert.equal(above.f2, 0.5000000000000002, `metric ${id} above.f2`);
        assert.equal(above.id, -1123761954, `metric ${id} above.id`);
        assert.notEqual(above.id, below.id, `metric ${id}: crossing the ulp boundary above x=1 must flip the owner cell`);
    }
});

test('branchless: manhattan/chebyshev straddling x=0 with a signed-zero query (dx can be exactly -0 in the subtraction)', () => {
    // fx (a cell centre, jitter=0) is always a positive value or an exact
    // integer+0.5; x=-0 exercises `fx - (-0)` in the distance line, which IEEE
    // 754 defines as `fx + 0` (never negative), so this pins that -0 does not
    // perturb the branchless Math.abs/Math.max path relative to +0.
    for (const id of [METRIC_MANHATTAN, METRIC_CHEBYSHEV]) {
        const c = createCellular(42, { metric: id, jitter: 0 });
        const negZero = c.cellular2(-0, 0.5, { f1: 0, f2: 0, id: 0 });
        const posZero = c.cellular2(0, 0.5, { f1: 0, f2: 0, id: 0 });
        assert.deepEqual(negZero, posZero, `metric ${id}: x=-0 must be bit-identical to x=0`);
        assert.equal(negZero.f1, 0.5);
        assert.equal(negZero.id, 1403518774);
    }
});

// ---------------------------------------------------------------------------
// 3. Module free surface: throw parity + out-reuse identity (both untested at
//    C0/C1-unit scope before this file -- only the instance path was pinned)
// ---------------------------------------------------------------------------

test('module surface: non-finite coords throw on the module cellular2 path too, same message as the instance path', () => {
    const c = createCellular(1);
    for (const [x, y] of [[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [NaN, NaN]]) {
        let instMsg = null, modMsg = null;
        try { c.cellular2(x, y); } catch (e) { instMsg = e.message; }
        try { moduleCellular2(x, y); } catch (e) { modMsg = e.message; }
        assert.ok(instMsg, `instance path did not throw for (${x},${y})`);
        assert.ok(modMsg, `module path did not throw for (${x},${y})`);
        assert.equal(modMsg, instMsg, `module and instance throw messages diverge for (${x},${y})`);
    }
});

test('module surface: omitted out on the module path returns the SAME reused module struct across many calls', () => {
    const first = moduleCellular2(0.1, 0.1);
    const identities = new Set();
    for (let i = 0; i < 50; i++) identities.add(moduleCellular2(i * 0.37, i * 0.51));
    assert.equal(identities.size, 1, 'every omitted-out module call must return the identical object');
    assert.ok(identities.has(first));
});

test('module surface: an explicit out on the module path is written in place and returned by reference', () => {
    const out = { f1: -1, f2: -1, id: -1 };
    const r = moduleCellular2(2.2, 3.3, out);
    assert.equal(r, out);
    assert.notEqual(out.f1, -1);
});

test('module surface: a frozen out on the module path throws TypeError, not a silent no-op (parity with the instance path)', () => {
    const frozen = Object.freeze({ f1: 0, f2: 0, id: 0 });
    assert.throws(() => moduleCellular2(1, 1, frozen), TypeError);
    assert.equal(frozen.f1, 0);
});

// ---------------------------------------------------------------------------
// 4. Re-entrant write / aliasing adversarial cases
// ---------------------------------------------------------------------------

test('re-entrant: writing into cellular2 result while a NESTED cellular2 call is in flight does not corrupt either result', () => {
    // The adversarial case the planner's brief did not name: an `out` object
    // whose `f1` setter re-enters `cellular2` on the SAME instance mid-write.
    // Because state (seed/jitter) lives in locals passed as parameters (not on
    // `this` read mid-call) and each call receives its own `out` target, the
    // outer write must complete with values from the OUTER query, not get
    // clobbered by the inner one.
    const c = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    let nestedRan = false;
    let nestedResult = null;
    const out = {
        _f1: 0, f2: 0, id: 0,
        get f1() { return this._f1; },
        set f1(v) {
            this._f1 = v;
            if (!nestedRan) {
                nestedRan = true;
                // Re-enter cellular2 on the SAME instance with a fresh out,
                // from inside the outer call's own write.
                nestedResult = c.cellular2(99.9, 88.8, { f1: 0, f2: 0, id: 0 });
            }
        },
    };
    const outerResult = c.cellular2(5.5, 6.6, out);
    // The outer call's f1 must reflect the OUTER query (5.5,6.6), not have
    // been overwritten by the nested query's values.
    const reference = c.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    assert.equal(outerResult._f1, reference.f1, 're-entrant nested call corrupted the outer write');
    assert.ok(nestedRan, 'the nested re-entrant call did not fire -- test is not exercising re-entrancy');
    assert.ok(nestedResult && Number.isFinite(nestedResult.f1), 'the nested call itself must complete correctly');
});

test('aliasing: adversarial -- passing the instance\'s OWN retained out-struct back in as `out` is a safe no-op alias, not corruption', () => {
    // A caller could (mistakenly or not) pass `c._out` itself back in as the
    // explicit `out` argument. Since the kernel only ever WRITES to `out.f1`/
    // `f2`/`id` (never reads them first), this must be equivalent to omitting
    // `out` entirely -- no stale-read/write hazard.
    const c = createCellular(7, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    c.cellular2(1, 1); // populate c._out with something first
    const selfAliased = c.cellular2(2.5, 3.5, c._out);
    assert.equal(selfAliased, c._out);
    const reference = c.cellular2(2.5, 3.5, { f1: 0, f2: 0, id: 0 });
    assert.deepEqual({ f1: selfAliased.f1, f2: selfAliased.f2, id: selfAliased.id }, reference);
});

test('aliasing: adversarial -- one `out` object shared across TWO instances of different metrics in sequence does not leak state between them', () => {
    // Nothing in the kernel reads `out`'s prior contents, so alternating writes
    // from different metric instances into the same struct must each be a
    // clean overwrite, never a partial blend of the previous metric's values.
    const shared = { f1: -1, f2: -1, id: -1 };
    const euclid = createCellular(5, { metric: METRIC_EUCLIDEAN, jitter: 0 });
    const manhat = createCellular(5, { metric: METRIC_MANHATTAN, jitter: 0 });

    euclid.cellular2(2.5, 2.5, shared);
    const afterEuclid = { ...shared };
    manhat.cellular2(2.5, 2.5, shared);
    const afterManhat = { ...shared };

    const refEuclid = euclid.cellular2(2.5, 2.5, { f1: 0, f2: 0, id: 0 });
    const refManhat = manhat.cellular2(2.5, 2.5, { f1: 0, f2: 0, id: 0 });
    assert.deepEqual(afterEuclid, refEuclid);
    assert.deepEqual(afterManhat, refManhat, 'the manhattan write must be a clean overwrite, not blended with the prior euclidean values');
});

// ---------------------------------------------------------------------------
// 5. Isolation: structural pin that an instance's kernel arguments never touch
//    module state (the unit-test companion to T5, C1-specific: covers a
//    manhattan/chebyshev instance too, not only the euclidean default)
// ---------------------------------------------------------------------------

test('isolation: seedCellular does not perturb a manhattan or chebyshev instance (not just the euclidean default)', () => {
    const man = createCellular(111, { metric: METRIC_MANHATTAN, jitter: 1 });
    const cheb = createCellular(222, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const beforeMan = man.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    const beforeCheb = cheb.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    for (const s of [1, 2, 3, 999]) seedCellular(s);
    const afterMan = man.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    const afterCheb = cheb.cellular2(5.5, 6.6, { f1: 0, f2: 0, id: 0 });
    assert.deepEqual(afterMan, beforeMan, 'seedCellular perturbed a manhattan instance');
    assert.deepEqual(afterCheb, beforeCheb, 'seedCellular perturbed a chebyshev instance');
});

// ---------------------------------------------------------------------------
// 6. Dispose semantics -- N/A for this module, documented rather than skipped
// ---------------------------------------------------------------------------

test('dispose semantics: N/A -- Cellular has no dispose/close/destroy lifecycle to double-free or call mid-iteration', () => {
    // Cellular is a plain stateless-per-call object: construction allocates one
    // reused out-struct and nothing else, there is no external resource (file
    // handle, timer, listener) to release, and `reseed` is idempotent and safe
    // to call any number of times, including from inside a loop that is also
    // calling `cellular2` (there is no iterator/generator state to invalidate).
    // This test exists so "duplicate dispose" / "dispose-during-iteration" are
    // seen to have been considered and explicitly ruled out, not silently
    // skipped.
    const c = createCellular(1);
    c.reseed(2); c.reseed(2); c.reseed(3); // "duplicate dispose" analogue: idempotent, no throw
    for (let i = 0; i < 4; i++) { c.cellular2(i, i); c.reseed(i); } // reseed-during-iteration
    assert.ok(true);
});
