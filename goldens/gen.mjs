/**
 * Golden generator for the three cellular metrics (seed 42, jitter default 1).
 *
 * Committed and re-runnable: `node goldens/gen.mjs` regenerates
 * `goldens/euclidean.json`, `goldens/manhattan.json`, and `goldens/chebyshev.json`.
 * Regenerating is an INTENTIONAL, breaking act -- each digest pins the exact hash
 * constants, the placement convention, and that metric's distance line, so any
 * change to `_hash2`/`_hash2b` or a kernel moves it and requires a CHANGELOG note.
 *
 * The EUCLIDEAN digest is load-bearing across the C0->C1 refactor: splitting the
 * one kernel into three must leave the euclidean numerics byte-identical, so
 * `euclidean.json`'s digest MUST stay `33a16e9e`. If it moves, the refactor
 * altered euclidean numerics -- that is a bug, not a new golden.
 *
 * The unit suite and torture T0 both import { COORDS, SEED, JITTER, digest } from
 * here and re-derive each metric's digest, comparing it against the committed JSON.
 *
 * @license MIT
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
    VERSION,
} from '../Cellular.js';

/** Seed for the committed goldens. */
export const SEED = 42;

/** Jitter for the committed goldens (the default). */
export const JITTER = 1;

/**
 * The fixed query corpus: 64 coords spanning cell interiors, exact cell
 * boundaries (integer coords), sub-cell fractions, and negatives straddling the
 * origin. Committed here so every digest is reproducible from source alone. The
 * SAME corpus is used for all three metrics.
 */
export const COORDS = [
    [0, 0], [0.5, 0.5], [1, 0], [0, 1], [1, 1], [0.25, 0.75], [0.9, 0.1], [0.5, 0],
    [2.5, 3.5], [3.14159, 2.71828], [4, 4], [5.5, 4.5], [6.1, 7.9], [7, 3], [8.5, 8.5], [9.99, 0.01],
    [-0.5, 0.5], [-1, -1], [-2.5, 3.5], [-3.14, -2.71], [-4, 4], [-5.5, -4.5], [-6.1, 7.9], [-7, -3],
    [10.5, -10.5], [-10.5, 10.5], [12.3, 45.6], [-12.3, -45.6], [100.5, 100.5], [-100.5, -100.5], [0.001, 0.001], [-0.001, -0.001],
    [16.5, 16.5], [17.25, 17.75], [18, 18], [19.5, 20.5], [21.1, 22.2], [23.3, 24.4], [25.5, 26.6], [27.7, 28.8],
    [30.5, -30.5], [-30.5, 30.5], [31.4159, 27.1828], [-31.4159, -27.1828], [42, 42], [42.5, 42.5], [43.21, 43.21], [44.44, 44.44],
    [0.5, 63.5], [63.5, 0.5], [50.25, 50.75], [-50.25, -50.75], [55.5, -55.5], [-55.5, 55.5], [60.1, 60.9], [-60.1, -60.9],
    [7.5, 7.5], [13.5, 13.5], [99.5, 99.5], [-99.5, -99.5], [1000.5, 1000.5], [-1000.5, -1000.5], [123.456, 789.012], [-123.456, -789.012],
];

/** The three committed metrics, keyed by output filename. */
export const METRICS = [
    { name: 'euclidean', id: METRIC_EUCLIDEAN },
    { name: 'manhattan', id: METRIC_MANHATTAN },
    { name: 'chebyshev', id: METRIC_CHEBYSHEV },
];

// Reused scratch for the FNV byte serialisation (this is a build script, not a
// hot path, but keep it single-buffer anyway).
const _buf = new ArrayBuffer(8);
const _f64 = new Float64Array(_buf);
const _i32 = new Int32Array(_buf);
const _bytes = new Uint8Array(_buf);

/**
 * FNV-1a 32-bit over the concatenated f1/f2/id byte stream of every coord.
 * f1/f2 are hashed as their raw float64 bytes; id as its int32 bytes -- so the
 * digest is exact, never a stringified rounding.
 * @param {import('../Cellular.js').Cellular} cell
 * @param {number[][]} coords
 * @returns {string} 8-hex-char digest
 */
export function digest(cell, coords) {
    let h = 0x811c9dc5;
    const out = { f1: 0, f2: 0, id: 0 };
    for (let i = 0; i < coords.length; i++) {
        cell.cellular2(coords[i][0], coords[i][1], out);
        _f64[0] = out.f1;
        for (let b = 0; b < 8; b++) { h ^= _bytes[b]; h = Math.imul(h, 0x01000193); }
        _f64[0] = out.f2;
        for (let b = 0; b < 8; b++) { h ^= _bytes[b]; h = Math.imul(h, 0x01000193); }
        _i32[0] = out.id;
        for (let b = 0; b < 4; b++) { h ^= _bytes[b]; h = Math.imul(h, 0x01000193); }
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

/** Build a golden record object for one metric (also used by the tests to compare). */
export function build(metric) {
    const cell = createCellular(SEED, { metric: metric.id, jitter: JITTER });
    return {
        note: 'Committed ' + metric.name + ' cellular golden. Regenerate ONLY intentionally: node goldens/gen.mjs. A change is breaking (CHANGELOG note required).',
        version: VERSION,
        metric: metric.name,
        metricId: metric.id,
        seed: SEED,
        jitter: JITTER,
        node: process.version,
        coordCount: COORDS.length,
        coords: COORDS,
        digest: digest(cell, COORDS),
    };
}

// Written only when run directly, never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const metric of METRICS) {
        const record = build(metric);
        const path = join(dir, metric.name + '.json');
        writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
        process.stdout.write('wrote ' + path + '  digest=' + record.digest + '\n');
    }
}
