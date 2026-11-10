//! The gas step's substep loop in Rust: a line-for-line port of the loop in `gasCoreTs`
//! (src/core/gas.ts): wall contacts, mirror ghosts, the neighbour search, density, impulses and
//! energy with their retries, the elastic bounce and the drift. Every operation is the
//! TypeScript's, in the same order, so the results are the same bits (see lib.rs).
//!
//! TypeScript packs the parcels straight into the buffers here, builds the walls and rigid units
//! (`buildWalls`) and writes them in, calls `gas_step`, and finishes the step from the same buffers
//! (leaving gas, write-back, joint loads). All working arrays live here and are kept between
//! steps, so a step makes no typed arrays for the JavaScript collector.

use super::{jmax, jmin, sin_cos};
use std::f64::consts::PI;
use std::ptr::addr_of_mut;

#[link(wasm_import_module = "env")]
extern "C" {
    /// The caller's clock, ms: read only when a step is timed (it changes nothing in the results).
    fn now() -> f64;
}

// ---------- Buffer layouts (src/core/gasWasm.ts mirrors these) ----------

/// Per wall: unit (−1 if fixed), disc flag, centre, radius, box (grown by the margin), first vertex,
/// vertex count, and the box's bounding circle (centre and radius).
const WS: usize = 14;
/// Per vertex: position and the outward normal of the edge that starts there.
const VS: usize = 4;
/// Per unit: in: mass, inertia, velocity, spin, end-of-step centre, reach, whether it has several
/// parts; out: velocity and spin (in place), centre now, rotation from the end-of-step pose and its
/// cosine and sine.
const US: usize = 14;
/// Out: external impulse x, y, angular; clamped energy; wall impulse; substeps; bodies touched;
/// then ms in contacts, neighbours, density, impulses, move.
const OUT_LEN: usize = 12;

const CFL: f64 = 0.25;
const MAX_SUBSTEPS: f64 = 2000.0;
const MAX_RETRIES: usize = 20;
const MAX_TRIES: usize = 500;
const VISC_ALPHA: f64 = 1.0;
const VISC_BETA: f64 = 2.0;
const HARD_WALL: f64 = 0.5;
const W_C2: f64 = 7.0 / PI;
const G_C2: f64 = 140.0 / PI;
const BIG_WALL_CELLS: f64 = 4096.0;

#[derive(Clone, Copy, Default)]
struct Wall {
    unit: i32,
    disc: bool,
    cx: f64,
    cy: f64,
    radius: f64,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    v0: usize,
    nv: usize,
    bcx: f64,
    bcy: f64,
    br: f64,
}

#[derive(Clone, Copy, Default)]
struct Unit {
    m: f64,
    i: f64,
    cx: f64,
    cy: f64,
    vx: f64,
    vy: f64,
    w: f64,
    dvx: f64,
    dvy: f64,
    dw: f64,
    sx: f64,
    sy: f64,
    sw: f64,
    ex: f64,
    ey: f64,
    th: f64,
    qc: f64,
    qs: f64,
    reach: f64,
    multi: bool,
}

#[derive(Default)]
struct Gas {
    // Shared with JavaScript.
    x: Vec<f64>,
    y: Vec<f64>,
    vx: Vec<f64>,
    vy: Vec<f64>,
    m: Vec<f64>,
    e: Vec<f64>,
    hh: Vec<f64>,
    g1: Vec<f64>,
    gam: Vec<f64>,
    rad: Vec<f64>,
    crushed: Vec<u8>,
    walls_in: Vec<f64>,
    verts: Vec<f64>,
    units_io: Vec<f64>,
    part_j: Vec<f64>,
    touch: Vec<i32>,
    out: [f64; OUT_LEN],
    // Working arrays, kept between steps.
    walls: Vec<Wall>,
    units: Vec<Unit>,
    t_part: Vec<f64>,
    touched: Vec<u8>,
    rho: Vec<f64>,
    a: Vec<f64>,
    cs: Vec<f64>,
    h_stamp: Vec<i32>,
    h_cx: Vec<i32>,
    h_cy: Vec<i32>,
    h_head: Vec<i32>,
    h_tail: Vec<i32>,
    occ: Vec<usize>,
    p_slot: Vec<usize>,
    w_next: Vec<i32>,
    w_wall: Vec<usize>,
    big_walls: Vec<usize>,
    c_p: Vec<usize>,
    c_w: Vec<usize>,
    c_d: Vec<f64>,
    c_nx: Vec<f64>,
    c_ny: Vec<f64>,
    c_start: Vec<usize>,
    ex: Vec<f64>,
    ey: Vec<f64>,
    gvx: Vec<f64>,
    gvy: Vec<f64>,
    g_contact: Vec<usize>,
    g_contact2: Vec<i32>,
    ekey: Vec<u32>,
    sx: Vec<f64>,
    sy: Vec<f64>,
    idx: Vec<usize>,
    idx2: Vec<usize>,
    run_start: Vec<usize>,
    run_key: Vec<u32>,
    pa: Vec<usize>,
    pb: Vec<usize>,
    pr: Vec<f64>,
    ga: Vec<usize>,
    gb: Vec<usize>,
    gr: Vec<f64>,
    s_vx: Vec<f64>,
    s_vy: Vec<f64>,
    s_e: Vec<f64>,
    dvx: Vec<f64>,
    dvy: Vec<f64>,
    mvx: Vec<f64>,
    mvy: Vec<f64>,
    p_j: Vec<f64>,
    p_s: Vec<f64>,
    g_j: Vec<f64>,
    g_s: Vec<f64>,
}

static mut GAS: Option<Box<Gas>> = None;

fn gas() -> &'static mut Gas {
    // Single-threaded: one call at a time from JavaScript.
    unsafe { (*addr_of_mut!(GAS)).get_or_insert_with(Default::default) }
}

fn ensure<T: Clone + Default>(v: &mut Vec<T>, len: usize) {
    if v.len() < len {
        v.resize(len, T::default());
    }
}

/// Makes room for n parcels. May grow memory: views over it must be made again after.
#[no_mangle]
pub extern "C" fn gas_reserve_parcels(n: usize) {
    let g = gas();
    for v in [&mut g.x, &mut g.y, &mut g.vx, &mut g.vy, &mut g.m, &mut g.e, &mut g.hh, &mut g.g1, &mut g.gam, &mut g.rad] {
        ensure(v, n);
    }
    ensure(&mut g.crushed, n);
}

/// Makes room for nw walls with nv vertices in all, and nu units. May grow memory.
#[no_mangle]
pub extern "C" fn gas_reserve_walls(nw: usize, nv: usize, nu: usize) {
    let g = gas();
    ensure(&mut g.walls_in, nw * WS);
    ensure(&mut g.verts, nv * VS);
    ensure(&mut g.units_io, nu * US);
    ensure(&mut g.part_j, nw * 3);
    ensure(&mut g.touch, nw);
}

/// Where each shared buffer is: 0–9 the parcels' x, y, vx, vy, mass, thermal energy, smoothing
/// length, γ − 1, γ, radius; 10 crushed flags (bytes); 11 walls; 12 vertices; 13 units; 14 impulses
/// on each wall's body (x, y, torque); 15 the walls touched, in order (i32); 16 the out block.
#[no_mangle]
pub extern "C" fn gas_ptr(which: u32) -> *mut u8 {
    let g = gas();
    match which {
        0 => g.x.as_mut_ptr() as *mut u8,
        1 => g.y.as_mut_ptr() as *mut u8,
        2 => g.vx.as_mut_ptr() as *mut u8,
        3 => g.vy.as_mut_ptr() as *mut u8,
        4 => g.m.as_mut_ptr() as *mut u8,
        5 => g.e.as_mut_ptr() as *mut u8,
        6 => g.hh.as_mut_ptr() as *mut u8,
        7 => g.g1.as_mut_ptr() as *mut u8,
        8 => g.gam.as_mut_ptr() as *mut u8,
        9 => g.rad.as_mut_ptr() as *mut u8,
        10 => g.crushed.as_mut_ptr(),
        11 => g.walls_in.as_mut_ptr() as *mut u8,
        12 => g.verts.as_mut_ptr() as *mut u8,
        13 => g.units_io.as_mut_ptr() as *mut u8,
        14 => g.part_j.as_mut_ptr() as *mut u8,
        15 => g.touch.as_mut_ptr() as *mut u8,
        _ => g.out.as_mut_ptr() as *mut u8,
    }
}

// ---------- Helpers (the closures of gasCoreTs) ----------

#[inline]
fn clamp_cell(c: f64) -> f64 {
    if c < -32767.0 {
        -32767.0
    } else if c > 32767.0 {
        32767.0
    } else {
        c
    }
}

/// Signed distance from a point to a wall's surface (negative inside), with the outward normal.
#[inline]
fn surface(w: &Wall, verts: &[f64], px: f64, py: f64) -> (f64, f64, f64) {
    if w.disc {
        let dx = px - w.cx;
        let dy = py - w.cy;
        let l = (dx * dx + dy * dy).sqrt();
        return if l > 0.0 { (l - w.radius, dx / l, dy / l) } else { (l - w.radius, 1.0, 0.0) };
    }
    let n = w.nv;
    let v = &verts[w.v0 * VS..(w.v0 + n) * VS];
    let mut best = f64::NEG_INFINITY;
    let mut bi = 0;
    for i in 0..n {
        let o = i * VS;
        let s = v[o + 2] * (px - v[o]) + v[o + 3] * (py - v[o + 1]);
        if s > best {
            best = s;
            bi = i;
        }
    }
    if best <= 0.0 {
        return (best, v[bi * VS + 2], v[bi * VS + 3]);
    }
    // Outside: nearest point on the boundary.
    let mut best_d2 = f64::INFINITY;
    let mut cxp = 0.0;
    let mut cyp = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        let (xi, yi) = (v[i * VS], v[i * VS + 1]);
        let ex = v[j * VS] - xi;
        let ey = v[j * VS + 1] - yi;
        let t = jmax(0.0, jmin(1.0, ((px - xi) * ex + (py - yi) * ey) / (ex * ex + ey * ey)));
        let qx = xi + t * ex;
        let qy = yi + t * ey;
        let d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if d2 < best_d2 {
            best_d2 = d2;
            cxp = qx;
            cyp = qy;
        }
    }
    let d = best_d2.sqrt();
    if d > 0.0 {
        (d, (px - cxp) / d, (py - cyp) / d)
    } else {
        (d, v[bi * VS + 2], v[bi * VS + 3])
    }
}

/// The wall's velocity at (px, py).
#[inline]
fn wall_point_velocity(wall: &Wall, units: &[Unit], px: f64, py: f64) -> (f64, f64) {
    if wall.unit < 0 {
        return (0.0, 0.0);
    }
    let u = &units[wall.unit as usize];
    (u.vx - u.w * (py - u.cy), u.vy + u.w * (px - u.cx))
}

/// Adds an impulse on wall k's body, acting along a line through (px, py), to `into`.
#[inline]
fn push_part(into: &mut [f64], walls: &[Wall], units: &[Unit], k: usize, jx: f64, jy: f64, px: f64, py: f64) {
    let w = &walls[k];
    let mut bx = w.cx;
    let mut by = w.cy;
    if w.unit >= 0 {
        let u = &units[w.unit as usize];
        let dx = bx - u.ex;
        let dy = by - u.ey;
        bx = u.cx + u.qc * dx - u.qs * dy;
        by = u.cy + u.qs * dx + u.qc * dy;
    }
    into[3 * k] += jx;
    into[3 * k + 1] += jy;
    into[3 * k + 2] += (px - bx) * jy - (py - by) * jx;
}

/// Parcels i and j are on opposite faces of the same body (a thin wall between them).
#[inline]
fn separated(c_start: &[usize], c_w: &[usize], c_nx: &[f64], c_ny: &[f64], i: usize, j: usize) -> bool {
    for a in c_start[i]..c_start[i + 1] {
        for b in c_start[j]..c_start[j + 1] {
            if c_w[a] == c_w[b] && c_nx[a] * c_nx[b] + c_ny[a] * c_ny[b] < 0.0 {
                return true;
            }
        }
    }
    false
}

/// Parcel i sees the same face of the same body as wall contact c.
#[inline]
fn same_face(c_start: &[usize], c_w: &[usize], c_nx: &[f64], c_ny: &[f64], i: usize, c: usize) -> bool {
    for a in c_start[i]..c_start[i + 1] {
        if c_w[a] == c_w[c] && c_nx[a] * c_nx[c] + c_ny[a] * c_ny[c] > 0.5 {
            return true;
        }
    }
    false
}

#[inline]
fn pressure_share(ai: f64, aj: f64) -> f64 {
    if ai + aj > 0.0 {
        ai / (ai + aj)
    } else {
        0.5
    }
}

/// The slot of cell (cx, cy) in the open-addressed hash, or the free slot where it would go.
#[inline]
fn slot_of(h_stamp: &[i32], h_cx: &[i32], h_cy: &[i32], stamp: i32, h_shift: u32, h_mask: usize, cx: f64, cy: f64) -> usize {
    // Multiplicative (Fibonacci) hashing, as Math.imul and >>> give it.
    let mut h = (((cx as i32) ^ (cy as i32).wrapping_mul(0x85ebca77u32 as i32)).wrapping_mul(0x9e3779b1u32 as i32) as u32 >> h_shift) as usize;
    while h_stamp[h] == stamp && (h_cx[h] as f64 != cx || h_cy[h] as f64 != cy) {
        h = (h + 1) & h_mask;
    }
    h
}

/// Advances n parcels by dt among nw walls moving as nu rigid units. Reads and writes the shared
/// buffers (see `gas_ptr`).
#[no_mangle]
pub extern "C" fn gas_step(n: usize, nw: usize, nu: usize, dt: f64, timed: u32) {
    let g = gas();
    let timed = timed != 0;
    let mut t_mark = if timed { unsafe { now() } } else { 0.0 };
    let mut times = [0.0f64; 5];
    macro_rules! phase {
        ($k:expr) => {
            if timed {
                let t = unsafe { now() };
                times[$k] += t - t_mark;
                t_mark = t;
            }
        };
    }

    let Gas {
        x,
        y,
        vx,
        vy,
        m,
        e,
        hh,
        g1,
        gam,
        rad,
        crushed,
        walls_in,
        verts,
        units_io,
        part_j,
        touch,
        out,
        walls,
        units,
        t_part,
        touched,
        rho,
        a: aa,
        cs,
        h_stamp,
        h_cx,
        h_cy,
        h_head,
        h_tail,
        occ,
        p_slot,
        w_next,
        w_wall,
        big_walls,
        c_p,
        c_w,
        c_d,
        c_nx,
        c_ny,
        c_start,
        ex,
        ey,
        gvx,
        gvy,
        g_contact,
        g_contact2,
        ekey,
        sx,
        sy,
        idx,
        idx2,
        run_start,
        run_key,
        pa,
        pb,
        pr,
        ga,
        gb,
        gr,
        s_vx,
        s_vy,
        s_e,
        dvx,
        dvy,
        mvx,
        mvy,
        p_j,
        p_s,
        g_j,
        g_s,
    } = g;
    let (x, y, vx, vy, m, e) = (&mut x[..n], &mut y[..n], &mut vx[..n], &mut vy[..n], &m[..n], &mut e[..n]);
    let (hh, g1, gam, rad) = (&hh[..n], &g1[..n], &gam[..n], &rad[..n]);
    let verts: &[f64] = verts;

    // Walls and units out of their buffers.
    walls.clear();
    for k in 0..nw {
        let o = k * WS;
        let w = &walls_in[o..o + WS];
        walls.push(Wall {
            unit: w[0] as i32,
            disc: w[1] != 0.0,
            cx: w[2],
            cy: w[3],
            radius: w[4],
            min_x: w[5],
            min_y: w[6],
            max_x: w[7],
            max_y: w[8],
            v0: w[9] as usize,
            nv: w[10] as usize,
            bcx: w[11],
            bcy: w[12],
            br: w[13],
        });
    }
    units.clear();
    for k in 0..nu {
        let o = k * US;
        let u = &units_io[o..o + US];
        units.push(Unit { m: u[0], i: u[1], vx: u[2], vy: u[3], w: u[4], ex: u[5], ey: u[6], reach: u[7], multi: u[8] != 0.0, ..Unit::default() });
    }
    let walls: &[Wall] = walls;

    let mut hmax = 0.0;
    let mut hmin = f64::INFINITY;
    for i in 0..n {
        hmax = jmax(hmax, hh[i]);
        hmin = jmin(hmin, hh[i]);
    }

    let min_ds = dt / MAX_SUBSTEPS;
    // Gas impulses on each body (x, y, torque about the body's centre), for joint loads.
    let part_j = &mut part_j[..3 * nw];
    part_j.fill(0.0);
    ensure(t_part, 3 * nw);
    let t_part = &mut t_part[..3 * nw];
    t_part.fill(0.0);
    // Bodies the gas touched, each listed once, in the order they were first touched.
    ensure(touched, nw);
    touched[..nw].fill(0);
    let mut n_touch = 0;
    macro_rules! involve {
        ($k:expr) => {
            if touched[$k] == 0 {
                touched[$k] = 1;
                touch[n_touch] = $k as i32;
                n_touch += 1;
            }
        };
    }

    for v in [&mut *rho, &mut *aa, &mut *cs, &mut *s_vx, &mut *s_vy, &mut *s_e, &mut *dvx, &mut *dvy, &mut *mvx, &mut *mvy] {
        ensure(v, n);
    }
    let inv = 1.0 / hmax;
    let hmax2 = hmax * hmax;
    let mut wall_impulse = 0.0;
    let mut ext_acc_x = 0.0;
    let mut ext_acc_y = 0.0;
    let mut ext_acc_a = 0.0;
    let mut clamped = 0.0;

    // Bodies move with the gas through the step: rewind each unit from its end-of-step pose to its
    // start, then drift it with every substep.
    for u in units.iter_mut() {
        u.cx = u.ex - u.vx * dt;
        u.cy = u.ey - u.vy * dt;
        u.th = -u.w * dt;
        let (s, c) = sin_cos(u.th);
        u.qc = c;
        u.qs = s;
    }

    // Walls are filed only in cells that hold gas: an open-addressed hash of those cells (a slot is
    // in use when its stamp is this substep's), each with a list of walls in ascending order.
    let mut h_bits: u32 = 10;
    while (1usize << h_bits) < 4 * n + 4 {
        h_bits += 1;
    }
    let h_len = 1usize << h_bits;
    for v in [&mut *h_stamp, &mut *h_cx, &mut *h_cy, &mut *h_head, &mut *h_tail] {
        ensure(v, h_len);
    }
    h_stamp[..h_len].fill(0);
    let mut stamp: i32 = 0;
    let h_mask = h_len - 1;
    let h_shift = 32 - h_bits;
    ensure(occ, n);
    ensure(p_slot, n);
    ensure(c_start, n + 1);
    for i in 0..n {
        crushed[i] = 0;
    }

    let mut t_done = 0.0;
    let mut nsub = 0.0;
    // Substeps tried this step, retries included (see MAX_TRIES in gas.ts).
    let mut tries = 0;
    while t_done < dt {
        // signalSpeed
        let mut vmax = 0.0;
        for i in 0..n {
            let c = (gam[i] * g1[i] * jmax(0.0, e[i] / m[i])).sqrt();
            vmax = jmax(vmax, c + (vx[i] * vx[i] + vy[i] * vy[i]).sqrt());
        }
        for u in units.iter() {
            vmax = jmax(vmax, (u.vx * u.vx + u.vy * u.vy).sqrt() + u.w.abs() * u.reach);
        }
        let spent = tries >= MAX_TRIES;
        let mut ds = if spent {
            dt - t_done
        } else if vmax > 0.0 {
            jmax(min_ds, (CFL * hmin) / vmax)
        } else {
            dt
        };
        if t_done + ds >= dt * (1.0 - 1e-12) {
            ds = dt - t_done;
        }
        // Drift, kick, drift (leapfrog).
        let ds_half = 0.5 * ds;
        for i in 0..n {
            x[i] += vx[i] * ds_half;
            y[i] += vy[i] * ds_half;
        }
        for u in units.iter_mut() {
            u.cx += u.vx * ds_half;
            u.cy += u.vy * ds_half;
            u.th += u.w * ds_half;
            let (s, c) = sin_cos(u.th);
            u.qc = c;
            u.qs = s;
        }

        // --- Wall contacts within one smoothing length. ---
        // buildWallCells
        stamp += 1;
        let mut n_occ = 0;
        w_next.clear();
        w_wall.clear();
        big_walls.clear();
        let mut gx0 = f64::INFINITY;
        let mut gx1 = f64::NEG_INFINITY;
        let mut gy0 = f64::INFINITY;
        let mut gy1 = f64::NEG_INFINITY;
        for i in 0..n {
            if x[i] < gx0 {
                gx0 = x[i];
            }
            if x[i] > gx1 {
                gx1 = x[i];
            }
            if y[i] < gy0 {
                gy0 = y[i];
            }
            if y[i] > gy1 {
                gy1 = y[i];
            }
            let pcx = clamp_cell((x[i] * inv).floor());
            let pcy = clamp_cell((y[i] * inv).floor());
            let h = slot_of(h_stamp, h_cx, h_cy, stamp, h_shift, h_mask, pcx, pcy);
            if h_stamp[h] != stamp {
                h_stamp[h] = stamp;
                h_cx[h] = pcx as i32;
                h_cy[h] = pcy as i32;
                h_head[h] = -1;
                occ[n_occ] = h;
                n_occ += 1;
            }
            p_slot[i] = h;
        }
        let cx0 = (gx0 * inv).floor() - 1.0;
        let cx1 = (gx1 * inv).floor() + 1.0;
        let cy0 = (gy0 * inv).floor() - 1.0;
        let cy1 = (gy1 * inv).floor() + 1.0;
        for k in 0..nw {
            let w = &walls[k];
            let mut cx = w.bcx;
            let mut cy = w.bcy;
            let r = w.br;
            if w.unit >= 0 {
                let u = &units[w.unit as usize];
                let dx = cx - u.ex;
                let dy = cy - u.ey;
                cx = u.cx + u.qc * dx - u.qs * dy;
                cy = u.cy + u.qs * dx + u.qc * dy;
            }
            let x0 = jmax(cx0, ((cx - r) * inv).floor());
            let x1 = jmin(cx1, ((cx + r) * inv).floor());
            let y0 = jmax(cy0, ((cy - r) * inv).floor());
            let y1 = jmin(cy1, ((cy + r) * inv).floor());
            if x0 > x1 || y0 > y1 {
                continue; // no gas near this body
            }
            let area = (x1 - x0 + 1.0) * (y1 - y0 + 1.0);
            if area > BIG_WALL_CELLS {
                big_walls.push(k);
                continue;
            }
            let is_clamped = x0 < -32767.0 || x1 > 32767.0 || y0 < -32767.0 || y1 > 32767.0;
            // fileWall: appends wall k to the list of slot h.
            macro_rules! file_wall {
                ($h:expr) => {
                    let at = w_wall.len() as i32;
                    w_wall.push(k);
                    w_next.push(-1);
                    if h_head[$h] < 0 {
                        h_head[$h] = at;
                    } else {
                        w_next[h_tail[$h] as usize] = at;
                    }
                    h_tail[$h] = at;
                };
            }
            if 4.0 * area <= n_occ as f64 || is_clamped {
                // Each cell under the wall.
                let mut gx = x0;
                while gx <= x1 {
                    let mut gy = y0;
                    while gy <= y1 {
                        let h = slot_of(h_stamp, h_cx, h_cy, stamp, h_shift, h_mask, clamp_cell(gx), clamp_cell(gy));
                        if h_stamp[h] == stamp {
                            file_wall!(h);
                        }
                        gy += 1.0;
                    }
                    gx += 1.0;
                }
            } else {
                // Fewer gas cells than cells under the wall: test each gas cell instead.
                for o in 0..n_occ {
                    let h = occ[o];
                    if h_cx[h] as f64 >= x0 && h_cx[h] as f64 <= x1 && h_cy[h] as f64 >= y0 && h_cy[h] as f64 <= y1 {
                        file_wall!(h);
                    }
                }
            }
        }

        c_p.clear();
        c_w.clear();
        c_d.clear();
        c_nx.clear();
        c_ny.clear();
        for i in 0..n {
            c_start[i] = c_p.len();
            let mut at = h_head[p_slot[i]];
            if at < 0 && big_walls.is_empty() {
                continue;
            }
            // This cell's walls, then the big ones.
            let mut b = 0;
            while at >= 0 || b < big_walls.len() {
                let k;
                if at >= 0 {
                    k = w_wall[at as usize];
                    at = w_next[at as usize];
                } else {
                    k = big_walls[b];
                    b += 1;
                }
                let w = &walls[k];
                // toWallFrame: the point in the end-of-step frame the walls were built in.
                let (lx, ly) = if w.unit < 0 {
                    (x[i], y[i])
                } else {
                    let u = &units[w.unit as usize];
                    let dx = x[i] - u.cx;
                    let dy = y[i] - u.cy;
                    (u.ex + u.qc * dx + u.qs * dy, u.ey - u.qs * dx + u.qc * dy)
                };
                if lx < w.min_x || lx > w.max_x || ly < w.min_y || ly > w.max_y {
                    continue;
                }
                let (d, mut snx, mut sny) = surface(w, verts, lx, ly);
                if d >= hh[i] {
                    continue;
                }
                if w.unit >= 0 {
                    // The normal back in the world frame.
                    let u = &units[w.unit as usize];
                    let nx = u.qc * snx - u.qs * sny;
                    sny = u.qs * snx + u.qc * sny;
                    snx = nx;
                }
                c_p.push(i);
                c_w.push(k);
                c_d.push(d);
                c_nx.push(snx);
                c_ny.push(sny);
            }
        }
        let nc = c_p.len();
        c_start[n] = nc;

        // --- Entries: parcels, then a mirror ghost for each contact outside the body. ---
        let mut cap_n = n + nc;
        for i in 0..n {
            let k = c_start[i + 1] - c_start[i];
            if k > 1 {
                cap_n += (k * (k - 1)) / 2;
            }
        }
        for v in [&mut *ex, &mut *ey, &mut *gvx, &mut *gvy, &mut *sx, &mut *sy] {
            ensure(v, cap_n);
        }
        ensure(g_contact, cap_n);
        ensure(g_contact2, cap_n);
        ensure(ekey, cap_n);
        ensure(idx, cap_n);
        ensure(idx2, cap_n);
        ensure(run_start, cap_n + 1);
        ensure(run_key, cap_n + 1);
        for i in 0..n {
            ex[i] = x[i];
            ey[i] = y[i];
        }
        let mut ne = n;
        for c in 0..nc {
            let d = c_d[c];
            if !(d > 0.0) {
                continue;
            }
            let i = c_p[c];
            let nx = c_nx[c];
            let ny = c_ny[c];
            ex[ne] = x[i] - 2.0 * d * nx;
            ey[ne] = y[i] - 2.0 * d * ny;
            // Mirrored velocity relative to the wall: normal component reversed (free slip).
            let (wx, wy) = wall_point_velocity(&walls[c_w[c]], units, x[i] - d * nx, y[i] - d * ny);
            let vn = (vx[i] - wx) * nx + (vy[i] - wy) * ny;
            gvx[ne] = vx[i] - 2.0 * vn * nx;
            gvy[ne] = vy[i] - 2.0 * vn * ny;
            g_contact[ne] = c;
            g_contact2[ne] = -1;
            ne += 1;
        }
        // Corner ghosts: mirrored in both of two non-parallel faces near the parcel.
        for i in 0..n {
            for c1 in c_start[i]..c_start[i + 1] {
                if !(c_d[c1] > 0.0) {
                    continue;
                }
                for c2 in c1 + 1..c_start[i + 1] {
                    if !(c_d[c2] > 0.0) || c_nx[c1] * c_nx[c2] + c_ny[c1] * c_ny[c2] > 0.5 {
                        continue;
                    }
                    ex[ne] = x[i] - 2.0 * c_d[c1] * c_nx[c1] - 2.0 * c_d[c2] * c_nx[c2];
                    ey[ne] = y[i] - 2.0 * c_d[c1] * c_ny[c1] - 2.0 * c_d[c2] * c_ny[c2];
                    let mut gx = vx[i];
                    let mut gy = vy[i];
                    for t in 0..2 {
                        let c = if t == 0 { c1 } else { c2 };
                        let (wx, wy) = wall_point_velocity(&walls[c_w[c]], units, x[i] - c_d[c] * c_nx[c], y[i] - c_d[c] * c_ny[c]);
                        let vn = (gx - wx) * c_nx[c] + (gy - wy) * c_ny[c];
                        gx -= 2.0 * vn * c_nx[c];
                        gy -= 2.0 * vn * c_ny[c];
                    }
                    gvx[ne] = gx;
                    gvy[ne] = gy;
                    g_contact[ne] = c1;
                    g_contact2[ne] = c2 as i32;
                    ne += 1;
                }
            }
        }

        phase!(0);
        // --- Neighbour grid: sort entries by cell, then index (deterministic). ---
        // A stable radix sort of the entries by their 32-bit cell key, a byte at a time; bytes every
        // key shares are skipped.
        let mut k_or: u32 = 0;
        let mut k_and: u32 = 0xffffffff;
        for en in 0..ne {
            let cell_x = clamp_cell((ex[en] * inv).floor()) as i32;
            let cell_y = clamp_cell((ey[en] * inv).floor()) as i32;
            let key = ((cell_x + 32768) as u32).wrapping_mul(65536).wrapping_add((cell_y + 32768) as u32);
            ekey[en] = key;
            k_or |= key;
            k_and &= key;
            idx[en] = en;
        }
        let mut radix_count = [0usize; 256];
        let mut sh = 0;
        while sh < 32 {
            if ((k_or ^ k_and) >> sh) & 255 != 0 {
                radix_count.fill(0);
                for k in 0..ne {
                    radix_count[((ekey[idx[k]] >> sh) & 255) as usize] += 1;
                }
                let mut sum = 0;
                for d in 0..256 {
                    let c = radix_count[d];
                    radix_count[d] = sum;
                    sum += c;
                }
                for k in 0..ne {
                    let en = idx[k];
                    let d = ((ekey[en] >> sh) & 255) as usize;
                    idx2[radix_count[d]] = en;
                    radix_count[d] += 1;
                }
                std::mem::swap(idx, idx2);
            }
            sh += 8;
        }
        for k in 0..ne {
            sx[k] = ex[idx[k]];
            sy[k] = ey[idx[k]];
        }
        let mut n_runs = 0;
        for k in 0..ne {
            let key = ekey[idx[k]];
            if k == 0 || key != run_key[n_runs - 1] {
                run_start[n_runs] = k;
                run_key[n_runs] = key;
                n_runs += 1;
            }
        }
        run_start[n_runs] = ne;

        pa.clear();
        pb.clear();
        pr.clear();
        ga.clear();
        gb.clear();
        gr.clear();
        let mut stencil_at = [0usize; 4];
        for r in 0..n_runs {
            let a0 = run_start[r];
            let a1 = run_start[r + 1];
            let key0 = run_key[r] as u64;
            // This run against itself, then the half stencil (0,+1), (+1,−1), (+1,0), (+1,+1).
            for st in 0..5 {
                let mut b0 = a0;
                let mut b1 = a1;
                if st > 0 {
                    let key = key0 + [1u64, 65535, 65536, 65537][st - 1];
                    // The run with this key, if any: each stencil cell's pointer only moves forward.
                    let mut at = stencil_at[st - 1];
                    while at < n_runs && (run_key[at] as u64) < key {
                        at += 1;
                    }
                    stencil_at[st - 1] = at;
                    if at >= n_runs || run_key[at] as u64 != key {
                        continue;
                    }
                    b0 = run_start[at];
                    b1 = run_start[at + 1];
                }
                for a in a0..a1 {
                    let en = idx[a];
                    let ex_a = sx[a];
                    let ey_a = sy[a];
                    for b in (if st == 0 { a + 1 } else { b0 })..b1 {
                        let dx = ex_a - sx[b];
                        let dy = ey_a - sy[b];
                        let r2 = dx * dx + dy * dy;
                        if r2 >= hmax2 {
                            continue; // most candidates are rejected here
                        }
                        let f = idx[b];
                        let eg = en >= n;
                        let fg = f >= n;
                        if eg && fg {
                            continue;
                        }
                        let i = if eg { f } else { en }; // the parcel
                        let o = if eg { en } else { f }; // the other entry
                        let j = if o >= n { c_p[g_contact[o]] } else { o }; // its parcel
                        let h = 0.5 * (hh[i] + hh[j]);
                        if r2 >= h * h {
                            continue;
                        }
                        if o < n {
                            if c_start[i] != c_start[i + 1] && c_start[j] != c_start[j + 1] && separated(c_start, c_w, c_nx, c_ny, i, j) {
                                continue;
                            }
                            pa.push(i);
                            pb.push(o);
                            pr.push(r2.sqrt());
                        } else {
                            if !same_face(c_start, c_w, c_nx, c_ny, i, g_contact[o]) || (g_contact2[o] >= 0 && !same_face(c_start, c_w, c_nx, c_ny, i, g_contact2[o] as usize)) {
                                continue;
                            }
                            ga.push(i);
                            gb.push(o);
                            gr.push(r2.sqrt());
                        }
                    }
                }
            }
        }
        let np = pa.len();
        let ng = ga.len();

        phase!(1);
        // --- Density: parcels plus mirror ghosts on the same face. ---
        for i in 0..n {
            rho[i] = m[i] * (W_C2 / (hh[i] * hh[i]));
        }
        for k in 0..np {
            let i = pa[k];
            let j = pb[k];
            let h = 0.5 * (hh[i] + hh[j]);
            let q = pr[k] / h;
            let t = 1.0 - q;
            let w = (W_C2 / (h * h)) * t * t * t * t * (1.0 + 4.0 * q);
            rho[i] += m[j] * w;
            rho[j] += m[i] * w;
        }
        for k in 0..ng {
            let i = ga[k];
            let j = c_p[g_contact[gb[k]]];
            let h = 0.5 * (hh[i] + hh[j]);
            let q = gr[k] / h;
            let t = 1.0 - q;
            rho[i] += m[j] * (W_C2 / (h * h)) * t * t * t * t * (1.0 + 4.0 * q);
        }
        for i in 0..n {
            let u = jmax(0.0, e[i] / m[i]);
            aa[i] = (g1[i] * u) / rho[i];
            cs[i] = (gam[i] * g1[i] * u).sqrt();
        }

        phase!(2);
        // --- Impulses and energy, retried with a shorter substep if any parcel's thermal energy
        // would go negative. ---
        s_vx[..n].copy_from_slice(vx);
        s_vy[..n].copy_from_slice(vy);
        s_e[..n].copy_from_slice(e);
        for u in units.iter_mut() {
            u.sx = u.vx;
            u.sy = u.vy;
            u.sw = u.w;
        }
        ensure(p_j, np);
        ensure(p_s, np);
        ensure(g_j, ng);
        ensure(g_s, ng);
        let mut ext_x;
        let mut ext_y;
        let mut ext_a;
        let mut wall_imp;
        let mut last_deficit = f64::INFINITY;
        let mut attempt = 0;
        loop {
            t_part.fill(0.0);
            ext_x = 0.0;
            ext_y = 0.0;
            ext_a = 0.0;
            wall_imp = 0.0;
            // --- Impulses, all from the state at the start of the substep (order-independent). ---
            dvx[..n].fill(0.0);
            dvy[..n].fill(0.0);
            for u in units.iter_mut() {
                u.dvx = 0.0;
                u.dvy = 0.0;
                u.dw = 0.0;
            }
            for k in 0..np {
                let i = pa[k];
                let j = pb[k];
                let r = pr[k];
                p_j[k] = 0.0;
                if r == 0.0 {
                    continue;
                }
                let h = 0.5 * (hh[i] + hh[j]);
                let exx = (x[i] - x[j]) / r;
                let eyy = (y[i] - y[j]) / r;
                let vr = (vx[i] - vx[j]) * exx + (vy[i] - vy[j]) * eyy; // < 0 when approaching
                let mut visc = 0.0;
                if vr < 0.0 {
                    let mu = (h * vr * r) / (r * r + 0.01 * h * h);
                    visc = (-VISC_ALPHA * 0.5 * (cs[i] + cs[j]) * mu + VISC_BETA * mu * mu) / (0.5 * (rho[i] + rho[j]));
                }
                let q = r / h;
                let t = 1.0 - q;
                let grad = (G_C2 / (h * h * h)) * q * t * t * t;
                let jp = ds * m[i] * m[j] * (aa[i] + aa[j]) * grad;
                // Viscosity only dissipates: at most the impulse that stops the pair closing.
                let jv = jmin(ds * m[i] * m[j] * visc * grad, if vr < 0.0 { -vr / (1.0 / m[i] + 1.0 / m[j]) } else { 0.0 });
                let jm = jp + jv;
                if !(jm > 0.0) {
                    continue;
                }
                p_j[k] = jm;
                // Thermal share of i: its own pressure term plus half the viscosity.
                p_s[k] = (jp * pressure_share(aa[i], aa[j]) + 0.5 * jv) / jm;
                dvx[i] += (jm * exx) / m[i];
                dvy[i] += (jm * eyy) / m[i];
                dvx[j] -= (jm * exx) / m[j];
                dvy[j] -= (jm * eyy) / m[j];
            }
            for k in 0..ng {
                let i = ga[k];
                let gi = gb[k];
                let c = g_contact[gi];
                let j = c_p[c];
                let r = gr[k];
                g_j[k] = 0.0;
                if r == 0.0 {
                    continue;
                }
                let h = 0.5 * (hh[i] + hh[j]);
                let exx = (x[i] - ex[gi]) / r;
                let eyy = (y[i] - ey[gi]) / r;
                let vr = (vx[i] - gvx[gi]) * exx + (vy[i] - gvy[gi]) * eyy;
                let mut visc = 0.0;
                if vr < 0.0 {
                    let mu = (h * vr * r) / (r * r + 0.01 * h * h);
                    visc = (-VISC_ALPHA * 0.5 * (cs[i] + cs[j]) * mu + VISC_BETA * mu * mu) / (0.5 * (rho[i] + rho[j]));
                }
                let q = r / h;
                let t = 1.0 - q;
                let grad = (G_C2 / (h * h * h)) * q * t * t * t;
                // The mirror moves oppositely, so stopping the closing takes half the relative speed.
                let jv = jmin(ds * m[i] * m[j] * visc * grad, if vr < 0.0 { (-vr * m[i]) / 2.0 } else { 0.0 });
                let jp = ds * m[i] * m[j] * (aa[i] + aa[j]) * grad;
                let jm = jp + jv;
                if !(jm > 0.0) {
                    continue;
                }
                g_j[k] = jm;
                // Thermal share of the parcel; the rest is drawn from the ghost's source parcel.
                g_s[k] = (jp * pressure_share(aa[i], aa[j]) + 0.5 * jv) / jm;
                let jx = jm * exx;
                let jy = jm * eyy;
                dvx[i] += jx / m[i];
                dvy[i] += jy / m[i];
                let wk = c_w[c];
                let wall = &walls[wk];
                if wall.unit >= 0 {
                    let u = &mut units[wall.unit as usize];
                    u.dvx -= jx / u.m;
                    u.dvy -= jy / u.m;
                    u.dw -= ((x[i] - u.cx) * jy - (y[i] - u.cy) * jx) / u.i;
                    if units[wall.unit as usize].multi {
                        push_part(t_part, walls, units, wk, -jx, -jy, x[i], y[i]);
                    }
                } else {
                    ext_x += jx;
                    ext_y += jy;
                    ext_a += x[i] * jy - y[i] * jx;
                }
                involve!(wk);
                // Pressure statistic: the impulse's normal part on each face it pushes.
                wall_imp += (jm * (exx * c_nx[c] + eyy * c_ny[c])).abs();
                let c2 = g_contact2[gi];
                if c2 >= 0 {
                    wall_imp += (jm * (exx * c_nx[c2 as usize] + eyy * c_ny[c2 as usize])).abs();
                }
            }

            // --- Energy: each impulse's work, at the mean of old and new velocities, moves between
            // kinetic and thermal. ---
            for i in 0..n {
                mvx[i] = vx[i] + 0.5 * dvx[i];
                mvy[i] = vy[i] + 0.5 * dvy[i];
            }
            for k in 0..np {
                let jm = p_j[k];
                if jm == 0.0 {
                    continue;
                }
                let i = pa[k];
                let j = pb[k];
                let r = pr[k];
                let work = (jm * ((x[i] - x[j]) * (mvx[i] - mvx[j]) + (y[i] - y[j]) * (mvy[i] - mvy[j]))) / r;
                let sh = if work > 0.0 { pressure_share(aa[i], aa[j]) } else { p_s[k] };
                e[i] -= sh * work;
                e[j] -= (1.0 - sh) * work;
            }
            for k in 0..ng {
                let jm = g_j[k];
                if jm == 0.0 {
                    continue;
                }
                let i = ga[k];
                let gi = gb[k];
                let c = g_contact[gi];
                let r = gr[k];
                let exx = (x[i] - ex[gi]) / r;
                let eyy = (y[i] - ey[gi]) / r;
                let wall = &walls[c_w[c]];
                let mut wvx = 0.0;
                let mut wvy = 0.0;
                if wall.unit >= 0 {
                    let u = &units[wall.unit as usize];
                    let w = u.w + 0.5 * u.dw;
                    wvx = u.vx + 0.5 * u.dvx - w * (y[i] - u.cy);
                    wvy = u.vy + 0.5 * u.dvy + w * (x[i] - u.cx);
                }
                let work = jm * (exx * (mvx[i] - wvx) + eyy * (mvy[i] - wvy));
                let src = c_p[c];
                let sh = if work > 0.0 { pressure_share(aa[i], aa[src]) } else { g_s[k] };
                e[i] -= sh * work;
                e[src] -= (1.0 - sh) * work;
            }
            for i in 0..n {
                vx[i] += dvx[i];
                vy[i] += dvy[i];
            }
            for u in units.iter_mut() {
                u.vx += u.dvx;
                u.vy += u.dvy;
                u.w += u.dw;
            }

            tries += 1;
            let mut deficit = 0.0;
            for i in 0..n {
                if e[i] < 0.0 {
                    deficit -= e[i];
                }
            }
            // A shorter substep only helps if the deficit shrinks with it.
            if deficit == 0.0 || spent || attempt >= MAX_RETRIES || (attempt > 0 && deficit > 0.75 * last_deficit) {
                break;
            }
            last_deficit = deficit;
            vx.copy_from_slice(&s_vx[..n]);
            vy.copy_from_slice(&s_vy[..n]);
            e.copy_from_slice(&s_e[..n]);
            for u in units.iter_mut() {
                u.vx = u.sx;
                u.vy = u.sy;
                u.w = u.sw;
            }
            ds *= 0.5;
            attempt += 1;
        }
        phase!(3);
        // Only if even the shortest substep could not resolve it: clamp.
        for i in 0..n {
            if e[i] < 0.0 {
                clamped -= e[i];
                crushed[i] = 1;
                e[i] = 0.0;
            }
        }
        ext_acc_x += ext_x;
        ext_acc_y += ext_y;
        ext_acc_a += ext_a;
        for k in 0..part_j.len() {
            part_j[k] += t_part[k];
        }
        wall_impulse += wall_imp;
        t_done = if ds == dt - t_done { dt } else { t_done + ds };
        nsub += 1.0;

        // --- Elastic bounce for a parcel that would otherwise reach a surface in the rest of the substep. ---
        for c in 0..nc {
            let i = c_p[c];
            let d = c_d[c];
            let nx = c_nx[c];
            let ny = c_ny[c];
            let wk = c_w[c];
            let wall = &walls[wk];
            let px = x[i] - d * nx;
            let py = y[i] - d * ny;
            let (wx, wy) = wall_point_velocity(wall, units, px, py);
            let vn = (vx[i] - wx) * nx + (vy[i] - wy) * ny;
            if !(vn < 0.0) || d + vn * (ds - ds_half) >= HARD_WALL * rad[i] {
                continue;
            }
            let has_unit = wall.unit >= 0;
            let ui = wall.unit as usize;
            let rn = if has_unit { (px - units[ui].cx) * ny - (py - units[ui].cy) * nx } else { 0.0 };
            let inv_k = 1.0 / m[i] + if has_unit { 1.0 / units[ui].m + (rn * rn) / units[ui].i } else { 0.0 };
            let jm = (-2.0 * vn) / inv_k;
            // wallExchange: impulse J on the parcel, −J on the unit, both along the line through (px, py).
            {
                let jx = jm * nx;
                let jy = jm * ny;
                let pvx = vx[i];
                let pvy = vy[i];
                // Exact ΔKE as a quadratic in the scale s.
                let rx = px - if has_unit { units[ui].cx } else { 0.0 };
                let ry = py - if has_unit { units[ui].cy } else { 0.0 };
                let a = jx * pvx + jy * pvy - if has_unit { jx * units[ui].vx + jy * units[ui].vy + units[ui].w * (rx * jy - ry * jx) } else { 0.0 };
                let rn = rx * jy - ry * jx;
                let b = 0.5 * (jx * jx + jy * jy) * (1.0 / m[i] + if has_unit { 1.0 / units[ui].m } else { 0.0 }) + if has_unit { (0.5 * rn * rn) / units[ui].i } else { 0.0 };
                let mut sc = 1.0;
                let mut d_ke = a + b;
                if d_ke > e[i] {
                    sc = if b > 0.0 { (-a + jmax(0.0, a * a + 4.0 * b * e[i]).sqrt()) / (2.0 * b) } else { 0.0 };
                    sc = jmax(0.0, jmin(1.0, sc));
                    d_ke = sc * a + sc * sc * b;
                }
                let ix = sc * jx;
                let iy = sc * jy;
                vx[i] += ix / m[i];
                vy[i] += iy / m[i];
                if has_unit {
                    // applyUnit: impulse (−ix, −iy) on the unit at (px, py).
                    let u = &mut units[ui];
                    let (ux, uy) = (-ix, -iy);
                    u.vx += ux / u.m;
                    u.vy += uy / u.m;
                    u.w += ((px - u.cx) * uy - (py - u.cy) * ux) / u.i;
                    if units[ui].multi {
                        push_part(part_j, walls, units, wk, -ix, -iy, px, py);
                    }
                } else {
                    ext_acc_x += ix;
                    ext_acc_y += iy;
                    // About the origin: the impulse's line of action passes through the parcel.
                    ext_acc_a += x[i] * iy - y[i] * ix;
                }
                e[i] = jmax(0.0, e[i] - d_ke);
                involve!(wk);
            }
            wall_impulse += jm;
        }

        // --- Drift: parcels, and the bodies with them. ---
        let rest = ds - ds_half;
        for i in 0..n {
            x[i] += vx[i] * rest;
            y[i] += vy[i] * rest;
        }
        for u in units.iter_mut() {
            u.cx += u.vx * rest;
            u.cy += u.vy * rest;
            u.th += u.w * rest;
            let (s, c) = sin_cos(u.th);
            u.qc = c;
            u.qs = s;
        }
        phase!(4);
    }

    for (k, u) in units.iter().enumerate() {
        let o = k * US;
        units_io[o + 2] = u.vx;
        units_io[o + 3] = u.vy;
        units_io[o + 4] = u.w;
        units_io[o + 9] = u.cx;
        units_io[o + 10] = u.cy;
        units_io[o + 11] = u.th;
        units_io[o + 12] = u.qc;
        units_io[o + 13] = u.qs;
    }
    out[0] = ext_acc_x;
    out[1] = ext_acc_y;
    out[2] = ext_acc_a;
    out[3] = clamped;
    out[4] = wall_impulse;
    out[5] = nsub;
    out[6] = n_touch as f64;
    out[7..12].copy_from_slice(&times);
}
