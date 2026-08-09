/**
 * @zakkster/lite-cellular -- bundle & dependency ceiling (C1).
 *
 * Cellular.js is a single, zero-runtime-dependency ESM file. This pins three
 * facts so drift is caught as a diff, not discovered in a consumer's bundle:
 *
 *   - it imports/requires NOTHING (no runtime dependency, not even node built-ins);
 *   - it is one file (the whole public surface is exported from Cellular.js);
 *   - its byte length is <= CELLULAR_BYTE_CEILING, a committed constant. Growing
 *     past the ceiling is an INTENTIONAL bump with a CHANGELOG note, never silent.
 *
 *     node --expose-gc --test test/*.test.js
 *
 * @license MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../Cellular.js');

/**
 * Committed byte ceiling for Cellular.js. Current size ~15.5 KB; the ceiling
 * leaves headroom for doc-comment upkeep but bites long before the file could
 * quietly grow a second concern. Raising it is a deliberate act + a CHANGELOG note.
 */
const CELLULAR_BYTE_CEILING = 17408;

test('bundle: Cellular.js externalises nothing (zero import/require of a dependency)', () => {
    const src = readFileSync(SRC, 'utf8');
    // No bare/relative import statements and no require() calls at all. The module
    // is fully self-contained -- the query path must never reach for a dependency.
    const importRe = /^\s*import\s.+\sfrom\s+['"][^'"]+['"]/m;
    const requireRe = /\brequire\s*\(/;
    assert.equal(importRe.test(src), false, 'Cellular.js must not import from any module');
    assert.equal(requireRe.test(src), false, 'Cellular.js must not require() anything');
});

test('bundle: Cellular.js byte length is within the committed ceiling', () => {
    const bytes = readFileSync(SRC).length;
    assert.ok(bytes <= CELLULAR_BYTE_CEILING,
        `Cellular.js is ${bytes} B, over the ${CELLULAR_BYTE_CEILING} B ceiling -- ` +
        'an intentional bump needs a CHANGELOG note and a new ceiling');
});

test('bundle: Cellular.js is ASCII-only (U+00D7 and U+00B5 excepted)', () => {
    const src = readFileSync(SRC, 'utf8');
    for (let i = 0; i < src.length; i++) {
        const code = src.charCodeAt(i);
        if (code > 0x7f && code !== 0x00d7 && code !== 0x00b5) {
            assert.fail('non-ASCII char U+' + code.toString(16).padStart(4, '0') + ' at index ' + i);
        }
    }
});
