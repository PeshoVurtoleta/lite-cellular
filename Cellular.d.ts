/**
 * @zakkster/lite-cellular v1.1.0 -- hand-written types (no drift).
 *
 * v1.0.0 (C1) opens the three distance metrics (euclidean/manhattan/chebyshev),
 * fixed at instance creation via an integer id, and adds the module free-function
 * surface (`cellular2`, `seedCellular`). v1.1.0 (C2) adds the two instance methods
 * `fillCellField2` (zero-alloc field bake, combo resolved once -- decisions/0005) and
 * `tileableCell2` (exact integer-cell wrap -- decisions/0006). `cellular3` in C3.
 *
 * @license MIT
 */

/** Package version. Kept in lockstep with package.json (two-place sync). */
export const VERSION: string;

/**
 * The euclidean (L2) metric id -- the default. Returns TRUE distance (squared in
 * the loop, one sqrt each for f1/f2 at the end). See `decisions/0001`.
 */
export const METRIC_EUCLIDEAN: 0;

/**
 * The manhattan (L1) metric id: distance = `|dx| + |dy|`, no sqrt. Linear units,
 * so the cross-metric law and `f2 - f1` stay coherent. See `decisions/0001`.
 */
export const METRIC_MANHATTAN: 1;

/**
 * The chebyshev (Linf) metric id: distance = `max(|dx|, |dy|)`, no sqrt. Linear
 * units. Satisfies `chebyshev <= euclidean <= manhattan` pointwise. See
 * `decisions/0001`.
 */
export const METRIC_CHEBYSHEV: 2;

/** The per-query result: the two nearest feature-point distances and the F1 owner id. */
export interface CellularResult {
    /** Distance to the nearest feature point, in this instance's metric. */
    f1: number;
    /** Distance to the second-nearest feature point, same metric; f1 <= f2. */
    f2: number;
    /**
     * The F1 owner cell's hash, signed int32 (SMI-safe, `| 0` not `>>> 0`).
     * Opaque, stable per Voronoi region; the owner is metric-dependent. See
     * `decisions/0004`.
     */
    id: number;
}

/**
 * Options for `fillCellField2` (all optional, guarded so the omitted-opts path
 * allocates nothing). See `decisions/0005` and `decisions/0006`.
 */
export interface FillCellFieldOptions {
    /** Coord step per pixel (`px += scale`). Default `0.01`. */
    scale?: number;
    /**
     * Which texture to store: `'f1'` (blobs), `'f2-f1'` (cracks, alias `'cracks'`),
     * or `'f2'` (soft cells). Default `'f1'`. Decoded to a small-int selector ONCE
     * before the loop; an unknown value throws (`decisions/0005`).
     */
    combo?: 'f1' | 'f2-f1' | 'cracks' | 'f2';
    /** Override the instance jitter for this bake. Default the instance's jitter. */
    jitter?: number;
    /** World-space origin x. Default `0`. */
    ox?: number;
    /** World-space origin y. Default `0`. */
    oy?: number;
    /**
     * Opt-in in-place remap to `[0,1]` (two-pass min/max, no temp buffer; a constant
     * field maps to all-zero). Default `false`.
     */
    normalize?: boolean;
    /**
     * Set BOTH (positive integers) to bake a seamless tile of this many cells (the
     * `decisions/0006` integer-cell wrap in the bake loop -- pick `scale = periodX/w`).
     * Omit both for a plain field. A partial or invalid period throws.
     */
    periodX?: number;
    periodY?: number;
}

/** Construction options. metric and jitter are fixed at creation and immutable. */
export interface CellularOptions {
    /**
     * Distance metric id: 0 (euclidean, default), 1 (manhattan), or 2 (chebyshev).
     * Anything else throws at construction (fail-closed). See `decisions/0001`.
     */
    metric?: number;
    /**
     * Feature-point scatter in [0, 1]: 0 = exact grid of centres, 1 = full Worley.
     * `jitter <= 1` is the correctness precondition of the 3x3 scan (keeps every
     * feature point inside its home cell). Default 1. See `decisions/0003`.
     */
    jitter?: number;
}

/**
 * A cellular (Worley) noise field owning one reused out-struct. Construct via
 * `createCellular`. The metric and jitter are immutable for the instance's life.
 */
export declare class Cellular {
    constructor(seed?: number, opts?: CellularOptions);

    /**
     * Sample the field at (x, y). Writes into `out` if given (and returns it),
     * otherwise returns the instance's reused out-struct. Zero allocation.
     * Throws on non-finite `x` or `y`.
     */
    cellular2(x: number, y: number, out?: CellularResult): CellularResult;

    /**
     * Sample the EXACTLY-TILEABLE field at (x, y) with a tile of `periodX` x
     * `periodY` CELLS: `cellular2` with each neighbour's integer cell coordinate
     * reduced mod the period, so the field is bit-identically periodic and seamless
     * by construction. `periodX`/`periodY` are REQUIRED positive integers (`0`,
     * negatives, non-integers, `NaN`, `Infinity` throw -- fail closed). Writes into
     * `out` if given (and returns it), else the reused struct. Zero allocation.
     * Throws on non-finite `x` or `y`. See `decisions/0006`.
     */
    tileableCell2(x: number, y: number, periodX: number, periodY: number, out?: CellularResult): CellularResult;

    /**
     * Bake a `w` x `h` cellular field into a caller-owned typed array `dst`
     * (Float64Array or Float32Array, length `>= w*h`), row-major, allocation-free,
     * returning `dst`. `combo` is decoded to a small-int selector ONCE before the
     * loop; the metric is the instance's, bound once. With `opts.periodX`/`periodY`
     * set the bake is a seamless tile (`decisions/0006`); without, a plain field.
     * Fail closed: non-positive-integer `w`/`h`, an undersized or non-typed-array
     * `dst`, and an unknown `combo` each throw. See `decisions/0005`.
     */
    fillCellField2<T extends Float64Array | Float32Array>(
        dst: T, w: number, h: number, opts?: FillCellFieldOptions): T;

    /** Re-seed this instance in place. Returns `this`. Setup cost only. */
    reseed(seed: number): this;
}

/** Create an independent cellular noise instance. Throws on a bad metric id or jitter. */
export declare function createCellular(seed?: number, opts?: CellularOptions): Cellular;

/**
 * Module free surface: sample the shared module field at (x, y). Deliberately
 * EUCLIDEAN with jitter = 1 on the shared module seed -- the zero-config
 * convenience. Metric and jitter control require an instance (`createCellular`).
 * Writes into `out` if given (and returns it), else the shared module out-struct.
 * Zero allocation. Throws on non-finite `x` or `y`. See `decisions/0003`.
 */
export declare function cellular2(x: number, y: number, out?: CellularResult): CellularResult;

/**
 * Re-seed the shared module field. Setup cost only. Auto-seeded with 0 on load.
 * Mutates one shared module-scoped seed -- every module-level consumer sees the
 * change (the last caller wins). Warns once in dev builds when called more than
 * once; silent when `NODE_ENV === 'production'`. For independent fields, give each
 * its own `createCellular(seed)`. See `decisions/0003`.
 */
export declare function seedCellular(seed?: number): void;
