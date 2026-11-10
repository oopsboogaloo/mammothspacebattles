//! The constraint solve (welds and contacts), compiled to WebAssembly.
//!
//! Each component stays a rigid body. A weld joins two bodies at a pair of anchor points and holds
//! their relative angle; it is solved with the contacts by sequential impulses, and the impulse it
//! needs each step gives its load (src/core/joints.ts `evaluateJoints`). The weld follows Box2D's
//! weld joint (Erin Catto) without softness. Finding and building contacts, breaking welds and the
//! ledger are in TypeScript (src/core/physics.ts, joints.ts).
//!
//! Ported line for line from TypeScript and checked bit for bit against it (docs/perf/rust-trial.md);
//! that copy is gone, so this is the solver. Results must not change by a bit: WebAssembly's f64
//! arithmetic is IEEE 754 like JavaScript's, with no fused multiply-add, and Rust never reorders
//! float operations; `Math.max`/`Math.min`/`Math.round` are copied exactly (NaN and the sign of
//! zero), and `sin_cos` is the same fdlibm port as math.ts's `sinCos`. Keep the order of every
//! operation when changing anything here.
//!
//! TypeScript writes the inputs into the buffers below (in this module's memory), calls a solve, and
//! reads the results back. Nothing here makes garbage for the JavaScript collector.

use std::ptr::addr_of_mut;

mod gas;

// ---------- Buffer layouts (strides in f64s; src/core/solverWasm.ts mirrors these) ----------

/// Per body: velocity, angular velocity, position, angle, inverse mass and inertia, the step's
/// rotation (sin, cos of the angle when the solve began), mass and inertia.
const BS: usize = 12;
const VX: usize = 0;
const VY: usize = 1;
const W: usize = 2;
const PX: usize = 3;
const PY: usize = 4;
const ANG: usize = 5;
const IM: usize = 6;
const II: usize = 7;
const RS: usize = 8;
const RC: usize = 9;
const MASS: usize = 10;
const INERTIA: usize = 11;

/// Per weld: inputs (body slots, anchors, axis, limits, integrity, reference angle) and outputs
/// (impulse, whether held at a limit, and then its demand).
const JS: usize = 21;
const JA: usize = 0;
const JB: usize = 1;
const AAX: usize = 2;
const AAY: usize = 3;
const ABX: usize = 4;
const ABY: usize = 5;
const AXX: usize = 6;
const AXY: usize = 7;
const TEN: usize = 8;
const COMP: usize = 9;
const SHR: usize = 10;
const TOR: usize = 11;
const INTEG: usize = 12;
const REF: usize = 13;
const OPX: usize = 14;
const OPY: usize = 15;
const OL: usize = 16;
const OCAP: usize = 17;
const ODX: usize = 18;
const ODY: usize = 19;
const ODA: usize = 20;

/// Per contact: body slots, normal, friction, restitution, point count, first point, and where b's
/// copy is from b when the pair meets across a wrapped world's edge (0, 0 otherwise).
const CS: usize = 10;
const CA: usize = 0;
const CB: usize = 1;
const CNX: usize = 2;
const CNY: usize = 3;
const CFR: usize = 4;
const CRE: usize = 5;
const CNP: usize = 6;
const CP0: usize = 7;
const CSX: usize = 8;
const CSY: usize = 9;

/// Per contact point.
const PS: usize = 16;
const RAX: usize = 0;
const RAY: usize = 1;
const RBX: usize = 2;
const RBY: usize = 3;
const NM: usize = 4;
const TM: usize = 5;
const SEP: usize = 6;
const VN0: usize = 7;
const NI: usize = 8;
const TI: usize = 9;
const MNI: usize = 10;
const EL: usize = 11;
const LAX: usize = 12;
const LAY: usize = 13;
const LBX: usize = 14;
const LBY: usize = 15;

/// Accounts: contacts' external impulse x, y, angular, predicted KE; the same for welds; retried.
const ACC_LEN: usize = 9;

/// Normal approach speed below which restitution is ignored, so resting contacts don't jitter, m/s.
const RESTITUTION_THRESHOLD: f64 = 0.1;
/// Position correction: passes a step, the share of an overlap taken out a pass, and the most a pass
/// moves a point, m.
const POSITION_ITERATIONS: usize = 4;
const BAUMGARTE: f64 = 0.2;
const MAX_CORRECTION: f64 = 0.2;
/// The share of a weld's anchor gap and angle error taken out a pass.
const JOINT_BAUMGARTE: f64 = 0.5;

/// A weld's solver state for one step: lever arms, the 2×2 point-constraint matrix (k) and its
/// inverse (m), the axis in world space (impulse on b along it is compression), this step's impulse
/// limits (the weld's limits × dt: along the axis, across it, angular) and its accumulated impulse on b.
#[derive(Clone, Copy, Default)]
struct Weld {
    a: usize,
    b: usize,
    rax: f64,
    ray: f64,
    rbx: f64,
    rby: f64,
    m11: f64,
    m12: f64,
    m22: f64,
    k11: f64,
    k12: f64,
    k22: f64,
    angular_mass: f64,
    axx: f64,
    axy: f64,
    lo: f64,
    hi: f64,
    shear: f64,
    torque: f64,
    px: f64,
    py: f64,
    l: f64,
}

struct State {
    bodies: Vec<f64>,
    joints: Vec<f64>,
    contacts: Vec<f64>,
    points: Vec<f64>,
    acc: [f64; ACC_LEN],
    welds: Vec<Weld>,
    v0: Vec<f64>,
}

static mut STATE: State = State { bodies: Vec::new(), joints: Vec::new(), contacts: Vec::new(), points: Vec::new(), acc: [0.0; ACC_LEN], welds: Vec::new(), v0: Vec::new() };

fn st() -> &'static mut State {
    // Single-threaded: one call at a time from JavaScript.
    unsafe { &mut *addr_of_mut!(STATE) }
}

// ---------- JavaScript's Math, exactly ----------

#[inline]
fn jmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else if b > a {
        b
    } else if a == 0.0 {
        if a.is_sign_negative() && b.is_sign_negative() { -0.0 } else { 0.0 }
    } else {
        a
    }
}

#[inline]
fn jmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else if b < a {
        b
    } else if a == 0.0 {
        if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 }
    } else {
        a
    }
}

#[inline]
fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    jmin(hi, jmax(lo, x))
}

/// Math.round: the nearest integer, ties toward +∞, keeping −0.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x.is_sign_negative() { -0.0 } else { r }
}

// fdlibm k_sin.c / k_cos.c, as math.ts.
const S1: f64 = -1.66666666666666324348e-1;
const S2: f64 = 8.33333333332248946124e-3;
const S3: f64 = -1.98412698298579493134e-4;
const S4: f64 = 2.75573137070700676789e-6;
const S5: f64 = -2.50507602534068634195e-8;
const S6: f64 = 1.58969099521155010221e-10;
const C1: f64 = 4.16666666666666019037e-2;
const C2: f64 = -1.38888888888741095749e-3;
const C3: f64 = 2.48015872894767294178e-5;
const C4: f64 = -2.75573143513906633035e-7;
const C5: f64 = 2.08757232129817482790e-9;
const C6: f64 = -1.13596475577881948265e-11;
const PIO2_1: f64 = 1.57079632673412561417;
const PIO2_2: f64 = 6.07710050630396597660e-11;
const PIO2_3: f64 = 2.02226624871116645580e-21;
const INV_PIO2: f64 = 6.36619772367581382433e-1;

#[inline]
fn k_sin(x: f64) -> f64 {
    let z = x * x;
    x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
}

#[inline]
fn k_cos(x: f64) -> f64 {
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    let hz = 0.5 * z;
    let w = 1.0 - hz;
    w + (1.0 - w - hz + z * r)
}

/// (sin, cos) of x, the same bits as math.ts's sinCos.
fn sin_cos(x: f64) -> (f64, f64) {
    if !x.is_finite() {
        return (f64::NAN, f64::NAN);
    }
    let k = js_round(x * INV_PIO2);
    let r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
    let s = k_sin(r);
    let c = k_cos(r);
    let q = ((k % 4.0) + 4.0) % 4.0;
    if q == 0.0 {
        (s, c)
    } else if q == 1.0 {
        (c, -s)
    } else if q == 2.0 {
        (-s, -c)
    } else {
        (-c, s)
    }
}

// ---------- Buffers ----------

fn ensure(v: &mut Vec<f64>, len: usize) {
    if v.len() < len {
        v.resize(len, 0.0);
    }
}

/// Makes room for nb bodies, nj welds, nc contacts and np points. May grow memory: views over it
/// must be made again after.
#[no_mangle]
pub extern "C" fn reserve(nb: usize, nj: usize, nc: usize, np: usize) {
    let s = st();
    ensure(&mut s.bodies, nb * BS);
    ensure(&mut s.joints, nj * JS);
    ensure(&mut s.contacts, nc * CS);
    ensure(&mut s.points, np * PS);
    ensure(&mut s.v0, nb * 3);
    if s.welds.len() < nj {
        s.welds.resize(nj, Weld::default());
    }
}

#[no_mangle]
pub extern "C" fn bodies_ptr() -> *mut f64 {
    st().bodies.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn joints_ptr() -> *mut f64 {
    st().joints.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn contacts_ptr() -> *mut f64 {
    st().contacts.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn points_ptr() -> *mut f64 {
    st().points.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn acc_ptr() -> *mut f64 {
    st().acc.as_mut_ptr()
}

/// sinCos for tests: writes (sin, cos) into the accounts buffer.
#[no_mangle]
pub extern "C" fn sin_cos_into_acc(x: f64) {
    let (s, c) = sin_cos(x);
    st().acc[0] = s;
    st().acc[1] = c;
}

// ---------- Velocity solve ----------

/// One account: external impulse x, y, angular, predicted KE (ConstraintAccount without `involved`).
#[derive(Clone, Copy, Default)]
struct Acc {
    ex: f64,
    ey: f64,
    ang: f64,
    ke: f64,
}

/// Relative velocity of b's anchor over a's.
#[inline]
fn rel(b: &[f64], a: usize, bb: usize, rax: f64, ray: f64, rbx: f64, rby: f64) -> (f64, f64) {
    let (ao, bo) = (a * BS, bb * BS);
    let x = b[bo + VX] + -b[bo + W] * rby - (b[ao + VX] + -b[ao + W] * ray);
    let y = b[bo + VY] + b[bo + W] * rbx - (b[ao + VY] + b[ao + W] * rax);
    (x, y)
}

/// An impulse (px, py) on b at rB, and its opposite on a at rA (applyLinear). Returns the work
/// predicted, for contacts' energy lost; the account takes it too.
#[inline]
fn apply_linear(b: &mut [f64], a: usize, bb: usize, rax: f64, ray: f64, rbx: f64, rby: f64, px: f64, py: f64, acc: &mut Acc) -> f64 {
    let (bx, by) = rel(b, a, bb, rax, ray, rbx, rby);
    let (ao, bo) = (a * BS, bb * BS);
    let ma = b[ao + IM];
    let mb = b[bo + IM];
    b[ao + VX] = b[ao + VX] - px * ma;
    b[ao + VY] = b[ao + VY] - py * ma;
    b[ao + W] -= b[ao + II] * (rax * py - ray * px);
    b[bo + VX] = b[bo + VX] + px * mb;
    b[bo + VY] = b[bo + VY] + py * mb;
    b[bo + W] += b[bo + II] * (rbx * py - rby * px);
    let (ax, ay) = rel(b, a, bb, rax, ray, rbx, rby);
    let de = (px * (bx + ax) + py * (by + ay)) / 2.0;
    acc.ke += de;
    if ma != 0.0 {
        acc.ang -= (b[ao + PX] + rax) * py - (b[ao + PY] + ray) * px;
    }
    if mb != 0.0 {
        acc.ang += (b[bo + PX] + rbx) * py - (b[bo + PY] + rby) * px;
    }
    if ma == 0.0 {
        acc.ex = acc.ex + px;
        acc.ey = acc.ey + py;
    } else if mb == 0.0 {
        acc.ex = acc.ex - px;
        acc.ey = acc.ey - py;
    }
    de
}

/// A contact impulse lambda along (dx, dy) at point p: +B, −A. Tracks energy and the external
/// impulse exactly.
#[inline]
fn apply_contact(b: &mut [f64], pts: &mut [f64], a: usize, bb: usize, po: usize, dx: f64, dy: f64, lambda: f64, acc: &mut Acc) {
    if lambda == 0.0 {
        return;
    }
    let (rax, ray, rbx, rby) = (pts[po + RAX], pts[po + RAY], pts[po + RBX], pts[po + RBY]);
    // apply: before = dot(relVel, dir); P = dir·λ; the same updates as applyLinear; dE = λ(before + after)/2.
    let (bx, by) = rel(b, a, bb, rax, ray, rbx, rby);
    let before = bx * dx + by * dy;
    let px = dx * lambda;
    let py = dy * lambda;
    let (ao, bo) = (a * BS, bb * BS);
    let ma = b[ao + IM];
    let mb = b[bo + IM];
    b[ao + VX] = b[ao + VX] - px * ma;
    b[ao + VY] = b[ao + VY] - py * ma;
    b[ao + W] -= b[ao + II] * (rax * py - ray * px);
    b[bo + VX] = b[bo + VX] + px * mb;
    b[bo + VY] = b[bo + VY] + py * mb;
    b[bo + W] += b[bo + II] * (rbx * py - rby * px);
    let (ax, ay) = rel(b, a, bb, rax, ray, rbx, rby);
    let after = ax * dx + ay * dy;
    let de = (lambda * (before + after)) / 2.0;
    pts[po + EL] -= de;
    acc.ke += de;
    if ma != 0.0 {
        acc.ang -= (b[ao + PX] + rax) * py - (b[ao + PY] + ray) * px;
    }
    if mb != 0.0 {
        acc.ang += (b[bo + PX] + rbx) * py - (b[bo + PY] + rby) * px;
    }
    if ma == 0.0 {
        acc.ex = acc.ex + px;
        acc.ey = acc.ey + py;
    } else if mb == 0.0 {
        acc.ex = acc.ex - px;
        acc.ey = acc.ey - py;
    }
}

#[inline]
fn weld_linear(b: &mut [f64], s: &Weld, px: f64, py: f64, acc: &mut Acc) {
    if px == 0.0 && py == 0.0 {
        return;
    }
    apply_linear(b, s.a, s.b, s.rax, s.ray, s.rbx, s.rby, px, py, acc);
}

#[inline]
fn weld_angular(b: &mut [f64], s: &Weld, l: f64, acc: &mut Acc) {
    if l == 0.0 {
        return;
    }
    let (ao, bo) = (s.a * BS, s.b * BS);
    let before = b[bo + W] - b[ao + W];
    b[ao + W] -= b[ao + II] * l;
    b[bo + W] += b[bo + II] * l;
    let after = b[bo + W] - b[ao + W];
    acc.ke += (l * (before + after)) / 2.0;
    if b[ao + IM] != 0.0 {
        acc.ang -= l;
    }
    if b[bo + IM] != 0.0 {
        acc.ang += l;
    }
}

/// The largest t in [0, 1] that keeps x + t·d within [lo, hi], given x inside it.
#[inline]
fn reach(x: f64, d: f64, lo: f64, hi: f64) -> f64 {
    jmax(0.0, if d > 0.0 && x + d > hi { (hi - x) / d } else if d < 0.0 && x + d < lo { (lo - x) / d } else { 1.0 })
}

/// Solves the point constraint along one direction (dx, dy) only, keeping that component in [lo, hi].
fn slide(b: &mut [f64], s: &mut Weld, dx: f64, dy: f64, lo: f64, hi: f64, acc: &mut Acc) {
    let k = s.k11 * dx * dx + 2.0 * s.k12 * dx * dy + s.k22 * dy * dy;
    if !(k > 0.0) {
        return;
    }
    let (rx, ry) = rel(b, s.a, s.b, s.rax, s.ray, s.rbx, s.rby);
    let c = rx * dx + ry * dy;
    let now = s.px * dx + s.py * dy;
    let next = clamp(now - c / k, lo, hi);
    let step_x = dx * (next - now);
    let step_y = dy * (next - now);
    s.px = s.px + step_x;
    s.py = s.py + step_y;
    weld_linear(b, s, step_x, step_y, acc);
}

/// One pass of the weld solve. A weld carries at most its limits (ASM-003): each accumulated impulse
/// stays inside its limit box. Every update minimises kinetic energy over a convex set that contains
/// the current impulse, so no update can add energy, capped or not. The point constraint is solved
/// as a block, cut short where it would leave the box, then slid along the box's faces by
/// one-direction solves. Taking back a capped weld's excess after the solve instead could create
/// kinetic energy, because the other welds had been solved against the full impulse.
fn solve_welds(b: &mut [f64], welds: &mut [Weld], acc: &mut Acc) {
    for s in welds.iter_mut() {
        let w_rel = b[s.b * BS + W] - b[s.a * BS + W];
        let l = clamp(s.l - w_rel * s.angular_mass, -s.torque, s.torque);
        weld_angular(b, s, l - s.l, acc);
        s.l = l;
        let (cx, cy) = rel(b, s.a, s.b, s.rax, s.ray, s.rbx, s.rby);
        let dpx = -(s.m11 * cx + s.m12 * cy);
        let dpy = -(s.m12 * cx + s.m22 * cy);
        let nx = s.axx;
        let ny = s.axy;
        let tx = -ny;
        let ty = nx;
        let pn = s.px * nx + s.py * ny;
        let pt = s.px * tx + s.py * ty;
        let dn = dpx * nx + dpy * ny;
        let dq = dpx * tx + dpy * ty;
        let f = jmin(reach(pn, dn, s.lo, s.hi), reach(pt, dq, -s.shear, s.shear));
        let step_x = dpx * f;
        let step_y = dpy * f;
        s.px = s.px + step_x;
        s.py = s.py + step_y;
        weld_linear(b, s, step_x, step_y, acc);
        if f < 1.0 {
            let (lo, hi, sh) = (s.lo, s.hi, s.shear);
            slide(b, s, nx, ny, lo, hi, acc);
            slide(b, s, tx, ty, -sh, sh, acc);
        }
    }
}

/// Sets up the nj welds in the buffer for this step (already the ones with both bodies in the solve,
/// not both fixed).
fn prepare_welds(b: &[f64], j: &[f64], welds: &mut [Weld], dt: f64) {
    for (i, s) in welds.iter_mut().enumerate() {
        let o = i * JS;
        let a = j[o + JA] as usize;
        let bb = j[o + JB] as usize;
        let (ao, bo) = (a * BS, bb * BS);
        let (sa, ca) = (b[ao + RS], b[ao + RC]);
        let (sb, cb) = (b[bo + RS], b[bo + RC]);
        let rax = ca * j[o + AAX] - sa * j[o + AAY];
        let ray = sa * j[o + AAX] + ca * j[o + AAY];
        let rbx = cb * j[o + ABX] - sb * j[o + ABY];
        let rby = sb * j[o + ABX] + cb * j[o + ABY];
        let ma = b[ao + IM];
        let mb = b[bo + IM];
        let ia = b[ao + II];
        let ib = b[bo + II];
        let k11 = ma + mb + ia * ray * ray + ib * rby * rby;
        let k12 = -ia * rax * ray - ib * rbx * rby;
        let k22 = ma + mb + ia * rax * rax + ib * rbx * rbx;
        let det = k11 * k22 - k12 * k12;
        let inv = if det != 0.0 { 1.0 / det } else { 0.0 };
        let integ = j[o + INTEG];
        *s = Weld {
            a,
            b: bb,
            rax,
            ray,
            rbx,
            rby,
            m11: inv * k22,
            m12: -inv * k12,
            m22: inv * k11,
            k11,
            k12,
            k22,
            angular_mass: if ia + ib > 0.0 { 1.0 / (ia + ib) } else { 0.0 },
            axx: ca * j[o + AXX] - sa * j[o + AXY],
            axy: sa * j[o + AXX] + ca * j[o + AXY],
            // A damaged weld carries less (DMG-001): its limits scale with its integrity.
            lo: -j[o + TEN] * integ * dt,
            hi: j[o + COMP] * integ * dt,
            shear: j[o + SHR] * integ * dt,
            torque: j[o + TOR] * integ * dt,
            // No warm start: each step's weld impulse starts from zero. Reapplying last step's
            // impulse after the load has changed (an impact ending, thrust cut, gas pressure
            // dropping) made the solve create kinetic energy, up to 19 J in a crash, which the
            // ledger reported. Loads come from this step's impulse anyway (evaluateJoints).
            px: 0.0,
            py: 0.0,
            l: 0.0,
        };
    }
}

/// One solve: contacts warm started from the previous step's impulses if `warm`, then the
/// iterations (welds, then each contact's friction and non-penetration), then restitution.
fn solve_pass(b: &mut [f64], c: &[f64], pts: &mut [f64], welds: &mut [Weld], nc: usize, iterations: u32, dt: f64, warm: bool, ca: &mut Acc, ja: &mut Acc) {
    if warm {
        for ci in 0..nc {
            let o = ci * CS;
            let (a, bb, nx, ny) = (c[o + CA] as usize, c[o + CB] as usize, c[o + CNX], c[o + CNY]);
            let (tx, ty) = (ny, -nx);
            let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
            for p in p0..p0 + np {
                let po = p * PS;
                apply_contact(b, pts, a, bb, po, nx, ny, pts[po + NI], ca);
                apply_contact(b, pts, a, bb, po, tx, ty, pts[po + TI], ca);
            }
        }
    }
    for _ in 0..iterations {
        solve_welds(b, welds, ja);
        for ci in 0..nc {
            let o = ci * CS;
            let (a, bb, nx, ny) = (c[o + CA] as usize, c[o + CB] as usize, c[o + CNX], c[o + CNY]);
            let (tx, ty) = (ny, -nx);
            let friction = c[o + CFR];
            let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
            for p in p0..p0 + np {
                let po = p * PS;
                let (rx, ry) = rel(b, a, bb, pts[po + RAX], pts[po + RAY], pts[po + RBX], pts[po + RBY]);
                // Friction, limited by the current normal impulse (Coulomb).
                let vt = rx * tx + ry * ty;
                let max_f = friction * pts[po + NI];
                let new_t = jmax(-max_f, jmin(max_f, pts[po + TI] - vt * pts[po + TM]));
                apply_contact(b, pts, a, bb, po, tx, ty, new_t - pts[po + TI], ca);
                pts[po + TI] = new_t;
            }
            for p in p0..p0 + np {
                let po = p * PS;
                let (rx, ry) = rel(b, a, bb, pts[po + RAX], pts[po + RAY], pts[po + RBX], pts[po + RBY]);
                // Non-penetration. A positive separation lets the bodies close exactly that gap
                // this step (speculative contact).
                let vn = rx * nx + ry * ny;
                let bias = if pts[po + SEP] > 0.0 { pts[po + SEP] / dt } else { 0.0 };
                let new_n = jmax(0.0, pts[po + NI] - (vn + bias) * pts[po + NM]);
                apply_contact(b, pts, a, bb, po, nx, ny, new_n - pts[po + NI], ca);
                pts[po + NI] = new_n;
                pts[po + MNI] = jmax(pts[po + MNI], new_n);
            }
        }
    }
    // Restitution: contacts that engaged this step leave at −e × their approach speed. This also
    // runs for e = 0, so a speculative impact finishes within one step instead of carrying leftover
    // approach speed into the next step (where the normal has rotated).
    for ci in 0..nc {
        let o = ci * CS;
        let (a, bb, nx, ny) = (c[o + CA] as usize, c[o + CB] as usize, c[o + CNX], c[o + CNY]);
        let restitution = c[o + CRE];
        let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
        for p in p0..p0 + np {
            let po = p * PS;
            if pts[po + VN0] > -RESTITUTION_THRESHOLD || pts[po + MNI] == 0.0 {
                continue;
            }
            let (rx, ry) = rel(b, a, bb, pts[po + RAX], pts[po + RAY], pts[po + RBX], pts[po + RBY]);
            let vn = rx * nx + ry * ny;
            let nm = pts[po + NM];
            let mut new_n = jmax(0.0, pts[po + NI] - (vn + restitution * pts[po + VN0]) * nm);
            // Newton's restitution with friction can add energy in off-centre impacts (Kane's
            // paradox). Cap the extra impulse so this point never returns more energy than it has
            // absorbed this step: the work of impulse λ is λ·vn + λ²/(2·normalMass), which must
            // stay ≤ energyLost.
            let extra = new_n - pts[po + NI];
            if extra > 0.0 && nm > 0.0 {
                let l0 = jmax(0.0, pts[po + EL]);
                let limit = nm * (-vn + (vn * vn + (2.0 * l0) / nm).sqrt());
                if extra > limit {
                    new_n = pts[po + NI] + jmax(0.0, limit);
                }
            }
            apply_contact(b, pts, a, bb, po, nx, ny, new_n - pts[po + NI], ca);
            pts[po + NI] = new_n;
        }
    }
}

/// The velocity solve of one step: welds and contacts by sequential impulses, warm started, solved
/// again from zero if warm starting gained energy, then each weld's impulse (its load) and whether
/// the solver held it at a limit, so it breaks, with the impulse it would have needed: its demand.
#[no_mangle]
pub extern "C" fn solve_velocities(nb: usize, nj: usize, nc: usize, iterations: u32, dt: f64, tol_energy: f64) {
    let s = st();
    let b = &mut s.bodies[..nb * BS];
    let c = &s.contacts[..nc * CS];
    let pts = &mut s.points[..];
    let welds = &mut s.welds[..nj];
    prepare_welds(b, &s.joints, welds, dt);

    // What the solve starts from, in case it runs again.
    let v0 = &mut s.v0[..nb * 3];
    let mut ke0 = 0.0;
    for i in 0..nb {
        let o = i * BS;
        v0[i * 3] = b[o + VX];
        v0[i * 3 + 1] = b[o + VY];
        v0[i * 3 + 2] = b[o + W];
        if b[o + IM] != 0.0 {
            ke0 = ke0 + 0.5 * b[o + MASS] * (b[o + VX] * b[o + VX] + b[o + VY] * b[o + VY]) + 0.5 * b[o + INERTIA] * (b[o + W] * b[o + W]);
        }
    }
    let mut any_warm = false;
    for ci in 0..nc {
        let o = ci * CS;
        let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
        for p in p0..p0 + np {
            if pts[p * PS + NI] != 0.0 || pts[p * PS + TI] != 0.0 {
                any_warm = true;
            }
        }
    }

    let mut ca = Acc::default();
    let mut ja = Acc::default();
    solve_pass(b, c, pts, welds, nc, iterations, dt, true, &mut ca, &mut ja);
    // Every weld and contact update lowers kinetic energy or leaves it, except reapplying contacts'
    // last impulses (warm starting). Iterations usually take that back, but not always: a ship
    // coming apart on a rock gained up to 13 J a step, its contacts adding far more than its welds
    // removed. If the solve gained more than the ledger allows, solve the step again with every
    // contact starting from zero, which can't gain energy.
    let gained = ca.ke + ja.ke;
    let mut retried = 0.0;
    if gained > tol_energy + 1e-5 * ke0 && any_warm {
        retried = 1.0;
        for i in 0..nb {
            let o = i * BS;
            b[o + VX] = v0[i * 3];
            b[o + VY] = v0[i * 3 + 1];
            b[o + W] = v0[i * 3 + 2];
        }
        for ci in 0..nc {
            let o = ci * CS;
            let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
            for p in p0..p0 + np {
                let po = p * PS;
                pts[po + NI] = 0.0;
                pts[po + TI] = 0.0;
                pts[po + MNI] = 0.0;
                pts[po + EL] = 0.0;
            }
        }
        ca = Acc::default();
        ja = Acc::default();
        for w in welds.iter_mut() {
            w.px = 0.0;
            w.py = 0.0;
            w.l = 0.0;
        }
        solve_pass(b, c, pts, welds, nc, iterations, dt, false, &mut ca, &mut ja);
    }

    // Each weld's impulse, and whether the solver held it at a limit, with its demand.
    let j = &mut s.joints;
    let near = |x: f64, limit: f64| x >= limit * (1.0 - 1e-9);
    for (i, w) in welds.iter().enumerate() {
        let o = i * JS;
        j[o + OPX] = w.px;
        j[o + OPY] = w.py;
        j[o + OL] = w.l;
        let axial = w.px * w.axx + w.py * w.axy;
        let capped = near(-axial, -w.lo) || near(axial, w.hi) || near((w.axx * w.py - w.axy * w.px).abs(), w.shear) || near(w.l.abs(), w.torque);
        j[o + OCAP] = if capped { 1.0 } else { 0.0 };
        if capped {
            let (cx, cy) = rel(b, w.a, w.b, w.rax, w.ray, w.rbx, w.rby);
            let w_rel = b[w.b * BS + W] - b[w.a * BS + W];
            j[o + ODX] = w.px - (w.m11 * cx + w.m12 * cy);
            j[o + ODY] = w.py - (w.m12 * cx + w.m22 * cy);
            j[o + ODA] = w.l - w_rel * w.angular_mass;
        }
    }

    s.acc = [ca.ex, ca.ey, ca.ang, ca.ke, ja.ex, ja.ey, ja.ang, ja.ke, retried];
}

// ---------- Position correction ----------

/// Position correction, without touching velocities (non-linear Gauss–Seidel): weld anchors pulled
/// back together and the welded angle restored, then overlapping pairs pushed apart along their
/// normals, four times. Reads and writes the bodies' positions and angles; the welds' a, b, anchors and
/// reference angle; the contacts' bodies, normal and points' local anchors.
#[no_mangle]
pub extern "C" fn correct_positions(nb: usize, nj: usize, nc: usize, slop: f64) {
    let s = st();
    let b = &mut s.bodies[..nb * BS];
    let j = &s.joints[..nj * JS];
    let c = &s.contacts[..nc * CS];
    let pts = &s.points[..];
    for _ in 0..POSITION_ITERATIONS {
        for i in 0..nj {
            let o = i * JS;
            let (ao, bo) = (j[o + JA] as usize * BS, j[o + JB] as usize * BS);
            let ia = b[ao + II];
            let ib = b[bo + II];
            if ia + ib > 0.0 {
                let cc = b[bo + ANG] - b[ao + ANG] - j[o + REF];
                let l = (-JOINT_BAUMGARTE * cc) / (ia + ib);
                b[ao + ANG] -= ia * l;
                b[bo + ANG] += ib * l;
            }
            let (sa, ca) = sin_cos(b[ao + ANG]);
            let (sb, cb) = sin_cos(b[bo + ANG]);
            let rax = ca * j[o + AAX] - sa * j[o + AAY];
            let ray = sa * j[o + AAX] + ca * j[o + AAY];
            let rbx = cb * j[o + ABX] - sb * j[o + ABY];
            let rby = sb * j[o + ABX] + cb * j[o + ABY];
            let cx = b[bo + PX] + rbx - (b[ao + PX] + rax);
            let cy = b[bo + PY] + rby - (b[ao + PY] + ray);
            let ma = b[ao + IM];
            let mb = b[bo + IM];
            let k11 = ma + mb + ia * ray * ray + ib * rby * rby;
            let k12 = -ia * rax * ray - ib * rbx * rby;
            let k22 = ma + mb + ia * rax * rax + ib * rbx * rbx;
            let det = k11 * k22 - k12 * k12;
            if det == 0.0 {
                continue;
            }
            let inv = 1.0 / det;
            let px = -(inv * k22 * cx - inv * k12 * cy) * JOINT_BAUMGARTE;
            let py = -(-inv * k12 * cx + inv * k11 * cy) * JOINT_BAUMGARTE;
            b[ao + PX] = b[ao + PX] - px * ma;
            b[ao + PY] = b[ao + PY] - py * ma;
            b[ao + ANG] -= ia * (rax * py - ray * px);
            b[bo + PX] = b[bo + PX] + px * mb;
            b[bo + PY] = b[bo + PY] + py * mb;
            b[bo + ANG] += ib * (rbx * py - rby * px);
        }
        for ci in 0..nc {
            let o = ci * CS;
            let (ao, bo) = (c[o + CA] as usize * BS, c[o + CB] as usize * BS);
            let (nx, ny) = (c[o + CNX], c[o + CNY]);
            let (p0, np) = (c[o + CP0] as usize, c[o + CNP] as usize);
            for p in p0..p0 + np {
                let po = p * PS;
                let (sa, ca) = sin_cos(b[ao + ANG]);
                let (sb, cb) = sin_cos(b[bo + ANG]);
                let pax = b[ao + PX] + (ca * pts[po + LAX] - sa * pts[po + LAY]);
                let pay = b[ao + PY] + (sa * pts[po + LAX] + ca * pts[po + LAY]);
                let pbx = b[bo + PX] + (cb * pts[po + LBX] - sb * pts[po + LBY]);
                let pby = b[bo + PY] + (sb * pts[po + LBX] + cb * pts[po + LBY]);
                // Across a wrapped world's edge, b's side of the contact is on its copy.
                let (sx, sy) = (c[o + CSX], c[o + CSY]);
                let sep = if sx != 0.0 || sy != 0.0 {
                    (pbx + sx - pax) * nx + (pby + sy - pay) * ny
                } else {
                    (pbx - pax) * nx + (pby - pay) * ny
                };
                let cc = jmax(-MAX_CORRECTION, jmin(0.0, BAUMGARTE * (sep + slop)));
                if cc >= 0.0 {
                    continue;
                }
                let rax = pax - b[ao + PX];
                let ray = pay - b[ao + PY];
                let rbx = pbx - b[bo + PX];
                let rby = pby - b[bo + PY];
                let rna = rax * ny - ray * nx;
                let rnb = rbx * ny - rby * nx;
                let ma = b[ao + IM];
                let mb = b[bo + IM];
                let ia = b[ao + II];
                let ib = b[bo + II];
                let k = ma + mb + ia * rna * rna + ib * rnb * rnb;
                if k <= 0.0 {
                    continue;
                }
                let f = -cc / k;
                let px = nx * f;
                let py = ny * f;
                b[ao + PX] = b[ao + PX] - px * ma;
                b[ao + PY] = b[ao + PY] - py * ma;
                b[ao + ANG] -= ia * (rax * py - ray * px);
                b[bo + PX] = b[bo + PX] + px * mb;
                b[bo + PY] = b[bo + PY] + py * mb;
                b[bo + ANG] += ib * (rbx * py - rby * px);
            }
        }
    }
}
