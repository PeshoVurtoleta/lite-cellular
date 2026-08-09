/**
 * Recipe: a genuinely-seamless cellular tile, proven by @zakkster/lite-patternforge.
 *
 * A tiling `fillCellField2` bake (periodX/periodY set, `scale = period / w` so the w
 * columns span exactly `period` cells) wraps by the EXACT integer-cell modulo (0006):
 * the seam step equals a normal interior step, so the tile is seamless BY
 * CONSTRUCTION, not to float epsilon. Colour it through a gradient LUT and score the
 * RGBA texture with `seamlessScore`: the number reads near-zero (imperceptible),
 * strictly below `SEAM_THRESHOLD`.
 *
 * Peers: @zakkster/lite-patternforge + @zakkster/lite-gradient-studio (devDeps,
 * examples only).
 *
 * @license MIT
 */

import { createCellular } from '../Cellular.js';
import { seamlessScore } from '@zakkster/lite-patternforge';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';

/** Committed seam ceiling: patternforge's "imperceptible" band (< 0.02). */
export const SEAM_THRESHOLD = 0.02;

/**
 * @param {{ w?:number, h?:number, period?:number, seed?:number, lutRes?:number }} [opts]
 * @returns {{ w:number, h:number, period:number, field:Float64Array, texture:Uint32Array,
 *            score:{ horizontal:number, vertical:number, overall:number } }}
 */
export function seamlessTile(opts = {}) {
    const w = opts.w ?? 256, h = opts.h ?? 256;
    const period = opts.period ?? 4;
    const seed = opts.seed ?? 42;
    const lutRes = opts.lutRes ?? 256;

    const cell = createCellular(seed, { jitter: 1 });
    const field = new Float64Array(w * h);
    cell.fillCellField2(field, w, h, { combo: 'f1', scale: period / w, periodX: period, periodY: period });

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;

    const lut = bakeGradientToLut(gradientOcean, lutRes);
    const texture = new Uint32Array(w * h);
    for (let i = 0; i < field.length; i++) texture[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;

    const score = seamlessScore(texture, w, h);
    return { w, h, period, field, texture, score };
}

// CLI smoke run: `node examples/seamless-tile.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const { w, h, period, score } = seamlessTile();
    process.stdout.write(
        `seamless-tile: ${w}x${h} period-${period} cellular tile seamlessScore overall=${score.overall.toFixed(5)} ` +
        `(threshold ${SEAM_THRESHOLD})\n`);
}
