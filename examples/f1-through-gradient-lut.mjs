/**
 * Recipe: paint a cellular F1 field through a @zakkster/lite-gradient-studio LUT.
 *
 * Bake `combo:'f1'` (the blob / distance-to-nearest-cell field) raw, find ONE global
 * lo/span across the whole field, then map every pixel through a gradient LUT
 * (`bakeGradientToLut` -> `sampleLut`) into a packed RGBA-LE Uint32Array. This reuses
 * lite-noise's 1.5.2 `tileable-to-gradient` pattern: a single global normalization so
 * the colour map is a pure per-cell function of the field, and the LUT is baked ONCE
 * and sampled per pixel -- zero allocation in the paint loop.
 *
 * The returned `texture` is ImageData-ready:
 *     new ImageData(new Uint8ClampedArray(texture.buffer), w, h);
 *
 * "In-gamut" here means: every sampled `t` stayed in [0,1] (the global lo/span
 * guarantees it) and every pixel is a fully-opaque RGBA-LE word.
 *
 * Peers: @zakkster/lite-gradient-studio (devDependency, examples only).
 *
 * @license MIT
 */

import { createCellular } from '../Cellular.js';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';

/**
 * @param {{ w?:number, h?:number, seed?:number, scale?:number, lutRes?:number, gradient?:object }} [opts]
 * @returns {{ w:number, h:number, field:Float64Array, texture:Uint32Array, lo:number, span:number }}
 */
export function paintF1(opts = {}) {
    const w = opts.w ?? 128, h = opts.h ?? 128;
    const seed = opts.seed ?? 42;
    const scale = opts.scale ?? 0.05;
    const lutRes = opts.lutRes ?? 256;
    const gradient = opts.gradient ?? gradientOcean;

    const cell = createCellular(seed, { jitter: 1 });
    const field = new Float64Array(w * h);
    cell.fillCellField2(field, w, h, { combo: 'f1', scale });   // raw f1 -- one global range below

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;

    const lut = bakeGradientToLut(gradient, lutRes);
    const texture = new Uint32Array(w * h);
    for (let i = 0; i < field.length; i++) texture[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;

    return { w, h, field, texture, lo, span };
}

// CLI smoke run: `node examples/f1-through-gradient-lut.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const { w, h, texture } = paintF1();
    let opaque = 0;
    for (let i = 0; i < texture.length; i++) if (((texture[i] >>> 24) & 255) === 255) opaque++;
    process.stdout.write(`f1-through-gradient-lut: ${w}x${h} painted through gradientOcean; ${opaque}/${texture.length} pixels opaque\n`);
}
