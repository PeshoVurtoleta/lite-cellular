/**
 * T1 -- degenerate query values, across all three metrics.
 *
 * Crosses every query with the adversarial value matrix and PINS the actual
 * answer (including "this throws" for non-finite coords). Each metric is checked
 * so a metric-specific kernel cannot diverge on an edge value unnoticed.
 *
 *   - 0 / -0            : bit-identical outputs (no sign artefact at the origin).
 *   - +Inf / -Inf / NaN : THROW at the door in every sign combination (fail-closed;
 *                         Math.floor is never handed a non-finite).
 *   - subnormal (1e-45) : does not throw; collapses to the (0,0) result (below the
 *                         fx-x subtraction ULP).
 *   - f32 max (3.4e38)  : does not throw; documented float64 collapse (both axes
 *                         degenerate -> f1 == f2). Pinned as a value, not a throw.
 *   - 2^24 / 2^24+1     : distinct, finite (float64 resolves adjacent integers that
 *                         float32 would not) -- id differs across the pair.
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

const METRIC_IDS = [
    ['euclid', METRIC_EUCLIDEAN],
    ['manhat', METRIC_MANHATTAN],
    ['cheby', METRIC_CHEBYSHEV],
];

export function run() {
    const a = { f1: 0, f2: 0, id: 0 };
    const bb = { f1: 0, f2: 0, id: 0 };

    for (const [name, id] of METRIC_IDS) {
        const c = createCellular(42, { metric: id, jitter: 1 });
        const c0 = createCellular(42, { metric: id, jitter: 0 });

        // 0 vs -0 in every sign combination: bit-identical.
        c.cellular2(0, 0, a);
        for (const [x, y] of [[-0, -0], [-0, 0], [0, -0]]) {
            c.cellular2(x, y, bb);
            assertHot(a.f1 === bb.f1 && a.f2 === bb.f2 && a.id === bb.id,
                () => `T1[${name}].negzero: (${x},${y}) differs from (0,0)`);
        }

        // Non-finite coords throw at the door, every sign combination.
        const bad = [Infinity, -Infinity, NaN];
        const finite = [0, -0, 1, -1];
        for (const nf of bad) {
            for (const f of finite) {
                let threwX = false, threwY = false;
                try { c.cellular2(nf, f, a); } catch (e) { threwX = /requires finite/.test(e.message); }
                try { c.cellular2(f, nf, a); } catch (e) { threwY = /requires finite/.test(e.message); }
                assertHot(threwX, () => `T1[${name}].nonfinite: (${nf},${f}) did not throw`);
                assertHot(threwY, () => `T1[${name}].nonfinite: (${f},${nf}) did not throw`);
            }
            for (const nf2 of bad) {
                let threw = false;
                try { c.cellular2(nf, nf2, a); } catch (e) { threw = /requires finite/.test(e.message); }
                assertHot(threw, () => `T1[${name}].nonfinite: (${nf},${nf2}) did not throw`);
            }
        }

        // Subnormal magnitude collapses to the (0,0) result at this scale.
        c.cellular2(0, 0, a);
        c.cellular2(1e-45, 1e-45, bb);
        assertHot(a.f1 === bb.f1 && a.f2 === bb.f2 && a.id === bb.id,
            () => `T1[${name}].subnormal: 1e-45 not indistinguishable from 0`);

        // f32 max: documented float64 collapse -- both axes degenerate, f1 == f2.
        c.cellular2(3.4e38, 3.4e38, a);
        assertHot(a.f1 === a.f2 && Number.isInteger(a.id),
            () => `T1[${name}].f32max: expected degenerate f1==f2 at 3.4e38 (f1=${a.f1} f2=${a.f2})`);

        // 2^24 boundary pair: distinct and finite in float64; ids differ.
        c0.cellular2(16777216, 0, a);
        c0.cellular2(16777217, 0, bb);
        assertHot(Number.isFinite(a.f1) && Number.isFinite(bb.f1) && a.f1 <= a.f2 && bb.f1 <= bb.f2,
            () => `T1[${name}].2^24: non-finite or f1>f2 at the integer boundary`);
        assertHot(a.id !== bb.id,
            () => `T1[${name}].2^24: 2^24 and 2^24+1 collapsed to one cell (id ${a.id})`);
    }
}
