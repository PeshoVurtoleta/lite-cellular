/**
 * T-ORACLE (C4) -- the brute-force sufficiency proof (0008).
 *
 * The one property no per-session tier proves directly: that the shipped kernel's
 * fixed neighbourhood contains the TRUE nearest and second-nearest feature point for
 * each metric. C4's oracle uncovered that the original radius-1 (3x3 / 3x3x3) scan was
 * NOT sufficient for euclidean/manhattan (an L1/L2 unit-cell ball reaches a feature two
 * cells away); 0008 widened those eight kernels to radius 2 (5x5 / 5x5x5) and kept
 * chebyshev at radius 1 (L-inf is exact at the adjacent cell). This tier PROVES the
 * widened kernel is now exact.
 *
 * Method: an independent brute-force block scan at RADIUS 3 (7x7 / 7x7x7) -- strictly
 * wider than any shipped kernel -- using the VERBATIM hashes + the same
 * `cell + 0.5 + jitter*(u-0.5)` placement + the same f1/f2/id scan-order update. Since
 * radius 2 == radius 3 == radius 4 (independently confirmed), the radius-3 scan is
 * ground truth. The shipped kernel (`cellular2/3`, `tileableCell2/3`, and per-pixel bake
 * samples) must equal it BIT-FOR-BIT ({f1,f2,id}) over 100k+ mixed ops, all metrics,
 * jitter swept across [0,1]. Zero divergences.
 *
 * The tightest sufficiency case is pinned explicitly: at coords where the true nearest
 * feature sits OUTSIDE the 3x3, the shipped (radius-2) kernel equals the radius-3 oracle
 * AND a radius-1 scan does NOT -- so the widening is load-bearing exactly there.
 *
 * On divergence: prints TORTURE_SEED + op index + metric + a minimal replay.
 * CELLULAR_TORTURE_BREAK_ORACLE=1 runs a corrupted home-cell-only oracle (broken.mjs
 * `oracleCorrupt2`) that MUST diverge from the real kernel -- proof the comparison
 * asserts. A gate that cannot fail is decorative.
 *
 * @license MIT
 */

import {
    createCellular,
    METRIC_EUCLIDEAN,
    METRIC_MANHATTAN,
    METRIC_CHEBYSHEV,
} from '../../Cellular.js';
import { makePrng, SEED, die, BREAK_ORACLE, BREAK_PRECISION } from './harness.mjs';
import { oracleCorrupt2 } from './broken.mjs';

const _UINT32 = 4294967296;
const ORACLE_R = 3;   // radius 3 (7x7 / 7x7x7): strictly wider than the shipped radius 2.

// Verbatim copies of Cellular.js private hashes -- the oracle must hash IDENTICALLY to
// the kernel so the ONLY difference under test is the scan radius.
function _hash2(cx, cy, seed) {
    let h = seed | 0;
    h = (h + Math.imul(cx | 0, 0x27d4eb2f)) | 0;
    h = (h + Math.imul(cy | 0, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return (h ^ (h >>> 14)) >>> 0;
}
function _hash2b(cx, cy, seed) {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = (h + Math.imul(cx | 0, 0x85ebca6b)) | 0;
    h = (h + Math.imul(cy | 0, 0xc2b2ae35)) | 0;
    h = Math.imul(h ^ (h >>> 13), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 9), h | 63);
    return (h ^ (h >>> 16)) >>> 0;
}
function _hash3(cx, cy, cz, seed) {
    let h = seed | 0;
    h = (h + Math.imul(cx | 0, 0x27d4eb2f)) | 0;
    h = (h + Math.imul(cy | 0, 0x165667b1)) | 0;
    h = (h + Math.imul(cz | 0, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return (h ^ (h >>> 14)) >>> 0;
}
function _hash3b(cx, cy, cz, seed) {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = (h + Math.imul(cx | 0, 0x85ebca6b)) | 0;
    h = (h + Math.imul(cy | 0, 0xc2b2ae35)) | 0;
    h = (h + Math.imul(cz | 0, 0x27d4eb2f)) | 0;
    h = Math.imul(h ^ (h >>> 13), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 9), h | 63);
    return (h ^ (h >>> 16)) >>> 0;
}
function _hash3c(cx, cy, cz, seed) {
    let h = (seed ^ 0x85ebca6b) | 0;
    h = (h + Math.imul(cx | 0, 0xc2b2ae35)) | 0;
    h = (h + Math.imul(cy | 0, 0x9e3779b1)) | 0;
    h = (h + Math.imul(cz | 0, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 14), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 11), h | 59);
    return (h ^ (h >>> 15)) >>> 0;
}
function _wrap(c, P) { return ((c % P) + P) % P; }

// The four brute oracles: same placement + scan-order + f1/f2/id update as the shipped
// kernels, but over the RADIUS-3 block. euclid accumulates squared distance and sqrts
// at the end (identical to the kernel); manhattan/chebyshev accumulate linear.
function oracle2(metric, seed, jitter, x, y, out) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -ORACLE_R; gy <= ORACLE_R; gy++) {
        for (let gx = -ORACLE_R; gx <= ORACLE_R; gx++) {
            const cx = ix + gx, cy = iy + gy;
            const h = _hash2(cx, cy, seed);
            const u = h / _UINT32;
            const v = _hash2b(cx, cy, seed) / _UINT32;
            const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
            const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
            const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy)
                    : metric === METRIC_CHEBYSHEV ? Math.max(Math.abs(dx), Math.abs(dy))
                    : dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}
function oracleTile2(metric, seed, jitter, periodX, periodY, x, y, out) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const rx = x - ix, ry = y - iy;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -ORACLE_R; gy <= ORACLE_R; gy++) {
        for (let gx = -ORACLE_R; gx <= ORACLE_R; gx++) {
            const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY);
            const h = _hash2(wx, wy, seed);
            const u = h / _UINT32;
            const v = _hash2b(wx, wy, seed) / _UINT32;
            const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
            const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
            const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy)
                    : metric === METRIC_CHEBYSHEV ? Math.max(Math.abs(dx), Math.abs(dy))
                    : dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}
function oracle3(metric, seed, jitter, x, y, z, out) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -ORACLE_R; gz <= ORACLE_R; gz++) {
        for (let gy = -ORACLE_R; gy <= ORACLE_R; gy++) {
            for (let gx = -ORACLE_R; gx <= ORACLE_R; gx++) {
                const cx = ix + gx, cy = iy + gy, cz = iz + gz;
                const h = _hash3(cx, cy, cz, seed);
                const u = h / _UINT32;
                const v = _hash3b(cx, cy, cz, seed) / _UINT32;
                const w = _hash3c(cx, cy, cz, seed) / _UINT32;
                const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
                const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
                const dz = (cz + 0.5 + jitter * (w - 0.5)) - z;
                const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
                        : metric === METRIC_CHEBYSHEV ? Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
                        : dx * dx + dy * dy + dz * dz;
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}
function oracleTile3(metric, seed, jitter, periodX, periodY, periodZ, x, y, z, out) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = x - ix, ry = y - iy, rz = z - iz;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -ORACLE_R; gz <= ORACLE_R; gz++) {
        for (let gy = -ORACLE_R; gy <= ORACLE_R; gy++) {
            for (let gx = -ORACLE_R; gx <= ORACLE_R; gx++) {
                const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY), wz = _wrap(iz + gz, periodZ);
                const h = _hash3(wx, wy, wz, seed);
                const u = h / _UINT32;
                const v = _hash3b(wx, wy, wz, seed) / _UINT32;
                const w = _hash3c(wx, wy, wz, seed) / _UINT32;
                const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
                const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
                const dz = (gz + 0.5 + jitter * (w - 0.5)) - rz;
                const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
                        : metric === METRIC_CHEBYSHEV ? Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
                        : dx * dx + dy * dy + dz * dz;
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}

const METRICS = [
    ['euclid', METRIC_EUCLIDEAN],
    ['manhat', METRIC_MANHATTAN],
    ['cheby', METRIC_CHEBYSHEV],
];
const JITTERS = [0, 0.25, 0.5, 0.75, 1];   // swept across [0,1]; 1 is the tightest.
const PX = 8, PY = 8, PZ = 8;              // tile periods for the tiling lanes.

function fail(where, mname, i, x, y, z, k, o) {
    die('T-ORACLE ' + where + '[' + mname + '] DIVERGENCE at op ' + i +
        ' coord=(' + x + ',' + y + (z === undefined ? '' : ',' + z) + ')' +
        ' kernel={f1:' + k.f1 + ',f2:' + k.f2 + ',id:' + k.id + '}' +
        ' oracle={f1:' + o.f1 + ',f2:' + o.f2 + ',id:' + o.id + '}' +
        ' -- replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs');
}

export function run() {
    // Pre-build one instance per (metric, jitter) so the compare loop allocates nothing.
    const inst = [];   // inst[m][j]
    for (let m = 0; m < METRICS.length; m++) {
        inst[m] = [];
        for (let j = 0; j < JITTERS.length; j++) {
            inst[m][j] = createCellular(1337, { metric: METRICS[m][1], jitter: JITTERS[j] });
        }
    }
    const k = { f1: 0, f2: 0, id: 0 };
    const o = { f1: 0, f2: 0, id: 0 };

    // BREAK_PRECISION -- the proof-of-proof of SUFFICIENCY. Swap in the NARROWED,
    // pre-0008 radius-1 (3x3) euclid/manhattan scan and run it through the radius-3
    // oracle. It MUST diverge: if a 3x3 kernel passed this oracle, the oracle would not
    // be testing sufficiency at all. Either outcome exits non-zero. This is the exact
    // regression that would fire if someone reverted the widening.
    if (BREAK_PRECISION) {
        const prng = makePrng(SEED ^ 0x33330);
        let sawDivergence = false;
        for (let i = 0; i < 200000 && !sawDivergence; i++) {
            const x = ((prng() % 4000000) / 997) - 2000;
            const y = ((prng() % 4000000) / 991) - 2000;
            radius1_2(METRIC_EUCLIDEAN, 1337, 1, x, y, k);
            oracle2(METRIC_EUCLIDEAN, 1337, 1, x, y, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) { sawDivergence = true; break; }
            radius1_2(METRIC_MANHATTAN, 1337, 1, x, y, k);
            oracle2(METRIC_MANHATTAN, 1337, 1, x, y, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) { sawDivergence = true; break; }
        }
        if (!sawDivergence) {
            die('T-ORACLE precision control: a radius-1 (3x3) euclid/manhattan kernel did NOT diverge ' +
                'from the radius-3 oracle over 200k ops -- the oracle is NOT testing sufficiency');
        }
        die('T-ORACLE precision control tripped as designed (a narrowed 3x3 kernel fails the sufficiency oracle) -- exiting non-zero');
    }

    // BREAK_ORACLE control: a home-cell-only corrupt oracle MUST diverge from the real
    // kernel. If it agrees, the comparison is vacuous. Either outcome exits non-zero.
    if (BREAK_ORACLE) {
        const bad = createCellular(1337, { metric: METRIC_EUCLIDEAN, jitter: 1 });
        const prng = makePrng(SEED ^ 0xc0de);
        let sawDivergence = false;
        for (let i = 0; i < 20000 && !sawDivergence; i++) {
            const x = ((prng() % 4000000) / 997) - 2000, y = ((prng() % 4000000) / 991) - 2000;
            bad.cellular2(x, y, k);
            oracleCorrupt2(METRIC_EUCLIDEAN, bad._seed, bad._jitter, x, y, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) sawDivergence = true;
        }
        if (!sawDivergence) {
            die('T-ORACLE break control: the corrupt home-cell-only oracle AGREED with the real kernel -- the comparison is blind');
        }
        die('T-ORACLE break control tripped as designed (corrupt oracle diverges) -- exiting non-zero');
    }

    let ops = 0;
    const prng = makePrng(SEED ^ 0x0adc1e);

    // --- 2D lanes: cellular2 + tileableCell2, all metrics x all jitters ---------
    const N2 = 30000;
    for (let i = 0; i < N2; i++) {
        const x = ((prng() % 4000000) / 997) - 2000;
        const y = ((prng() % 4000000) / 991) - 2000;
        const j = i % JITTERS.length, jit = JITTERS[j];
        for (let m = 0; m < METRICS.length; m++) {
            const [mname, mid] = METRICS[m];
            const c = inst[m][j];
            c.cellular2(x, y, k);
            oracle2(mid, 1337, jit, x, y, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) fail('cellular2', mname, i, x, y, undefined, k, o);
            // tiling: local-frame + integer-cell wrap.
            c.tileableCell2(x, y, PX, PY, k);
            oracleTile2(mid, 1337, jit, PX, PY, x, y, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) fail('tileableCell2', mname, i, x, y, undefined, k, o);
            ops += 2;
        }
    }

    // --- 3D lanes: cellular3 + tileableCell3, all metrics x all jitters ----------
    const N3 = 8000;
    for (let i = 0; i < N3; i++) {
        const x = ((prng() % 200000) / 97) - 1000;
        const y = ((prng() % 200000) / 89) - 1000;
        const z = ((prng() % 200000) / 83) - 1000;
        const j = i % JITTERS.length, jit = JITTERS[j];
        for (let m = 0; m < METRICS.length; m++) {
            const [mname, mid] = METRICS[m];
            const c = inst[m][j];
            c.cellular3(x, y, z, k);
            oracle3(mid, 1337, jit, x, y, z, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) fail('cellular3', mname, i, x, y, z, k, o);
            c.tileableCell3(x, y, z, PX, PY, PZ, k);
            oracleTile3(mid, 1337, jit, PX, PY, PZ, x, y, z, o);
            if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) fail('tileableCell3', mname, i, x, y, z, k, o);
            ops += 2;
        }
    }

    // --- bake samples: per-pixel bake output == oracle combo, bit-for-bit ---------
    // A bake calls the shipped kernel per pixel; sampling its scalar and comparing to
    // the oracle's combo closes the loop on the bake path too (0005 + 0008).
    {
        const combos = [['f1', 0], ['f2-f1', 1], ['f2', 2]];
        const BW = 20, BH = 16;
        const dst = new Float64Array(BW * BH);
        for (let m = 0; m < METRICS.length; m++) {
            const [mname, mid] = METRICS[m];
            const c = inst[m][JITTERS.length - 1];   // jitter = 1
            const ox = 3.5, oy = -2.5, scale = 0.05;
            for (const [combo, sel] of combos) {
                c.fillCellField2(dst, BW, BH, { combo, scale, ox, oy });
                let idx = 0, py = oy;
                for (let yy = 0; yy < BH; yy++) {
                    let px = ox;
                    for (let xx = 0; xx < BW; xx++) {
                        oracle2(mid, 1337, 1, px, py, o);
                        const want = sel === 0 ? o.f1 : sel === 1 ? o.f2 - o.f1 : o.f2;
                        if (dst[idx++] !== want) {
                            die('T-ORACLE bake[' + mname + '/' + combo + '] pixel (' + xx + ',' + yy + ') = ' +
                                dst[idx - 1] + ' != oracle ' + want + ' -- replay: TORTURE_SEED=' + SEED);
                        }
                        px += scale;
                        ops++;
                    }
                    py += scale;
                }
            }
        }
    }

    // --- the tightest sufficiency case: pinned coords where the TRUE nearest feature
    // sits OUTSIDE the 3x3. The shipped (radius-2) kernel MUST equal the radius-3 oracle
    // AND a radius-1 scan must NOT -- so the widening is load-bearing exactly here. These
    // are seed-42, jitter-1 coords captured by the C4 brute-force sweep (0008). One per
    // (metric, dim). This is the jitter=1 far-corner/near-corner sufficiency stressor.
    tightestCase();

    if (ops < 100000) {
        die('T-ORACLE: only ' + ops + ' ops compared -- below the 100000 sufficiency floor');
    }
}

function radius1_2(metric, seed, jitter, x, y, out) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -1; gy <= 1; gy++) {
        for (let gx = -1; gx <= 1; gx++) {
            const cx = ix + gx, cy = iy + gy;
            const h = _hash2(cx, cy, seed);
            const u = h / _UINT32;
            const v = _hash2b(cx, cy, seed) / _UINT32;
            const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
            const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
            const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy) : dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}
function radius1_3(metric, seed, jitter, x, y, z, out) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -1; gz <= 1; gz++) {
        for (let gy = -1; gy <= 1; gy++) {
            for (let gx = -1; gx <= 1; gx++) {
                const cx = ix + gx, cy = iy + gy, cz = iz + gz;
                const h = _hash3(cx, cy, cz, seed);
                const u = h / _UINT32;
                const v = _hash3b(cx, cy, cz, seed) / _UINT32;
                const w = _hash3c(cx, cy, cz, seed) / _UINT32;
                const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
                const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
                const dz = (cz + 0.5 + jitter * (w - 0.5)) - z;
                const d = metric === METRIC_MANHATTAN ? Math.abs(dx) + Math.abs(dy) + Math.abs(dz) : dx * dx + dy * dy + dz * dz;
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    if (metric === METRIC_EUCLIDEAN) { f1 = Math.sqrt(f1); f2 = Math.sqrt(f2); }
    out.f1 = f1; out.f2 = f2; out.id = id; return out;
}

function tightestCase() {
    const k = { f1: 0, f2: 0, id: 0 };
    const o = { f1: 0, f2: 0, id: 0 };
    const r1 = { f1: 0, f2: 0, id: 0 };
    // Seed 42, jitter 1. Captured by the 0008 brute sweep: the true nearest feature is
    // two cells away, so radius-1 misses it and radius-2 (shipped) catches it.
    const CASES2 = [
        ['euclid', METRIC_EUCLIDEAN, -205.88064192577735, 828.0060544904138],
        ['manhat', METRIC_MANHATTAN, -364.9919759277833, 488.80827447023216],
    ];
    for (const [mname, mid, x, y] of CASES2) {
        const c = createCellular(42, { metric: mid, jitter: 1 });
        c.cellular2(x, y, k);
        oracle2(mid, 42, 1, x, y, o);
        radius1_2(mid, 42, 1, x, y, r1);
        if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) {
            die('T-ORACLE tightest[' + mname + ' 2D]: shipped kernel != radius-3 oracle at the pinned divergent coord (widening incomplete)');
        }
        if (k.f1 === r1.f1 && k.id === r1.id) {
            die('T-ORACLE tightest[' + mname + ' 2D]: shipped kernel == radius-1 scan -- the widening is NOT load-bearing here (regression: reverted to 3x3?)');
        }
    }
    const CASES3 = [
        ['euclid', METRIC_EUCLIDEAN, -392.8969072164948, 727.0224719101125, -289.92771084337346],
        ['manhat', METRIC_MANHATTAN, 984.1340206185566, 139.6179775280898, -69.60240963855426],
    ];
    for (const [mname, mid, x, y, z] of CASES3) {
        const c = createCellular(42, { metric: mid, jitter: 1 });
        c.cellular3(x, y, z, k);
        oracle3(mid, 42, 1, x, y, z, o);
        radius1_3(mid, 42, 1, x, y, z, r1);
        if (k.f1 !== o.f1 || k.f2 !== o.f2 || k.id !== o.id) {
            die('T-ORACLE tightest[' + mname + ' 3D]: shipped kernel != radius-3 oracle at the pinned divergent coord (widening incomplete)');
        }
        if (k.f1 === r1.f1 && k.id === r1.id) {
            die('T-ORACLE tightest[' + mname + ' 3D]: shipped kernel == radius-1 scan -- the widening is NOT load-bearing here (regression: reverted to 27-cell?)');
        }
    }
}
