/**
 * T8 -- the seamlessScore proof (the D-06 headline).
 *
 * Bake a TILING cellular field, colour it through a gradient LUT into an RGBA-LE
 * texture, and run `@zakkster/lite-patternforge` `seamlessScore` on it. The exact
 * integer-cell wrap (0006) makes the seam step equal to a normal interior step, so
 * the score reads GENUINELY near-zero -- and MATERIALLY BELOW a `@zakkster/lite-noise`
 * `tileableField2` gradient tile scored the same way in the same test (whose local
 * seam contrast keeps it off the floor). Both are baked at the same resolution and
 * coloured through the same LUT + global normalization, so the number is a fair
 * side-by-side. The contrast is a documented, tested claim -- not marketing.
 *
 * `seamlessScore` returns { horizontal, vertical, overall } in [0, 1], lower better
 * (< 0.02 imperceptible). This tier asserts the cellular tile is imperceptible AND
 * strictly below the gradient tile.
 *
 * Peers used here (lite-noise, lite-patternforge, lite-gradient-studio) are
 * devDependencies only; Cellular.js keeps zero runtime dependencies.
 *
 * @license MIT
 */

import { createCellular, METRIC_EUCLIDEAN } from '../../Cellular.js';
import { createNoise } from '@zakkster/lite-noise';
import { seamlessScore } from '@zakkster/lite-patternforge';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';
import { assertHot } from './harness.mjs';

const W = 256, H = 256, P = 4;

/** Pinned near-zero ceiling for the cellular tile (patternforge's imperceptible band). */
export const CELL_SEAM_CEIL = 0.02;

/** Colour a raw scalar field through one global lo/span into an RGBA-LE Uint32Array. */
function paint(field, lut) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;
    const tex = new Uint32Array(field.length);
    for (let i = 0; i < field.length; i++) tex[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;
    return tex;
}

export function run() {
    const lut = bakeGradientToLut(gradientOcean, 256);

    // The cellular tiling bake: scale = P/W so the W columns span exactly P cells and
    // the field wraps by the exact integer-cell modulo (0006).
    const cell = createCellular(42, { metric: METRIC_EUCLIDEAN, jitter: 1 });
    const cf = new Float64Array(W * H);
    cell.fillCellField2(cf, W, H, { combo: 'f1', scale: P / W, periodX: P, periodY: P });
    const cellScore = seamlessScore(paint(cf, lut), W, H);

    // The gradient-noise tileable tile, baked + coloured identically.
    const noise = createNoise(42);
    const nf = new Float64Array(W * H);
    noise.tileableField2(nf, W, H, { model: 'fbm', periodX: P, periodY: P, octaves: 5 });
    const gradScore = seamlessScore(paint(nf, lut), W, H);

    assertHot(cellScore.overall < CELL_SEAM_CEIL,
        () => `T8.seam: cellular tile seamlessScore ${cellScore.overall.toFixed(5)} not near-zero (< ${CELL_SEAM_CEIL})`);
    assertHot(cellScore.overall < gradScore.overall,
        () => `T8.seam: cellular tile ${cellScore.overall.toFixed(5)} not below the gradient tile ${gradScore.overall.toFixed(5)}`);
}
