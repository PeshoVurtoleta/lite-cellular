/**
 * @zakkster/lite-cellular -- CI assertions for the composability recipes in
 * `examples/`. Each example exports a pure function; here we run it headless and
 * assert the claim it demonstrates. `examples/` stays OUT of package.json files[]
 * (like test/) -- it ships nothing, it proves the ecosystem wiring in CI.
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatheredStone } from '../examples/weathered-stone.mjs';
import { paintF1 } from '../examples/f1-through-gradient-lut.mjs';
import { seamlessTile, SEAM_THRESHOLD } from '../examples/seamless-tile.mjs';

test('example weathered-stone: same size, finite product, cracks darken the fbm near zero', () => {
    const { w, h, cracks, fbm, stone } = weatheredStone({ w: 96, h: 96 });
    assert.equal(cracks.length, w * h);
    assert.equal(fbm.length, w * h);
    assert.equal(stone.length, w * h);
    let darkened = 0;
    for (let i = 0; i < stone.length; i++) {
        assert.ok(Number.isFinite(stone[i]), 'product finite at ' + i);
        // cracks in [0,1], fbm in [0,1] -> product never brightens the height.
        assert.ok(stone[i] <= fbm[i] + 1e-12, 'crack mask never brightens at ' + i);
        if (cracks[i] < 0.1 && stone[i] < fbm[i]) darkened++;
    }
    assert.ok(darkened > 0, 'the crack network darkens the fbm somewhere (walls present)');
});

test('example f1-through-gradient-lut: every pixel is in-gamut (t in [0,1], opaque)', () => {
    const { w, h, field, texture, lo, span } = paintF1({ w: 96, h: 96 });
    assert.equal(texture.length, w * h);
    for (let i = 0; i < field.length; i++) {
        const t = (field[i] - lo) / span;
        assert.ok(t >= 0 && t <= 1, 't in [0,1] at ' + i + ' (t=' + t + ')');
        assert.equal((texture[i] >>> 24) & 255, 255, 'opaque alpha at ' + i);
    }
    // Non-degenerate: the field maps to more than one colour.
    let distinct = false;
    for (let i = 1; i < texture.length; i++) if (texture[i] !== texture[0]) { distinct = true; break; }
    assert.ok(distinct, 'the LUT paints a varying texture, not a flat fill');
});

test('example seamless-tile: seamlessScore below the committed threshold', () => {
    const { score } = seamlessTile({ w: 256, h: 256, period: 4 });
    assert.ok(score.overall < SEAM_THRESHOLD,
        `seamlessScore overall ${score.overall} not below ${SEAM_THRESHOLD}`);
});
