/**
 * Deliberately-broken C2 variants -- the positive controls for the new gates. Each
 * is the exact anti-pattern a decision forbids, written so the corresponding gate
 * MUST reject it. Imported by T0/T6 (env break modes) and T9 (every plain run
 * asserts the gate bites). A gate that cannot fail is decorative.
 *
 *   - `bakeAllocating`   : 0005 anti-pattern -- a fresh per-pixel out-struct, RETAINED
 *                          (pushed to a sink so it escapes and survives collection),
 *                          so the T6 zero-retention gate reads bytes > 0.
 *   - `bakeComboParse`   : 0005 anti-pattern -- a per-pixel combo STRING parse
 *                          (`combo.split('-')`), the array retained, same gate bites.
 *   - `tileHashRawCell`  : 0006 anti-pattern -- distance taken in the wrapped/local
 *                          frame but the HASH keyed on the UNWRAPPED integer cell
 *                          (i.e. the wrap put on the float coord, not the cell), so
 *                          the field is NOT periodic: `tile(x)` != `tile(x+period)`.
 *                          Breaks the T0 exact-periodicity law. Carries its own copy
 *                          of the hash (Cellular.js keeps it private) so the control
 *                          is otherwise identical to the real euclidean kernel.
 *   - `cellular3Allocating`: 0007/0005 anti-pattern -- a `cellular3` query that
 *                          allocates a RETAINED per-call out-struct, so the T6 3D
 *                          zero-retention gate reads bytes > 0.
 *   - `tileHashRawCell3` : the 3D `tileHashRawCell` -- the 0006 anti-pattern in R^3,
 *                          breaking the T0 3D exact-periodicity law.
 *
 * @license MIT
 */

const _UINT32 = 4294967296;

// Verbatim copies of Cellular.js `_hash2` / `_hash2b` (private there). The control
// must hash identically to the real kernel so ONLY the anti-pattern differs.
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

// Verbatim copies of Cellular.js `_hash3` / `_hash3b` / `_hash3c` (private there), so
// the 3D control hashes identically to the real 3D kernel and ONLY the anti-pattern
// differs.
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

/**
 * 0005 anti-pattern: allocate a fresh out-struct per pixel and RETAIN it. Same shape
 * as the real bake otherwise. `sink` holds every struct so the collector cannot free
 * them -- the zero-retention gate must read bytes > 0.
 */
export function bakeAllocating(inst, dst, w, h, opts, sink) {
    const scale = opts?.scale ?? 0.01;
    const ox = opts?.ox ?? 0, oy = opts?.oy ?? 0;
    let idx = 0, py = oy;
    for (let y = 0; y < h; y++) {
        let px = ox;
        for (let x = 0; x < w; x++) {
            const o = { f1: 0, f2: 0, id: 0 };   // fresh per-pixel object (forbidden)
            inst.cellular2(px, py, o);
            sink.push(o);                          // retained -> escapes, survives GC
            dst[idx++] = o.f1;
            px += scale;
        }
        py += scale;
    }
    return dst;
}

/**
 * 0005 anti-pattern: re-parse the combo STRING per pixel (allocating an array) and
 * retain the parse. The real baker decodes combo to a small int ONCE before the loop.
 */
export function bakeComboParse(inst, dst, w, h, opts, sink) {
    const scale = opts?.scale ?? 0.01;
    const combo = opts?.combo ?? 'f1';
    const ox = opts?.ox ?? 0, oy = opts?.oy ?? 0;
    const o = { f1: 0, f2: 0, id: 0 };
    let idx = 0, py = oy;
    for (let y = 0; y < h; y++) {
        let px = ox;
        for (let x = 0; x < w; x++) {
            inst.cellular2(px, py, o);
            const parts = combo.split('-');        // per-pixel string parse -> array alloc
            sink.push(parts);                       // retained
            dst[idx++] = parts.length === 2 ? o.f2 - o.f1 : parts[0] === 'f2' ? o.f2 : o.f1;
            px += scale;
        }
        py += scale;
    }
    return dst;
}

/**
 * 0006 anti-pattern: wrap only the LOCAL frame (the float coord), keep the HASH on
 * the UNWRAPPED integer cell. The field is then NOT periodic -- the cell at `x` and
 * the cell at `x + periodX` hash differently -- so `tile(x)` != `tile(x + periodX)`.
 * Euclidean, jitter 1; otherwise identical to the real euclidean tiling kernel.
 */
export function tileHashRawCell(seed, jitter, periodX, periodY, x, y, out) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const rx = x - ix, ry = y - iy;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -1; gy <= 1; gy++) {
        for (let gx = -1; gx <= 1; gx++) {
            // WRONG: hash the raw (unwrapped) cell -> not periodic (0006 forbids this).
            const h = _hash2(ix + gx, iy + gy, seed);
            const u = h / _UINT32;
            const v = _hash2b(ix + gx, iy + gy, seed) / _UINT32;
            const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
            const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
            const d = dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/**
 * 0007/0005 anti-pattern in 3D: a `cellular3`-shaped query that allocates a fresh
 * out-struct per call and RETAINS it (pushed to a sink so it escapes and survives
 * collection). Same 27-cell euclidean scan as the real kernel otherwise -- the T6 3D
 * zero-retention gate must read bytes > 0. `inst` is a real Cellular instance; the
 * control just wraps its `cellular3` with a retained per-call object.
 */
export function cellular3Allocating(inst, x, y, z, sink) {
    const o = { f1: 0, f2: 0, id: 0 };   // fresh per-call object (forbidden)
    inst.cellular3(x, y, z, o);
    sink.push(o);                          // retained -> escapes, survives GC
    return o.f1;
}

/**
 * 0006 anti-pattern in R^3: wrap only the LOCAL frame (the float coord), keep the
 * HASH on the UNWRAPPED integer cell. The volume is then NOT periodic -- the cell at
 * `x` and the cell at `x + periodX` hash differently -- so `tile(x)` != `tile(x+P)`.
 * Euclidean, jitter 1; otherwise identical to the real euclidean 3D tiling kernel.
 */
export function tileHashRawCell3(seed, jitter, periodX, periodY, periodZ, x, y, z, out) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = x - ix, ry = y - iy, rz = z - iz;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -1; gz <= 1; gz++) {
        for (let gy = -1; gy <= 1; gy++) {
            for (let gx = -1; gx <= 1; gx++) {
                // WRONG: hash the raw (unwrapped) cell -> not periodic (0006 forbids this).
                const h = _hash3(ix + gx, iy + gy, iz + gz, seed);
                const u = h / _UINT32;
                const v = _hash3b(ix + gx, iy + gy, iz + gz, seed) / _UINT32;
                const w = _hash3c(ix + gx, iy + gy, iz + gz, seed) / _UINT32;
                const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
                const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
                const dz = (gz + 0.5 + jitter * (w - 0.5)) - rz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}
