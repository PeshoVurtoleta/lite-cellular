/**
 * @zakkster/lite-cellular v1.3.0 -- hand-written types (no drift).
 *
 * v1.0.0 (C1) opens the three distance metrics (euclidean/manhattan/chebyshev),
 * fixed at instance creation via an integer id, and adds the module free-function
 * surface (`cellular2`, `seedCellular`). v1.1.0 (C2) adds the two instance methods
 * `fillCellField2` (zero-alloc field bake, combo resolved once -- decisions/0005) and
 * `tileableCell2` (exact integer-cell wrap -- decisions/0006). v1.2.0 (C3) LIFTS the
 * whole surface into 3D -- `cellular3`, `fillCellField3`, `tileableCell3` (decisions/0007).
 * Instance-only; there is no module 3D surface and no 4D.
 *
 * v1.3.0 (C4) makes the neighbourhood EXACT (decisions/0008): chebyshev is exact in the
 * 3x3 / 3x3x3 neighbourhood, but an L1/L2 unit-cell ball can reach a feature TWO cells
 * away, so euclidean and manhattan are widened to the 5x5 / 5x5x5 neighbourhood. Each
 * metric's scan is now guaranteed to contain the true nearest and second-nearest feature
 * (jitter <= 1). No API change; euclid/manhattan cost more, chebyshev unchanged.
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
    /** Override the instance jitter for this bake. Default the instance's jitter. Bounds-validated like the constructor -- outside [0,1] (or non-finite/non-number) throws. */
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

/**
 * Options for `fillCellField3` (all optional, guarded so the omitted-opts path
 * allocates nothing). The 3D lift of `FillCellFieldOptions` (`decisions/0005`/`0007`).
 */
export interface FillCellField3Options {
    /** Coord step per voxel on every axis (`px += scale`). Default `0.01`. */
    scale?: number;
    /**
     * Which texture to store: `'f1'` (blobs), `'f2-f1'` (cracks, alias `'cracks'`),
     * or `'f2'` (soft cells). Default `'f1'`. Decoded to a small-int selector ONCE
     * before the loop; an unknown value throws (`decisions/0005`).
     */
    combo?: 'f1' | 'f2-f1' | 'cracks' | 'f2';
    /** Override the instance jitter for this bake. Default the instance's jitter. Bounds-validated like the constructor -- outside [0,1] (or non-finite/non-number) throws. */
    jitter?: number;
    /** World-space origin x. Default `0`. */
    ox?: number;
    /** World-space origin y. Default `0`. */
    oy?: number;
    /** World-space origin z. Default `0`. */
    oz?: number;
    /**
     * Opt-in in-place remap to `[0,1]` (two-pass min/max, no temp buffer; a constant
     * volume maps to all-zero). Default `false`.
     */
    normalize?: boolean;
    /**
     * Set ALL THREE (positive integers) to bake a seamless tile of this many cells
     * (the `decisions/0006` integer-cell wrap on all three axes -- pick
     * `scale = periodX/w`). Omit all for a plain volume. A partial/invalid period throws.
     */
    periodX?: number;
    periodY?: number;
    periodZ?: number;
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
     * `jitter <= 1` is the correctness precondition of the neighbourhood scan (keeps
     * every feature point inside its home cell, so the exact radius per metric --
     * chebyshev 3x3, euclid/manhattan 5x5 -- contains the true f1/f2; decisions/0003,
     * 0008). Default 1. See `decisions/0003`.
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

    /**
     * Sample the 3D field at (x, y, z): the 3D lift of `cellular2` (`decisions/0007`;
     * chebyshev scans 3x3x3 = 27 cells, euclid/manhattan 5x5x5 = 125 cells per
     * `decisions/0008`). Returns `{ f1, f2, id }` -- the 2D shape plus depth -- in
     * this instance's metric. Writes into `out` if given (and returns it), else the
     * reused struct. Zero allocation. THROWS on non-finite `x`, `y`, or `z`.
     * Instance-only: there is no module 3D surface (0007 Decision 4).
     */
    cellular3(x: number, y: number, z: number, out?: CellularResult): CellularResult;

    /**
     * Sample the EXACTLY-TILEABLE 3D field: `cellular3` with each neighbour's integer
     * cell coordinate reduced mod its period on all three axes, so the volume is
     * bit-identically periodic and seamless by construction (`decisions/0006`/`0007`).
     * `periodX`/`periodY`/`periodZ` are REQUIRED positive integers (`0`, negatives,
     * non-integers, `NaN`, `Infinity` throw). Writes into `out` if given (and returns
     * it), else the reused struct. Zero allocation. THROWS on non-finite coords.
     */
    tileableCell3(
        x: number, y: number, z: number,
        periodX: number, periodY: number, periodZ: number, out?: CellularResult): CellularResult;

    /**
     * Bake a `w` x `h` x `d` cellular VOLUME into a caller-owned typed array `dst`
     * (Float64Array or Float32Array, length `>= w*h*d`), row-major with z outermost
     * (`idx = (z*h + y)*w + x`), allocation-free, returning `dst`. The 3D lift of
     * `fillCellField2` (`decisions/0005`/`0007`): combo decoded once, metric bound
     * once. With `opts.periodX`/`periodY`/`periodZ` set the bake is a seamless tile.
     * Fail closed: non-positive-integer `w`/`h`/`d`, an undersized or non-typed-array
     * `dst`, and an unknown `combo` each throw.
     */
    fillCellField3<T extends Float64Array | Float32Array>(
        dst: T, w: number, h: number, d: number, opts?: FillCellField3Options): T;

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
