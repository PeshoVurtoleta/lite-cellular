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
import { makePrng, SEED, assertHot, die, BREAK_FLOATWRAP, BREAK_FLOATWRAP3 } from './harness.mjs';
import { tileHashRawCell, tileHashRawCell3 } from './broken.mjs';
import {
    COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, METRICS, digest,
    COORDS3, METRICS3, digest3,
} from '../../goldens/gen.mjs';

const N = 4096;         // corpus size
const HERE = dirname(fileURLToPath(import.meta.url));
const EPS = 1e-9;

// A representable (dyadic) tile corpus: integer base + j/64 fraction, small and
// large bases straddling zero. On such coords the fractional home-cell position
// `rx = x - floor(x)` is bit-stable under a +period shift, so exact `===`
// periodicity is well-defined -- a coordinate-sampled float field is exactly
// periodic only where the query coord's fraction is preserved across the shift, and
// the integer-cell wrap makes it so on representable coords (0006 Decision 2). The
// per-region `id` is exactly periodic on ANY coord (it is a pure integer-cell hash).
const TILE_PX = 4, TILE_PY = 8, TILE_PZ = 6;
const TILE_COORDS = (() => {
    const bases = [0, 3, -5, 16, 128, 1024];
    const arr = [];
    for (const bx of bases) for (let j = 0; j < 64; j += 5) arr.push(bx + j / 64);
    return arr;
})();

/**
 * The exact-periodicity law as a predicate over a tile sampler, so T9 (and the
 * BREAK_FLOATWRAP control) can run it against a broken kernel. True iff
 * `tile(x,y) === tile(x+P,y)` and `=== tile(x,y+Q)` bit-for-bit (f1/f2/id) over the
 * dyadic corpus.
 * @param {(x:number,y:number,P:number,Q:number,out:object)=>object} sampleTile
 */
export function exactPeriodicityHolds(sampleTile) {
    const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
    for (let i = 0; i < TILE_COORDS.length; i++) {
        const x = TILE_COORDS[i];
        for (let k = 0; k < TILE_COORDS.length; k += 3) {
            const y = TILE_COORDS[k];
            sampleTile(x, y, TILE_PX, TILE_PY, a);
            sampleTile(x + TILE_PX, y, TILE_PX, TILE_PY, b);
            if (a.f1 !== b.f1 || a.f2 !== b.f2 || a.id !== b.id) return false;
            sampleTile(x, y + TILE_PY, TILE_PX, TILE_PY, b);
            if (a.f1 !== b.f1 || a.f2 !== b.f2 || a.id !== b.id) return false;
        }
    }
    return true;
}

/**
 * The 3D exact-periodicity law as a predicate over a 3D tile sampler, so T9 (and the
 * BREAK_FLOATWRAP3 control) can run it against a broken kernel. True iff the volume is
 * bit-identical across a +period shift on ALL THREE axes over the dyadic corpus.
 * @param {(x:number,y:number,z:number,P:number,Q:number,R:number,out:object)=>object} sampleTile
 */
export function exactPeriodicity3Holds(sampleTile) {
    const a = { f1: 0, f2: 0, id: 0 }, b = { f1: 0, f2: 0, id: 0 };
    for (let i = 0; i < TILE_COORDS.length; i += 2) {
        const x = TILE_COORDS[i];
        for (let k = 0; k < TILE_COORDS.length; k += 6) {
            const y = TILE_COORDS[k];
            const z = TILE_COORDS[(i + k) % TILE_COORDS.length];
            sampleTile(x, y, z, TILE_PX, TILE_PY, TILE_PZ, a);
            sampleTile(x + TILE_PX, y, z, TILE_PX, TILE_PY, TILE_PZ, b);
            if (a.f1 !== b.f1 || a.f2 !== b.f2 || a.id !== b.id) return false;
            sampleTile(x, y + TILE_PY, z, TILE_PX, TILE_PY, TILE_PZ, b);
            if (a.f1 !== b.f1 || a.f2 !== b.f2 || a.id !== b.id) return false;
            sampleTile(x, y, z + TILE_PZ, TILE_PX, TILE_PY, TILE_PZ, b);
            if (a.f1 !== b.f1 || a.f2 !== b.f2 || a.id !== b.id) return false;
        }
    }
    return true;
}

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

    // --- C2 laws: exact tile periodicity, bake == per-query, combo algebra -----

    // BREAK_FLOATWRAP control: run the periodicity law against a kernel that hashes
    // the UNWRAPPED cell (the 0006 float-coord anti-pattern). It must NOT be periodic;
    // if it is, the law is blind. Either outcome exits non-zero (mirrors T5's
    // shared-seed env control).
    if (BREAK_FLOATWRAP) {
        const bad = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const brokenSample = (x, y, P, Q, o) => tileHashRawCell(bad._seed, bad._jitter, P, Q, x, y, o);
        if (exactPeriodicityHolds(brokenSample)) {
            die('T0 float-wrap control: a raw-cell-hash tiling kernel was STILL exactly periodic -- the law is blind');
        }
        die('T0 float-wrap control tripped as designed (a raw-cell hash is not periodic) -- exiting non-zero');
    }

    // (h) exact periodicity, all three metrics -- bit-identical across a +period
    // shift (0006 Decision 2). This is `===`, not approximate.
    for (const [name, id] of [['euclid', METRIC_EUCLIDEAN], ['manhat', METRIC_MANHATTAN], ['cheby', METRIC_CHEBYSHEV]]) {
        const inst = createCellular(1337, { metric: id, jitter: 1 });
        const sample = (x, y, P, Q, o) => inst.tileableCell2(x, y, P, Q, o);
        assertHot(exactPeriodicityHolds(sample),
            () => `T0.periodicity[${name}]: tileableCell2 not bit-identical across a +period shift`);
    }

    // (i) bake == per-query, plain and tiling, each combo, bit-for-bit (0005). The
    // bake writes exactly what the trusted per-query surface returns at the same
    // world coord (accumulated identically, `px += scale`).
    {
        const inst = createCellular(2024, { metric: METRIC_MANHATTAN, jitter: 1 });
        const w = 12, h = 9;
        const dst = new Float64Array(w * h);
        const o = { f1: 0, f2: 0, id: 0 };
        const combos = [['f1', 0], ['f2-f1', 1], ['cracks', 1], ['f2', 2]];
        for (const [combo, selv] of combos) {
            inst.fillCellField2(dst, w, h, { combo, scale: 0.05, ox: 0.3, oy: -0.2 });
            let idx = 0, py = -0.2;
            for (let yy = 0; yy < h; yy++) {
                let px = 0.3;
                for (let xx = 0; xx < w; xx++) {
                    inst.cellular2(px, py, o);
                    const exp = selv === 0 ? o.f1 : selv === 1 ? o.f2 - o.f1 : o.f2;
                    assertHot(dst[idx++] === exp,
                        () => `T0.bake-plain[${combo}]: pixel (${xx},${yy}) != per-query cellular2`);
                    px += 0.05;
                }
                py += 0.05;
            }
        }
        const P = 4, Q = 4;
        for (const [combo, selv] of combos) {
            inst.fillCellField2(dst, w, h, { combo, scale: 0.05, ox: 0, oy: 0, periodX: P, periodY: Q });
            let idx = 0, py = 0;
            for (let yy = 0; yy < h; yy++) {
                let px = 0;
                for (let xx = 0; xx < w; xx++) {
                    inst.tileableCell2(px, py, P, Q, o);
                    const exp = selv === 0 ? o.f1 : selv === 1 ? o.f2 - o.f1 : o.f2;
                    assertHot(dst[idx++] === exp,
                        () => `T0.bake-tiling[${combo}]: pixel (${xx},${yy}) != per-query tileableCell2`);
                    px += 0.05;
                }
                py += 0.05;
            }
        }
    }

    // (j) combo algebra: the f2-f1 field equals the f2 field minus the f1 field
    // pixel-wise, and cracks aliases f2-f1 (0005 Decision 2), all bit-for-bit.
    {
        const inst = createCellular(7, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const w = 16, h = 16, n = w * h;
        const f1 = new Float64Array(n), f2 = new Float64Array(n), d = new Float64Array(n), cr = new Float64Array(n);
        inst.fillCellField2(f1, w, h, { combo: 'f1' });
        inst.fillCellField2(f2, w, h, { combo: 'f2' });
        inst.fillCellField2(d, w, h, { combo: 'f2-f1' });
        inst.fillCellField2(cr, w, h, { combo: 'cracks' });
        for (let i = 0; i < n; i++) {
            assertHot(d[i] === f2[i] - f1[i],
                () => `T0.combo-algebra: (f2-f1) field != f2 - f1 at pixel ${i}`);
            assertHot(cr[i] === d[i],
                () => `T0.combo-algebra: cracks alias != f2-f1 at pixel ${i}`);
        }
    }

    // --- C3 laws: the 3D lift (0007). 2D lanes above are untouched. -----------
    run3D(prng);

    // (g) golden -- the committed euclidean / manhattan / chebyshev digests all
    // re-derive from source. Euclidean must stay 33a16e9e (byte-unchanged refactor).
    for (const metric of METRICS) {
        const committed = JSON.parse(readFileSync(join(HERE, '../../goldens/' + metric.name + '.json'), 'utf8'));
        const gcell = createCellular(GOLD_SEED, { metric: metric.id, jitter: GOLD_JITTER });
        const got = digest(gcell, COORDS);
        assertHot(got === committed.digest,
            () => `T0.golden[${metric.name}]: digest ${got} != committed ${committed.digest} -- breaking kernel change`);
    }

    // (g3) 3D golden -- the committed euclidean3 / manhattan3 / chebyshev3 digests all
    // re-derive bit-for-bit from source.
    for (const metric of METRICS3) {
        const committed = JSON.parse(readFileSync(join(HERE, '../../goldens/' + metric.name + '.json'), 'utf8'));
        const gcell = createCellular(GOLD_SEED, { metric: metric.id, jitter: GOLD_JITTER });
        const got = digest3(gcell, COORDS3);
        assertHot(got === committed.digest,
            () => `T0.golden3[${metric.name}]: digest ${got} != committed ${committed.digest} -- breaking 3D kernel change`);
    }
}

/**
 * The 3D metamorphic laws (0007), a verbatim lift of the 2D laws above to the 27-cell
 * neighbourhood: determinism, range, metric-sanity (cheby <= euclid <= manhattan in
 * R^3 for f1 AND f2), jitter=0 grid distance to the nearest 3D cell centre, id constant
 * within a 3D cell, and exact tile periodicity on all three axes (with its
 * BREAK_FLOATWRAP3 control).
 */
function run3D(prng) {
    const euclid = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const manhat = createCellular(SEED | 0, { metric: METRIC_MANHATTAN, jitter: 1 });
    const cheby = createCellular(SEED | 0, { metric: METRIC_CHEBYSHEV, jitter: 1 });
    const e0 = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 0 });
    const m0 = createCellular(SEED | 0, { metric: METRIC_MANHATTAN, jitter: 0 });
    const c0 = createCellular(SEED | 0, { metric: METRIC_CHEBYSHEV, jitter: 0 });

    const re = { f1: 0, f2: 0, id: 0 };
    const rm = { f1: 0, f2: 0, id: 0 };
    const rc = { f1: 0, f2: 0, id: 0 };
    const b = { f1: 0, f2: 0, id: 0 };

    const N3 = 2048;
    for (let i = 0; i < N3; i++) {
        const x = ((prng() % 100000) / 97) - 512;
        const y = ((prng() % 100000) / 89) - 512;
        const z = ((prng() % 100000) / 83) - 512;

        euclid.cellular3(x, y, z, re);
        manhat.cellular3(x, y, z, rm);
        cheby.cellular3(x, y, z, rc);

        // (a) determinism.
        euclid.cellular3(x, y, z, b);
        assertHot(re.f1 === b.f1 && re.f2 === b.f2 && re.id === b.id,
            () => `T0.3D.determinism[euclid]: (${x},${y},${z}) differs on repeat (seed=${SEED})`);
        manhat.cellular3(x, y, z, b);
        assertHot(rm.f1 === b.f1 && rm.f2 === b.f2 && rm.id === b.id,
            () => `T0.3D.determinism[manhat]: (${x},${y},${z}) differs on repeat (seed=${SEED})`);
        cheby.cellular3(x, y, z, b);
        assertHot(rc.f1 === b.f1 && rc.f2 === b.f2 && rc.id === b.id,
            () => `T0.3D.determinism[cheby]: (${x},${y},${z}) differs on repeat (seed=${SEED})`);

        // (b) range, per metric.
        assertHot(re.f1 >= 0 && re.f2 >= 0 && Number.isFinite(re.f1) && Number.isFinite(re.f2) && re.f1 <= re.f2,
            () => `T0.3D.range[euclid]: f1=${re.f1} f2=${re.f2} at (${x},${y},${z}) (seed=${SEED})`);
        assertHot(rm.f1 >= 0 && rm.f2 >= 0 && Number.isFinite(rm.f1) && Number.isFinite(rm.f2) && rm.f1 <= rm.f2,
            () => `T0.3D.range[manhat]: f1=${rm.f1} f2=${rm.f2} at (${x},${y},${z}) (seed=${SEED})`);
        assertHot(rc.f1 >= 0 && rc.f2 >= 0 && Number.isFinite(rc.f1) && Number.isFinite(rc.f2) && rc.f1 <= rc.f2,
            () => `T0.3D.range[cheby]: f1=${rc.f1} f2=${rc.f2} at (${x},${y},${z}) (seed=${SEED})`);

        // (c) metric-sanity: cheby <= euclid <= manhattan in R^3, for f1 AND f2.
        assertHot(rc.f1 <= re.f1 + EPS && re.f1 <= rm.f1 + EPS,
            () => `T0.3D.sanity.f1: cheby=${rc.f1} euclid=${re.f1} manhat=${rm.f1} at (${x},${y},${z}) (seed=${SEED})`);
        assertHot(rc.f2 <= re.f2 + EPS && re.f2 <= rm.f2 + EPS,
            () => `T0.3D.sanity.f2: cheby=${rc.f2} euclid=${re.f2} manhat=${rm.f2} at (${x},${y},${z}) (seed=${SEED})`);

        // (d) jitter=0 grid distance to the nearest 3D cell centre, per metric.
        const cxc = Math.round(x - 0.5) + 0.5;
        const cyc = Math.round(y - 0.5) + 0.5;
        const czc = Math.round(z - 0.5) + 0.5;
        const ax = Math.abs(cxc - x), ay = Math.abs(cyc - y), az = Math.abs(czc - z);
        e0.cellular3(x, y, z, b);
        assertHot(Math.abs(b.f1 - Math.sqrt(ax * ax + ay * ay + az * az)) <= EPS,
            () => `T0.3D.grid[euclid]: f1=${b.f1} != L2 nearest-centre at (${x},${y},${z}) (seed=${SEED})`);
        m0.cellular3(x, y, z, b);
        assertHot(Math.abs(b.f1 - (ax + ay + az)) <= EPS,
            () => `T0.3D.grid[manhat]: f1=${b.f1} != L1 nearest-centre at (${x},${y},${z}) (seed=${SEED})`);
        c0.cellular3(x, y, z, b);
        assertHot(Math.abs(b.f1 - Math.max(ax, ay, az)) <= EPS,
            () => `T0.3D.grid[cheby]: f1=${b.f1} != Linf nearest-centre at (${x},${y},${z}) (seed=${SEED})`);
    }

    // (e) id-within-cell (jitter=0), per metric: interior points of one 3D grid cell
    // share an id; distinct cells carry (with overwhelming probability) distinct ids.
    for (const [name, inst] of [['euclid', e0], ['manhat', m0], ['cheby', c0]]) {
        const ids = [];
        for (let cz = -1; cz <= 1; cz++) {
            for (let cy = -1; cy <= 1; cy++) {
                for (let cx = -1; cx <= 1; cx++) {
                    let cellId = 0, first = true;
                    for (let sz = 0.25; sz <= 0.75; sz += 0.25) {
                        for (let sy = 0.25; sy <= 0.75; sy += 0.25) {
                            for (let sx = 0.25; sx <= 0.75; sx += 0.25) {
                                inst.cellular3(cx + sx, cy + sy, cz + sz, b);
                                if (first) { cellId = b.id; first = false; }
                                else assertHot(b.id === cellId,
                                    () => `T0.3D.id[${name}]: cell (${cx},${cy},${cz}) id changed inside its interior (seed=${SEED})`);
                            }
                        }
                    }
                    ids.push(cellId);
                }
            }
        }
        let distinct = 0;
        for (let i = 0; i < ids.length; i++) {
            let seenBefore = false;
            for (let j = 0; j < i; j++) if (ids[j] === ids[i]) { seenBefore = true; break; }
            if (!seenBefore) distinct++;
        }
        assertHot(distinct > 1,
            () => `T0.3D.id[${name}]: all ${ids.length} sampled cells share one id -- ids not per-cell (seed=${SEED})`);
    }

    // BREAK_FLOATWRAP3 control: the 3D periodicity law against a kernel that hashes the
    // UNWRAPPED cell (the 0006 anti-pattern in R^3). It must NOT be periodic; either
    // outcome exits non-zero.
    if (BREAK_FLOATWRAP3) {
        const bad = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const brokenSample = (x, y, z, P, Q, R, o) => tileHashRawCell3(bad._seed, bad._jitter, P, Q, R, x, y, z, o);
        if (exactPeriodicity3Holds(brokenSample)) {
            die('T0 3D float-wrap control: a raw-cell-hash 3D tiling kernel was STILL exactly periodic -- the law is blind');
        }
        die('T0 3D float-wrap control tripped as designed (a raw-cell hash is not periodic) -- exiting non-zero');
    }

    // (h) exact 3D periodicity, all three metrics -- bit-identical across a +period
    // shift on all three axes (0006 lifted to R^3).
    for (const [name, id] of [['euclid', METRIC_EUCLIDEAN], ['manhat', METRIC_MANHATTAN], ['cheby', METRIC_CHEBYSHEV]]) {
        const inst = createCellular(1337, { metric: id, jitter: 1 });
        const sample = (x, y, z, P, Q, R, o) => inst.tileableCell3(x, y, z, P, Q, R, o);
        assertHot(exactPeriodicity3Holds(sample),
            () => `T0.3D.periodicity[${name}]: tileableCell3 not bit-identical across a +period shift`);
    }

    // (i) 3D bake == per-query, plain and tiling, each combo, bit-for-bit (0005/0007).
    {
        const inst = createCellular(2024, { metric: METRIC_MANHATTAN, jitter: 1 });
        const w = 6, h = 5, d = 4;
        const dst = new Float64Array(w * h * d);
        const o = { f1: 0, f2: 0, id: 0 };
        const combos = [['f1', 0], ['f2-f1', 1], ['cracks', 1], ['f2', 2]];
        for (const [combo, selv] of combos) {
            inst.fillCellField3(dst, w, h, d, { combo, scale: 0.05, ox: 0.3, oy: -0.2, oz: 0.5 });
            let idx = 0, pz = 0.5;
            for (let zz = 0; zz < d; zz++) {
                let py = -0.2;
                for (let yy = 0; yy < h; yy++) {
                    let px = 0.3;
                    for (let xx = 0; xx < w; xx++) {
                        inst.cellular3(px, py, pz, o);
                        const exp = selv === 0 ? o.f1 : selv === 1 ? o.f2 - o.f1 : o.f2;
                        assertHot(dst[idx++] === exp,
                            () => `T0.3D.bake-plain[${combo}]: voxel (${xx},${yy},${zz}) != per-query cellular3`);
                        px += 0.05;
                    }
                    py += 0.05;
                }
                pz += 0.05;
            }
        }
        const P = 4, Q = 4, R = 4;
        for (const [combo, selv] of combos) {
            inst.fillCellField3(dst, w, h, d, { combo, scale: 0.05, periodX: P, periodY: Q, periodZ: R });
            let idx = 0, pz = 0;
            for (let zz = 0; zz < d; zz++) {
                let py = 0;
                for (let yy = 0; yy < h; yy++) {
                    let px = 0;
                    for (let xx = 0; xx < w; xx++) {
                        inst.tileableCell3(px, py, pz, P, Q, R, o);
                        const exp = selv === 0 ? o.f1 : selv === 1 ? o.f2 - o.f1 : o.f2;
                        assertHot(dst[idx++] === exp,
                            () => `T0.3D.bake-tiling[${combo}]: voxel (${xx},${yy},${zz}) != per-query tileableCell3`);
                        px += 0.05;
                    }
                    py += 0.05;
                }
                pz += 0.05;
            }
        }
    }
}
