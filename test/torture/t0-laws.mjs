/**
 * T0 -- metamorphic laws for the euclidean kernel, over a seeded corpus:
 *
 *   (a) determinism  -- cellular2 twice at the same coord is bit-for-bit equal.
 *   (b) range        -- f1 <= f2, both finite and >= 0.
 *   (c) jitter=0 grid -- f1 equals the distance to the nearest cell CENTRE,
 *                        computed independently (D-03: jitter=0 is a grid).
 *   (d) id-within-cell -- with jitter=0 the Voronoi region IS the grid cell, so
 *                        every interior point of a cell shares one id (D-04), and
 *                        distinct cells carry distinct ids.
 *   (e) golden       -- the committed euclidean digest re-derives bit-for-bit.
 *
 * Each law is written to FAIL if the feature it names broke -- not merely to
 * exercise the call.
 *
 * @license MIT
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCellular, METRIC_EUCLIDEAN } from '../../Cellular.js';
import { makePrng, SEED, assertHot } from './harness.mjs';
import { COORDS, SEED as GOLD_SEED, JITTER as GOLD_JITTER, digest } from '../../goldens/gen.mjs';

const N = 4096;         // corpus size
const HERE = dirname(fileURLToPath(import.meta.url));

export function run() {
    const prng = makePrng(SEED);
    const cell = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const jitter0 = createCellular(SEED | 0, { metric: METRIC_EUCLIDEAN, jitter: 0 });

    const a = { f1: 0, f2: 0, id: 0 };
    const b = { f1: 0, f2: 0, id: 0 };

    for (let i = 0; i < N; i++) {
        // Coords straddling zero, spanning ~ +/-512 with sub-cell fractions.
        const x = ((prng() % 100000) / 97) - 512;
        const y = ((prng() % 100000) / 89) - 512;

        // (a) determinism -- same seed+coord, bit-for-bit.
        cell.cellular2(x, y, a);
        cell.cellular2(x, y, b);
        assertHot(a.f1 === b.f1 && a.f2 === b.f2 && a.id === b.id,
            () => `T0.determinism: (${x},${y}) differs on repeat (seed=${SEED})`);

        // (b) range.
        assertHot(a.f1 >= 0 && a.f2 >= 0 && Number.isFinite(a.f1) && Number.isFinite(a.f2)
            && a.f1 <= a.f2,
            () => `T0.range: f1=${a.f1} f2=${a.f2} at (${x},${y}) (seed=${SEED})`);

        // (c) jitter=0 -> f1 is the distance to the nearest cell centre. Centres
        // sit at (integer+0.5); the nearest one is separable per axis.
        jitter0.cellular2(x, y, a);
        const cxc = Math.round(x - 0.5) + 0.5;
        const cyc = Math.round(y - 0.5) + 0.5;
        const expected = Math.sqrt((cxc - x) * (cxc - x) + (cyc - y) * (cyc - y));
        assertHot(Math.abs(a.f1 - expected) <= 1e-9,
            () => `T0.grid: jitter=0 f1=${a.f1} != nearest-centre ${expected} at (${x},${y}) (seed=${SEED})`);
    }

    // (d) id-within-cell (jitter=0). Interior points of one grid cell share an id;
    // distinct cells carry (with overwhelming probability) distinct ids.
    const ids = [];
    for (let cy = -2; cy <= 2; cy++) {
        for (let cx = -2; cx <= 2; cx++) {
            let cellId = 0;
            let first = true;
            // Sample the interior on a fine grid, away from the boundary.
            for (let sy = 0.15; sy <= 0.85; sy += 0.1) {
                for (let sx = 0.15; sx <= 0.85; sx += 0.1) {
                    jitter0.cellular2(cx + sx, cy + sy, a);
                    if (first) { cellId = a.id; first = false; }
                    else assertHot(a.id === cellId,
                        () => `T0.id: cell (${cx},${cy}) id changed inside its interior (seed=${SEED})`);
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
    assertHot(distinct > 1, () => `T0.id: all ${ids.length} sampled cells share one id -- ids not per-cell (seed=${SEED})`);

    // (e) golden -- the committed euclidean digest re-derives from source.
    const committed = JSON.parse(readFileSync(join(HERE, '../../goldens/euclidean.json'), 'utf8'));
    const gcell = createCellular(GOLD_SEED, { metric: METRIC_EUCLIDEAN, jitter: GOLD_JITTER });
    const got = digest(gcell, COORDS);
    assertHot(got === committed.digest,
        () => `T0.golden: euclidean digest ${got} != committed ${committed.digest} -- breaking kernel change`);
}
