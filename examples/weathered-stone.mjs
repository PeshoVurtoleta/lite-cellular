/**
 * Recipe: weathered stone -- cellular cracks multiplied into a gradient-noise fbm.
 *
 * `fillCellField2` with `combo:'f2-f1'` bakes the Voronoi WALL field (the crack
 * network -- near zero along cell edges, large in cell interiors). Normalized to
 * [0,1] it is a mask: ~0 on the mortar lines, ~1 in the stone faces. Multiply it
 * pixel-wise into a `@zakkster/lite-noise` `fillField2` fbm heightfield and the
 * cracks DARKEN the height where they run -- weathered, mortared stone.
 *
 * Both fields are the same size, baked into caller-owned Float64Arrays; the combine
 * loop writes one product per pixel into a third owned buffer with ZERO allocation
 * in the loop. The two noise libraries never meet inside a file -- they compose here,
 * at the app layer, on buffers the app owns (the sibling relationship, exactly).
 *
 * Peers: @zakkster/lite-noise (devDependency, examples only).
 *
 * @license MIT
 */

import { createCellular } from '../Cellular.js';
import { createNoise } from '@zakkster/lite-noise';

/**
 * @param {{ w?:number, h?:number, seed?:number, scale?:number }} [opts]
 * @returns {{ w:number, h:number, cracks:Float64Array, fbm:Float64Array, stone:Float64Array }}
 */
export function weatheredStone(opts = {}) {
    const w = opts.w ?? 128, h = opts.h ?? 128;
    const seed = opts.seed ?? 1337;
    const scale = opts.scale ?? 0.05;

    const cell = createCellular(seed, { jitter: 1 });
    const noise = createNoise(seed ^ 0x9e3779b9);

    const cracks = new Float64Array(w * h);   // f2-f1 mask, normalized: ~0 on walls
    const fbm = new Float64Array(w * h);       // fbm heightfield, normalized [0,1]
    const stone = new Float64Array(w * h);

    cell.fillCellField2(cracks, w, h, { combo: 'f2-f1', scale, normalize: true });
    noise.fillField2(fbm, w, h, { scale: scale * 0.6, octaves: 5, normalize: true });

    // Zero-alloc combine: the crack mask attenuates the height. Where cracks are
    // near zero (Voronoi walls) the stone darkens; where near one, the fbm shows.
    for (let i = 0; i < stone.length; i++) stone[i] = fbm[i] * cracks[i];

    return { w, h, cracks, fbm, stone };
}

// CLI smoke run: `node examples/weathered-stone.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const { w, h, cracks, fbm, stone } = weatheredStone();
    let darkened = 0;
    for (let i = 0; i < stone.length; i++) if (cracks[i] < 0.1 && stone[i] < fbm[i]) darkened++;
    process.stdout.write(
        `weathered-stone: ${w}x${h} stone = fbm x cracks; ${darkened} wall pixels darkened below the raw fbm\n`);
}
