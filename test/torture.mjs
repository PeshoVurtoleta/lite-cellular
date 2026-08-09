/**
 * @zakkster/lite-cellular -- torture gate.
 *
 * The DONE-WHEN of every session is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints exactly "ok", exit 0
 *     npm run torture
 *
 * C1 fills the reserved tiers and widens the rest to three metrics + the module
 * surface:
 *
 *     T0  metamorphic laws (metric-sanity, per-metric grid, id laws, 3 goldens)
 *     T1  degenerate values   -- across all three metrics
 *     T3  world-scale precision walk (per metric, pinned limit)
 *     T5  NS-01 isolation fuzz -- the headline
 *     T6  the zero-alloc gate  -- 3 metrics + module, whole-window + transient lane
 *     T7  dropped-instance retention (lite-leak), all three metrics
 *     T9  controls (must be able to fail)
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY
 * SEQUENTIALLY -- never nested, never concurrent. Tiers may be async (T7/T9 need
 * a settle tick for FinalizationRegistry), so each is awaited in turn.
 *
 * Break controls (each must exit non-zero):
 *   - `CELLULAR_TORTURE_BREAK=1` injects a retained createCellular() + Float64Array
 *     into the T6 hot loop -- the whole-window alloc gate must reject it.
 *   - `CELLULAR_TORTURE_SHARED_SEED=1` runs a shared-seed build through T5's
 *     isolation law, which must trip. A gate that cannot fail is decorative.
 *
 * Peers (lite-gc-profiler, lite-leak) are devDependencies only. Cellular.js has
 * zero runtime dependencies.
 *
 * @license MIT
 */

import { SEED, BREAK } from './torture/harness.mjs';
import { run as t0 } from './torture/t0-laws.mjs';
import { run as t1 } from './torture/t1-degenerate.mjs';
import { run as t3 } from './torture/t3-worldscale.mjs';
import { run as t5, SHARED_SEED_BREAK } from './torture/t5-fuzz.mjs';
import { run as t6 } from './torture/t6-alloc.mjs';
import { run as t7 } from './torture/t7-leak.mjs';
import { run as t9 } from './torture/t9-controls.mjs';

const TIERS = [
    ['T0 laws', t0],
    ['T1 degenerate', t1],
    ['T3 world-scale', t3],
    ['T5 fuzz', t5],
    ['T6 alloc', t6],
    ['T7 leak', t7],
    ['T9 controls', t9],
];

async function main() {
    if (typeof globalThis.gc !== 'function') {
        process.stderr.write(
            'torture: FAIL -- run with --expose-gc:  node --expose-gc test/torture.mjs\n');
        process.exit(1);
    }

    for (const [name, run] of TIERS) {
        try {
            await run();
        } catch (err) {
            // Tiers normally fail via die() (which exits). A thrown error is an
            // unexpected fault -- surface it with the replay seed and stop.
            process.stderr.write(
                'torture: FAIL -- ' + name + ' threw: ' + (err && err.stack || err) +
                '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
            process.exit(1);
        }
    }

    // Reaching here in BREAK mode means T6's control did not trip -- a fault.
    if (BREAK) {
        process.stderr.write('torture: FAIL -- CELLULAR_TORTURE_BREAK set but the gate still passed\n');
        process.exit(1);
    }

    process.stdout.write('ok\n');
    process.exit(0);
}

// Any escape -- a tier that rejected without die(), an unhandled throw in an async
// tier, a bug in main() itself -- must exit NON-ZERO. A gate that prints FAIL (or
// fails silently) while exiting 0 is decorative; fail closed on every path.
main().catch((err) => {
    process.stderr.write('torture: FAIL -- uncaught: ' + (err && err.stack || err) + '\n');
    process.exit(1);
});
