/**
 * T0 -- metamorphic laws for all three metrics, over a seeded corpus:
 *
 *   (a) determinism   -- cellular2 twice at the same coord is bit-for-bit equal,
 *                        for each metric.
 *   (b) range         -- f1 <= f2, both finite and >= 0, for each metric.
 *   (c) metric-sanity -- with the SAME seed and jitter (identical feature-point
 *                        placement, 0003), cheby.f <= euclid.f <= manhattan.f for
 *                        BOTH f1 AND f2. This is the Linf <= L2 <= L1 order-statistic
 *                        inequality; it holds for both ranks because order statistics
 *                        are monotone under elementwise domination -- so f2 is NOT
 *                        redundant with f1 and must not be "simplified" away (0001).
 *   (d) jitter=0 grid -- a jitter=0 instance's f1 equals the distance to the nearest
 *                        cell CENTRE computed independently IN THAT INSTANCE'S METRIC
 *                        (0003: jitter=0 is a grid; the nearest centre is the same
 *                        cell for all three metrics on a product grid).
 *   (e) id-within-cell -- with jitter=0 the Voronoi region IS the grid cell, so every
 *                        interior point of a cell shares one id (0004), and distinct
 *                        cells carry distinct ids.
 *   (f) metric-dependent id -- the F1 owner is metric-dependent (0004): there EXISTS
 *                        a corpus coord where euclid.id differs from manhattan or
 *                        chebyshev id at the same point. An existence assertion, not
 *                        an equality -- it documents the property so it is not a
 *                        surprise.
 *   (g) golden        -- the committed euclidean / manhattan / chebyshev digests all
 *                        re-derive bit-for-bit; euclidean must stay 33a16e9e.
 *
 * Each law is written to FAIL if the feature it names broke -- not merely to
 * exercise the call.
 *
 * @license MIT
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { makePrng, SEED, assertHot } from './harness.mjs';
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, METRICS, digest } from '../../goldens/gen.mjs';

const N = 4096;         // corpus size
const HERE = dirname(fileURLToPath(import.meta.url));
const EPS = 1e-9;

export function run() {
    const prng = makePrng(SEED);

    // Same seed + jitter across the three metrics -> identical feature placement,
    // so the metric-sanity ordering is a pure statement about the distance line.
    const euclid = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const manhat = createCellular(SEED | 0, { metric: METRIC_MANHATTAN, jitter: 1 });
    const cheby = createCellular(SEED | 0, { metric: METRIC_CHEBYSHEV, jitter: 1 });

    // jitter=0 grid instances, one per metric.
    const e0 = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 0 });
    const m0 = createCellular(SEED | 0, { metric: METRIC_MANHATTAN, jitter: 0 });
    const c0 = createCellular(SEED | 0, { metric: METRIC_CHEBYSHEV, jitter: 0 });

    const re = { f1: 0, f2: 0, id: 0 };
    const rm = { f1: 0, f2: 0, id: 0 };
    const rc = { f1: 0, f2: 0, id: 0 };
    const b = { f1: 0, f2: 0, id: 0 };

    let sawMetricDependentId = false;

    for (let i = 0; i < N; i++) {
        // Coords straddling zero, spanning ~ +/-512 with sub-cell fractions.
        const x = ((prng() % 100000) / 97) - 512;
        const y = ((prng() % 100000) / 89) - 512;

        euclid.cellular2(x, y, re);
        manhat.cellular2(x, y, rm);
        cheby.cellular2(x, y, rc);

        // (a) determinism -- same seed+coord, bit-for-bit, per metric.
        euclid.cellular2(x, y, b);
        assertHot(re.f1 === b.f1 && re.f2 === b.f2 && re.id === b.id,
            () => `T0.determinism[euclid]: (${x},${y}) differs on repeat (seed=${SEED})`);
        manhat.cellular2(x, y, b);
        assertHot(rm.f1 === b.f1 && rm.f2 === b.f2 && rm.id === b.id,
            () => `T0.determinism[manhat]: (${x},${y}) differs on repeat (seed=${SEED})`);
        cheby.cellular2(x, y, b);
        assertHot(rc.f1 === b.f1 && rc.f2 === b.f2 && rc.id === b.id,
            () => `T0.determinism[cheby]: (${x},${y}) differs on repeat (seed=${SEED})`);

        // (b) range, per metric.
        assertHot(re.f1 >= 0 && re.f2 >= 0 && Number.isFinite(re.f1) && Number.isFinite(re.f2) && re.f1 <= re.f2,
            () => `T0.range[euclid]: f1=${re.f1} f2=${re.f2} at (${x},${y}) (seed=${SEED})`);
        assertHot(rm.f1 >= 0 && rm.f2 >= 0 && Number.isFinite(rm.f1) && Number.isFinite(rm.f2) && rm.f1 <= rm.f2,
            () => `T0.range[manhat]: f1=${rm.f1} f2=${rm.f2} at (${x},${y}) (seed=${SEED})`);
        assertHot(rc.f1 >= 0 && rc.f2 >= 0 && Number.isFinite(rc.f1) && Number.isFinite(rc.f2) && rc.f1 <= rc.f2,
            () => `T0.range[cheby]: f1=${rc.f1} f2=${rc.f2} at (${x},${y}) (seed=${SEED})`);

        // (c) metric-sanity: cheby <= euclid <= manhattan, for f1 AND f2. f2 is
        // included on purpose -- the ordering holds for the second rank too, and a
        // future reader must not drop it as "obviously the same as f1".
        assertHot(rc.f1 <= re.f1 + EPS && re.f1 <= rm.f1 + EPS,
            () => `T0.sanity.f1: cheby=${rc.f1} euclid=${re.f1} manhat=${rm.f1} at (${x},${y}) (seed=${SEED})`);
        assertHot(rc.f2 <= re.f2 + EPS && re.f2 <= rm.f2 + EPS,
            () => `T0.sanity.f2: cheby=${rc.f2} euclid=${re.f2} manhat=${rm.f2} at (${x},${y}) (seed=${SEED})`);

        // (d) jitter=0 grid distance, per metric. Nearest centre is separable per
        // axis and identical for all three metrics on the product grid.
        const cxc = Math.round(x - 0.5) + 0.5;
        const cyc = Math.round(y - 0.5) + 0.5;
        const ax = Math.abs(cxc - x), ay = Math.abs(cyc - y);
        e0.cellular2(x, y, b);
        assertHot(Math.abs(b.f1 - Math.sqrt(ax * ax + ay * ay)) <= EPS,
            () => `T0.grid[euclid]: f1=${b.f1} != L2 nearest-centre at (${x},${y}) (seed=${SEED})`);
        m0.cellular2(x, y, b);
        assertHot(Math.abs(b.f1 - (ax + ay)) <= EPS,
            () => `T0.grid[manhat]: f1=${b.f1} != L1 nearest-centre at (${x},${y}) (seed=${SEED})`);
        c0.cellular2(x, y, b);
        assertHot(Math.abs(b.f1 - Math.max(ax, ay)) <= EPS,
            () => `T0.grid[cheby]: f1=${b.f1} != Linf nearest-centre at (${x},${y}) (seed=${SEED})`);

        // (f) metric-dependent owner: record whether any coord's F1 owner differs
        // across metrics (existence, asserted after the loop).
        if (re.id !== rm.id || re.id !== rc.id) sawMetricDependentId = true;
    }

    assertHot(sawMetricDependentId,
        () => `T0.metric-id: no coord in ${N} showed a metric-dependent F1 owner -- 0004's metric-dependence unverified (seed=${SEED})`);

    // (e) id-within-cell (jitter=0), per metric. Interior points of one grid cell
    // share an id; distinct cells carry (with overwhelming probability) distinct ids.
    for (const [name, inst] of [['euclid', e0], ['manhat', m0], ['cheby', c0]]) {
        const ids = [];
        for (let cy = -2; cy <= 2; cy++) {
            for (let cx = -2; cx <= 2; cx++) {
                let cellId = 0;
                let first = true;
                for (let sy = 0.15; sy <= 0.85; sy += 0.1) {
                    for (let sx = 0.15; sx <= 0.85; sx += 0.1) {
                        inst.cellular2(cx + sx, cy + sy, b);
                        if (first) { cellId = b.id; first = false; }
                        else assertHot(b.id === cellId,
                            () => `T0.id[${name}]: cell (${cx},${cy}) id changed inside its interior (seed=${SEED})`);
                    }
                }
                ids.push(cellId);
            }
        }
        let distinct = 0;
        for (let i = 0; i < ids.length; i++) {
            let seenBefore = false;
            for (let j = 0; j < i; j++) if (ids[j] === ids[i]) { seenBefore = true; break; }
            if (!seenBefore) distinct++;
        }
        assertHot(distinct > 1,
            () => `T0.id[${name}]: all ${ids.length} sampled cells share one id -- ids not per-cell (seed=${SEED})`);
    }

    // (g) golden -- the committed euclidean / manhattan / chebyshev digests all
    // re-derive from source. Euclidean must stay 33a16e9e (byte-unchanged refactor).
    for (const metric of METRICS) {
        const committed = JSON.parse(readFileSync(join(HERE, '../../goldens/' + metric.name + '.json'), 'utf8'));
        const gcell = createCellular(GOLD_SEED, { metric: metric.id, jitter: GOLD_JITTER });
        const got = digest(gcell, COORDS);
        assertHot(got === committed.digest,
            () => `T0.golden[${metric.name}]: digest ${got} != committed ${committed.digest} -- breaking kernel change`);
    }
}
