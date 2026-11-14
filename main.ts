/**
 * food-picture-01 — a single, striking food picture, rendered from pure math.
 *
 * A gourmet cheeseburger, three-quarter view, lit like a studio product shot:
 * warm key light from upper right, soft fill, rim light, contact shadow on a
 * cream backdrop. Everything is an analytic ray/primitive intersection, sampled
 * 2x2 per pixel and written out as a hand-assembled PNG (zlib + CRC32).
 *
 * No files are read, no network, no dependencies. Fully deterministic:
 * every random number comes from a hash of the pixel coordinate.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor per axis

/* ------------------------------------------------------------------ *
 * deterministic random
 * ------------------------------------------------------------------ */

let seed = 1;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm(x: number, y: number, z: number): number {
  return vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.28 +
    vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.12;
}

/* ------------------------------------------------------------------ *
 * materials
 * ------------------------------------------------------------------ */

const M = {
  Bun: 0, Patty: 1, Cheese: 2, Lettuce: 3, Tomato: 4, Seed: 5, Ground: 6,
} as const;

interface Mat {
  color: [number, number, number];
  spec: number;   // specular strength
  shin: number;   // specular exponent
  kind: M;
}

const MATS: Mat[] = [
  { color: [0.44, 0.225, 0.080], spec: 0.80, shin: 46, kind: M.Bun },    // bun
  { color: [0.125, 0.052, 0.024], spec: 0.42, shin: 30, kind: M.Patty }, // patty
  { color: [0.88, 0.40, 0.022], spec: 2.60, shin: 150, kind: M.Cheese }, // cheese
  { color: [0.115, 0.275, 0.032], spec: 1.20, shin: 80, kind: M.Lettuce }, // lettuce
  { color: [0.56, 0.030, 0.020], spec: 2.10, shin: 170, kind: M.Tomato }, // tomato
  { color: [0.78, 0.65, 0.42], spec: 1.60, shin: 110, kind: M.Seed },    // sesame
  { color: [0.44, 0.30, 0.175], spec: 0.05, shin: 8, kind: M.Ground },   // ground
];

/* ------------------------------------------------------------------ *
 * primitives
 * ------------------------------------------------------------------ */

interface Ellip {
  kind: 0;
  cx: number; cy: number; cz: number;
  ax: number; ay: number; az: number;
  ymin: number;          // clip plane (world y), -Infinity = no clip
  r00: number; r01: number; r02: number;  // world-from-local rotation
  r10: number; r11: number; r12: number;
  r20: number; r21: number; r22: number;
  br: number;            // bounding radius
  mat: number;
}

interface Cyl {
  kind: 1;
  cx: number; cz: number;
  y0: number; y1: number;
  rad: number;
  br: number;
  mat: number;
}

type Prim = Ellip | Cyl;

const prims: Prim[] = [];

function identityRot(): number[] {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function addEllip(
  cx: number, cy: number, cz: number,
  ax: number, ay: number, az: number,
  mat: number, ymin = -1e9, rot: number[] = identityRot(),
): void {
  const br = Math.hypot(ax, ay, az);
  prims.push({
    kind: 0, cx, cy, cz, ax, ay, az, ymin, br, mat,
    r00: rot[0], r01: rot[1], r02: rot[2],
    r10: rot[3], r11: rot[4], r12: rot[5],
    r20: rot[6], r21: rot[7], r22: rot[8],
  });
}

function addCyl(cx: number, cz: number, y0: number, y1: number, rad: number, mat: number): void {
  prims.push({ kind: 1, cx, cz, y0, y1, rad, br: Math.hypot(rad, (y1 - y0) * 0.5), mat });
}

/* ---- the burger ------------------------------------------------- */

const BUN_R = 0.96;
const TOP_Y = 0.735;
const TOP_C = 0.79;     // centre of the crown
const TOP_A = 0.485;    // crown half height

function buildScene(): void {
  // bottom bun: squashed dome sitting on the table
  addEllip(0, 0.03, 0, BUN_R, 0.265, BUN_R, M.Bun, 0);
  // beef patty — a thick, slightly irregular grilled puck
  addEllip(0, 0.455, 0, 0.905, 0.215, 0.905, M.Patty);
  addEllip(0.44, 0.40, 0.54, 0.23, 0.17, 0.21, M.Patty);
  addEllip(-0.38, 0.62, 0.62, 0.20, 0.10, 0.18, M.Patty);
  // cheese slice, a touch wider than the patty
  addEllip(0, 0.615, 0, 1.005, 0.05, 1.005, M.Cheese);
  // melted cheese drips down the front
  addEllip(-0.50, 0.545, 0.82, 0.18, 0.155, 0.12, M.Cheese);
  addEllip(0.26, 0.520, 0.93, 0.15, 0.20, 0.11, M.Cheese);
  addEllip(0.76, 0.565, 0.60, 0.12, 0.13, 0.14, M.Cheese);
  // ruffled lettuce: a ring of tilted leaves licking out past the crown
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.35;
    const tilt = 0.30 + 0.16 * Math.sin(i * 2.7);
    const rr = 0.93 + 0.03 * Math.cos(i * 1.9);
    const c = Math.cos(a), sn = Math.sin(a);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // Ry(a) * Rx(tilt): long axis tangential, face tipping outward/down
    const rot = [c, sn * st, sn * ct, 0, ct, -st, -sn, c * st, c * ct];
    addEllip(c * rr, 0.645 + 0.035 * Math.sin(i * 2.1), sn * rr,
      0.34, 0.045, 0.23, M.Lettuce, -1e9, rot);
  }
  // tomato slice edge
  addEllip(0, 0.715, 0, 0.955, 0.042, 0.955, M.Tomato);
  // crown
  addEllip(0, TOP_C, 0, BUN_R, TOP_A, BUN_R, M.Bun, TOP_Y);
  // sesame seeds scattered on the crown
  const N = 62;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const phi = Math.acos(1 - 0.97 * t);      // 0..~1.5 rad from the pole
    const theta = i * 2.39996 + 0.7;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const dx = sp * Math.cos(theta), dy = cp, dz = sp * Math.sin(theta);
    const px = dx * BUN_R, py = TOP_C + dy * TOP_A, pz = dz * BUN_R;
    // surface normal of the ellipsoid
    let nx = dx / BUN_R, ny = dy / TOP_A, nz = dz / BUN_R;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    // orthonormal basis around the normal, with a deterministic spin
    let tx = -nz, ty = 0, tz = nx;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-4) { tx = 1; ty = 0; tz = 0; tl = 1; }
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const spin = i * 1.7;
    const cs = Math.cos(spin), sn2 = Math.sin(spin);
    const axx = tx * cs + bx * sn2, axy = ty * cs + by * sn2, axz = tz * cs + bz * sn2;
    const azx = -tx * sn2 + bx * cs, azy = -ty * sn2 + by * cs, azz = -tz * sn2 + bz * cs;
    const rot = [axx, nx, azx, axy, ny, azy, axz, nz, azz];
    const j = 0.82 + 0.34 * hash3(i, 7, 3);
    addEllip(px, py, pz, 0.060 * j, 0.023 * j, 0.041 * j, M.Seed, -1e9, rot);
  }
  // a couple of loose seeds on the table, for life
  addEllip(-0.72, 0.012, 0.86, 0.05, 0.02, 0.036, M.Seed, 0, [1, 0.3, 0.2, 0, 1, 0, -0.2, 0, 1]);
  addEllip(0.62, 0.012, 0.98, 0.05, 0.02, 0.036, M.Seed, 0, [0.9, 0, -0.4, 0, 1, 0, 0.4, 0, 0.9]);
}

/* ------------------------------------------------------------------ *
 * ray casting
 * ------------------------------------------------------------------ */

let bestT = 0;
let bestId = -1;

function cast(px: number, py: number, pz: number, dx: number, dy: number, dz: number): void {
  bestT = 1e30;
  bestId = -1;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    // bounding sphere reject
    const ocx = px - (p.kind === 0 ? p.cx : p.cx);
    const ocy = py - (p.kind === 0 ? p.cy : (p.y0 + p.y1) * 0.5);
    const ocz = pz - p.cz;
    const b = ocx * dx + ocy * dy + ocz * dz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - p.br * p.br;
    const disc = b * b - c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 1e-4) t = -b + sq;
    if (t < 1e-4 || t >= bestT) continue;

    if (p.kind === 0) {
      // into unit-sphere space
      const lox = px - p.cx, loy = py - p.cy, loz = pz - p.cz;
      const ox = (p.r00 * lox + p.r10 * loy + p.r20 * loz) / p.ax;
      const oy = (p.r01 * lox + p.r11 * loy + p.r21 * loz) / p.ay;
      const oz = (p.r02 * lox + p.r12 * loy + p.r22 * loz) / p.az;
      const idx = (p.r00 * dx + p.r10 * dy + p.r20 * dz) / p.ax;
      const idy = (p.r01 * dx + p.r11 * dy + p.r21 * dz) / p.ay;
      const idz = (p.r02 * dx + p.r12 * dy + p.r22 * dz) / p.az;
      const a = idx * idx + idy * idy + idz * idz;
      const bb = 2 * (ox * idx + oy * idy + oz * idz);
      const cc = ox * ox + oy * oy + oz * oz - 1;
      const d2 = bb * bb - 4 * a * cc;
      if (d2 < 0) continue;
      const s2 = Math.sqrt(d2);
      let tt = (-bb - s2) / (2 * a);
      if (tt < 1e-4) tt = (-bb + s2) / (2 * a);
      if (tt < 1e-4) continue;
      // clip plane (world y)
      const hy = py + tt * dy;
      if (hy < p.ymin) continue;
      if (tt < bestT) { bestT = tt; bestId = i; }
    } else {
      const ox = px - p.cx, oz = pz - p.cz;
      const a = dx * dx + dz * dz;
      if (a < 1e-12) continue;
      const bb = 2 * (ox * dx + oz * dz);
      const cc = ox * ox + oz * oz - p.rad * p.rad;
      const d2 = bb * bb - 4 * a * cc;
      if (d2 < 0) continue;
      const s2 = Math.sqrt(d2);
      let tt = (-bb - s2) / (2 * a);
      if (tt < 1e-4) tt = (-bb + s2) / (2 * a);
      if (tt < 1e-4) continue;
      const hy = py + tt * dy;
      if (hy < p.y0 || hy > p.y1) continue;
      if (tt < bestT) { bestT = tt; bestId = i; }
    }
  }
  // ground plane y = 0
  if (dy < -1e-6) {
    const t = -py / dy;
    if (t > 1e-4 && t < bestT) { bestT = t; bestId = -2; }
  }
}

function normalAt(px: number, py: number, pz: number, out: number[]): void {
  const id = bestId;
  if (id === -2) { out[0] = 0; out[1] = 1; out[2] = 0; return; }
  const p = prims[id];
  if (p.kind === 1) {
    // cylinder: radial normal, with a slight rounded shoulder near the caps
    const ox = px - p.cx, oz = pz - p.cz;
    const l = Math.hypot(ox, oz) || 1;
    out[0] = ox / l; out[1] = 0; out[2] = oz / l;
    return;
  }
  const lox = px - p.cx, loy = py - p.cy, loz = pz - p.cz;
  const qx = (p.r00 * lox + p.r10 * loy + p.r20 * loz) / p.ax;
  const qy = (p.r01 * lox + p.r11 * loy + p.r21 * loz) / p.ay;
  const qz = (p.r02 * lox + p.r12 * loy + p.r22 * loz) / p.az;
  let nx = qx / p.ax, ny = qy / p.ay, nz = qz / p.az;
  // world space
  const wx = p.r00 * nx + p.r01 * ny + p.r02 * nz;
  const wy = p.r10 * nx + p.r11 * ny + p.r12 * nz;
  const wz = p.r20 * nx + p.r21 * ny + p.r22 * nz;
  const l = Math.hypot(wx, wy, wz) || 1;
  out[0] = wx / l; out[1] = wy / l; out[2] = wz / l;
}

/* ------------------------------------------------------------------ *
 * lighting
 * ------------------------------------------------------------------ */

const KEY: [number, number, number] = [-2.30, 3.10, -1.45];
const KEY_R = 0.52;
const KEY_COL: [number, number, number] = [1.0, 0.90, 0.76];
const KEY_I = 2.30;

const FILL_DIR: [number, number, number] = [0.34, 0.30, 0.89];
const FILL_COL: [number, number, number] = [0.92, 0.88, 0.84];
const FILL_I = 0.46;

const RIM_DIR: [number, number, number] = [0.80, 0.34, -0.50];
const RIM_COL: [number, number, number] = [1.0, 0.87, 0.70];
const RIM_I = 0.70;

const AMB_SKY: [number, number, number] = [0.10, 0.095, 0.09];
const AMB_GND: [number, number, number] = [0.085, 0.058, 0.036];

function occluded(px: number, py: number, pz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  cast(px, py, pz, dx, dy, dz);
  return bestId !== -1 && bestT < maxT;
}

const aoN: number[] = [0, 0, 0];
const aoT: number[] = [0, 0, 0];
const aoB: number[] = [0, 0, 0];

/** three short rays around the normal: cheap ambient occlusion for the crevices */
function ambientOcclusion(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  const ox = px + nx * 0.006, oy = py + ny * 0.006, oz = pz + nz * 0.006;
  let tx = -nz, ty = 0, tz = nx;
  let tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-4) { tx = 1; ty = 0; tz = 0; tl = 1; }
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const D = 0.26;
  let open = 0;
  if (!occluded(ox, oy, oz, nx, ny, nz, D)) open += 1;
  for (let k = 0; k < 2; k++) {
    const sgn = k === 0 ? 1 : -1;
    let dx = nx + (k === 0 ? tx : bx) * 0.85 * sgn;
    let dy = ny + (k === 0 ? ty : by) * 0.85 * sgn;
    let dz = nz + (k === 0 ? tz : bz) * 0.85 * sgn;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    if (!occluded(ox, oy, oz, dx, dy, dz, D)) open += 1;
  }
  return 0.35 + 0.65 * (open / 3);
}

const nrm: number[] = [0, 0, 0];

function shade(px: number, py: number, pz: number, dx: number, dy: number, dz: number): number[] {
  const id = bestId;
  const mat = MATS[id === -2 ? M.Ground : prims[id].mat];
  normalAt(px, py, pz, nrm);
  let nx = nrm[0], ny = nrm[1], nz = nrm[2];

  // --- procedural surface variation -------------------------------
  let r = mat.color[0], g = mat.color[1], b = mat.color[2];
  let specMul = mat.spec;

  if (mat.kind === M.Bun) {
    // toasted top, paler sides
    const toast = Math.max(0, ny) * 0.9 + fbm(px * 5, py * 5, pz * 5) * 0.35;
    const k = 0.74 + 0.38 * toast;
    r *= k * 1.05; g *= k * 0.94; b *= k * 0.78;
    // floury speckles
    const sp = vnoise(px * 60, py * 60, pz * 60);
    if (sp > 0.86) { const q = (sp - 0.86) * 2.2; r += q * 0.18; g += q * 0.16; b += q * 0.11; }
  } else if (mat.kind === M.Patty) {
    const n = fbm(px * 9, py * 9, pz * 9);
    const char_ = fbm(px * 22 + 4, py * 22, pz * 22);
    const k = 0.72 + 0.62 * n;
    r *= k * 1.06; g *= k; b *= k * 0.92;
    if (char_ > 0.66) { const q = Math.min(1, (char_ - 0.66) * 3.0); r *= 1 - 0.55 * q; g *= 1 - 0.6 * q; b *= 1 - 0.6 * q; }
    // bumpy grilled normal
    const e = 0.02;
    const h0 = fbm(px * 16, py * 16, pz * 16);
    const hx = fbm((px + e) * 16, py * 16, pz * 16);
    const hz = fbm(px * 16, py * 16, (pz + e) * 16);
    nx += (h0 - hx) * 2.4; nz += (h0 - hz) * 2.4;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
  } else if (mat.kind === M.Lettuce) {
    const n = fbm(px * 11, py * 11, pz * 11);
    const k = 0.7 + 0.75 * n;
    r *= k * 0.85; g *= k * 1.1; b *= k * 0.75;
    // veins: brighter, waxy highlights along the leaf
    const vein = vnoise(px * 30, py * 30 + 9, pz * 30);
    if (vein > 0.7) { const q = (vein - 0.7) * 1.6; g += q * 0.22; r += q * 0.08; }
    specMul *= 1.2;
  } else if (mat.kind === M.Tomato) {
    const n = vnoise(px * 18, py * 18, pz * 18);
    r *= 0.8 + 0.5 * n; g *= 0.8 + 0.4 * n; b *= 0.8 + 0.4 * n;
  } else if (mat.kind === M.Cheese) {
    const n = fbm(px * 7 + 11, py * 7, pz * 7);
    const k = 0.86 + 0.28 * n;
    r *= k; g *= k * 0.97; b *= k * 0.8;
  } else if (mat.kind === M.Ground) {
    // warm studio sweep with a soft pool of light
    const rad = Math.hypot(px, pz);
    const pool = Math.exp(-rad * rad * 0.11);
    const grain = fbm(px * 30, 0, pz * 30) * 0.06;
    const k = 0.72 + 0.42 * pool + grain;
    r *= k * 1.02; g *= k * 0.98; b *= k * 0.9;
    // contact darkening where the burger meets the table
    const cd = Math.max(0, rad - 0.82);
    const ao = 1 - 0.62 * Math.exp(-cd * 3.6);
    // directional soft cast shadow, thrown away from the key light
    const sx = px - 0.86, sz = pz - 0.54;
    const along = sx * 0.846 + sz * 0.533;
    const across = -sx * 0.533 + sz * 0.846;
    const sd = Math.hypot(along / 1.42, across / 0.98);
    const st = Math.max(0, Math.min(1, (sd - 0.42) / 0.98));
    const cast = 1 - 0.44 * (1 - st * st * (3 - 2 * st));
    const shadeK = ao * cast;
    r *= shadeK; g *= shadeK; b *= shadeK;
  } else if (mat.kind === M.Seed) {
    const n = fbm(px * 40, py * 40, pz * 40);
    const k = 0.85 + 0.3 * n;
    r *= k; g *= k; b *= k;
  }

  // --- key light: soft area light (jittered samples for the penumbra),
  //     with the specular taken from the light centre so the glint stays crisp
  let diff = 0;
  const NS = 3;
  const ox0 = px + nx * 0.004, oy0 = py + ny * 0.004, oz0 = pz + nz * 0.004;
  for (let s = 0; s < NS; s++) {
    const a1 = rnd() * 2 - 1;
    const a2 = rnd() * 2 - 1;
    const rr = Math.sqrt(a1 * a1 + a2 * a2);
    let jx = 0, jz = 0;
    if (rr > 1e-4 && rr < 1) {
      const sc = (KEY_R / rr) * 0.98;
      jx = a1 * sc; jz = a2 * sc;
    }
    let lx = KEY[0] + jx - px, ly = KEY[1] - py, lz = KEY[2] + jz - pz;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const ndl = nx * lx + ny * ly + nz * lz;
    if (ndl <= 0) continue;
    if (occluded(ox0, oy0, oz0, lx, ly, lz, ll - 0.02)) continue;
    diff += ndl;
  }
  diff /= NS;

  // specular from the centre of the key light
  let lx = KEY[0] - px, ly = KEY[1] - py, lz = KEY[2] - pz;
  const ll = Math.hypot(lx, ly, lz) || 1;
  lx /= ll; ly /= ll; lz /= ll;
  const ndlC = nx * lx + ny * ly + nz * lz;
  let spec = 0;
  if (ndlC > 0 && !occluded(ox0, oy0, oz0, lx, ly, lz, ll - 0.02)) {
    let hx = lx - dx, hy = ly - dy, hz = lz - dz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    hx /= hl; hy /= hl; hz /= hl;
    const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
    const tight = Math.pow(ndh, mat.shin);
    const sheen = Math.pow(ndh, mat.shin * 0.16) * 0.10;
    spec = tight + sheen;
  }

  const keyW = diff * KEY_I;

  // --- fill + rim (cheap directional, no shadow) --------------------
  const aoF = ambientOcclusion(px, py, pz, nx, ny, nz);
  const fndl = Math.max(0, nx * FILL_DIR[0] + ny * FILL_DIR[1] + nz * FILL_DIR[2]) * aoF;
  const rndl = Math.max(0, nx * RIM_DIR[0] + ny * RIM_DIR[1] + nz * RIM_DIR[2]);
  const rimp = Math.pow(rndl, 24) * RIM_I * 0.6;

  // --- glossy rim glint: Fresnel-weighted specular from the rim light.
  //     Only bites where the surface turns away from the camera, so it draws
  //     bright edge highlights on the bun, cheese and tomato without
  //     washing out the faces pointing at the key light.
  let rimSpec = 0;
  if (rndl > 0) {
    let rhx = RIM_DIR[0] - dx, rhy = RIM_DIR[1] - dy, rhz = RIM_DIR[2] - dz;
    const rhl = Math.hypot(rhx, rhy, rhz) || 1;
    rhx /= rhl; rhy /= rhl; rhz /= rhl;
    const rndh = Math.max(0, nx * rhx + ny * rhy + nz * rhz);
    const facing = Math.max(0, nx * dx + ny * dy + nz * dz);
    const fres = Math.pow(1 - facing, 4);
    rimSpec = Math.pow(rndh, mat.shin) * (0.18 + 0.82 * fres) * RIM_I;
  }

  // --- ambient hemisphere, occluded --------------------------------
  const up = ny * 0.5 + 0.5;
  const ar = (AMB_GND[0] + (AMB_SKY[0] - AMB_GND[0]) * up) * aoF;
  const ag = (AMB_GND[1] + (AMB_SKY[1] - AMB_GND[1]) * up) * aoF;
  const ab = (AMB_GND[2] + (AMB_SKY[2] - AMB_GND[2]) * up) * aoF;

  const specW = spec * specMul * KEY_I;
  const rimW = rimSpec * specMul;
  const outR = r * (keyW * KEY_COL[0] + fndl * FILL_I * FILL_COL[0] + rndl * RIM_I * RIM_COL[0] + ar) +
    specW * KEY_COL[0] * (0.55 + 0.45 * r) + rimW * RIM_COL[0] * (0.6 + 0.4 * r) + rimp * KEY_COL[0];
  const outG = g * (keyW * KEY_COL[1] + fndl * FILL_I * FILL_COL[1] + rndl * RIM_I * RIM_COL[1] + ag) +
    specW * KEY_COL[1] * (0.55 + 0.45 * g) + rimW * RIM_COL[1] * (0.6 + 0.4 * g) + rimp * KEY_COL[1];
  const outB = b * (keyW * KEY_COL[2] + fndl * FILL_I * FILL_COL[2] + rndl * RIM_I * RIM_COL[2] + ab) +
    specW * KEY_COL[2] * (0.55 + 0.45 * b) + rimW * RIM_COL[2] * (0.6 + 0.4 * b) + rimp * KEY_COL[2];

  return [outR, outG, outB];
}

/* ------------------------------------------------------------------ *
 * camera
 * ------------------------------------------------------------------ */

const CAM: [number, number, number] = [0.45, 1.90, 4.55];
const TARGET: [number, number, number] = [0.0, 0.36, 0.0];
const FOV = 30 * Math.PI / 180;

interface Basis {
  fx: number; fy: number; fz: number;
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  focal: number;
}

function cameraBasis(): Basis {
  let fx = TARGET[0] - CAM[0], fy = TARGET[1] - CAM[1], fz = TARGET[2] - CAM[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  // right = normalize(cross(forward, worldUp)) with worldUp = (0,1,0)
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl; ry /= rl; rz /= rl;
  // up = cross(right, forward)
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  return { fx, fy, fz, rx, ry, rz, ux, uy, uz, focal: 1 / Math.tan(FOV / 2) };
}

function rayDir(b: Basis, u: number, v: number, out: number[]): void {
  const dx = b.fx * b.focal + b.rx * u + b.ux * v;
  const dy = b.fy * b.focal + b.ry * u + b.uy * v;
  const dz = b.fz * b.focal + b.rz * u + b.uz * v;
  const dl = Math.hypot(dx, dy, dz);
  out[0] = dx / dl; out[1] = dy / dl; out[2] = dz / dl;
}

const rd: number[] = [0, 0, 0];
const bg: number[] = [0, 0, 0];

/** Warm cream studio sweep seen behind/above the set. */
function backdrop(dy: number, u: number, v: number, out: number[]): void {
  const t = Math.max(0, Math.min(1, dy * 1.5 + 0.42));
  const glow = Math.exp(-(u * u * 0.55 + (v - 0.35) * (v - 0.35) * 0.9));
  out[0] = 0.395 + 0.14 * t + 0.115 * glow;
  out[1] = 0.278 + 0.115 * t + 0.095 * glow;
  out[2] = 0.152 + 0.085 * t + 0.065 * glow;
}

function render(): Buffer {
  const b = cameraBasis();
  const out = Buffer.alloc(W * H * 3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
      let ar = 0, ag = 0, ab = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const jx = (sx + rnd()) / SS;
          const jy = (sy + rnd()) / SS;
          const u = ((x + jx) / W) * 2 - 1;
          const v = 1 - ((y + jy) / H) * 2;
          rayDir(b, u, v, rd);
          const dx = rd[0], dy = rd[1], dz = rd[2];
          cast(CAM[0], CAM[1], CAM[2], dx, dy, dz);
          backdrop(dy, u, v, bg);
          if (bestId === -1) {
            ar += bg[0]; ag += bg[1]; ab += bg[2];
          } else {
            const hitT = bestT;
            const hx = CAM[0] + dx * hitT;
            const hy = CAM[1] + dy * hitT;
            const hz = CAM[2] + dz * hitT;
            const c = shade(hx, hy, hz, dx, dy, dz);
            // distance haze melts the far floor into the backdrop (cyclorama)
            const fog = Math.min(1, Math.max(0, (hitT - 7) / 22));
            const fg = fog * fog * (3 - 2 * fog);
            ar += c[0] + (bg[0] - c[0]) * fg;
            ag += c[1] + (bg[1] - c[1]) * fg;
            ab += c[2] + (bg[2] - c[2]) * fg;
          }
        }
      }
      const inv = 1 / (SS * SS);
      let cr = ar * inv, cg = ag * inv, cb = ab * inv;
      // gentle vignette
      const vx = (x / W - 0.5) * 2, vy = (y / H - 0.5) * 2;
      const vig = 1 - 0.30 * (vx * vx * 0.55 + vy * vy * 0.72);
      cr *= vig; cg *= vig; cb *= vig;
      // filmic tonemap on luminance (keeps the chroma, so the food stays vivid)
      const o = (y * W + x) * 3;
      const L = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      const Lc = aces(L * 1.12);
      const k = Lc / Math.max(L, 1e-4);
      // a touch of vibrance around the luminance
      const vib = 1.10;
      out[o] = toByte(softClip((L + (cr - L) * vib) * k));
      out[o + 1] = toByte(softClip((L + (cg - L) * vib) * k));
      out[o + 2] = toByte(softClip((L + (cb - L) * vib) * k));
    }
  }
  return out;
}

function aces(x: number): number {
  const v = Math.max(0, x);
  const t = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  return Math.pow(Math.min(1, t), 1 / 2.2);
}

/** filmic shoulder on each channel so the brightest glints roll off softly */
function softClip(x: number): number {
  const v = Math.max(0, x);
  const t = v <= 0.72 ? v : 0.72 + 0.28 * (1 - Math.exp(-(v - 0.72) / 0.28));
  return Math.pow(Math.min(1, t), 1 / 2.2) * 255;
}

function toByte(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x)));
}

/* ------------------------------------------------------------------ *
 * PNG (hand-rolled: IHDR / IDAT / IEND, table CRC32, adaptive filters)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  const body = Buffer.concat([t, Buffer.from(data)]);
  crc.writeUInt32BE(crc32(body, 0, body.length), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgb: Buffer): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc((stride + 1) * H);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const cand: Buffer[] = [];
  for (let i = 0; i < 5; i++) cand.push(Buffer.alloc(stride));

  for (let y = 0; y < H; y++) {
    rgb.copy(cur, 0, y * stride, (y + 1) * stride);
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0;
        const b = prev[i];
        const cc = i >= 3 ? prev[i - 3] : 0;
        let v: number;
        if (f === 0) v = cur[i];
        else if (f === 1) v = cur[i] - a;
        else if (f === 2) v = cur[i] - b;
        else if (f === 3) v = cur[i] - ((a + b) >> 1);
        else {
          const p = a + b - cc;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
          v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
        }
        c[i] = v & 0xff;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    cur.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/* ------------------------------------------------------------------ */

buildScene();

if (process.env.DEBUG_MAP) {
  const b = cameraBasis();
  const CH = 44, CW = 76;
  const chars = 'BPCLTSG';
  const lines: string[] = [];
  for (let cy = 0; cy < CH; cy++) {
    let s = '';
    for (let cx = 0; cx < CW; cx++) {
      const u = ((cx + 0.5) / CW) * 2 - 1;
      const v = 1 - ((cy + 0.5) / CH) * 2;
      rayDir(b, u, v, rd);
      cast(CAM[0], CAM[1], CAM[2], rd[0], rd[1], rd[2]);
      if (bestId === -1) s += ' ';
      else if (bestId === -2) s += '.';
      else s += chars[prims[bestId].mat];
    }
    lines.push(s);
  }
  console.log(lines.join('\n'));
  const b2 = cameraBasis();
  const dirs: string[] = [];
  for (let cy = 0; cy < CH; cy++) {
    let s = '';
    for (let cx = 0; cx < CW; cx++) {
      const u = ((cx + 0.5) / CW) * 2 - 1;
      const v = 1 - ((cy + 0.5) / CH) * 2;
      rayDir(b2, u, v, rd);
      cast(CAM[0], CAM[1], CAM[2], rd[0], rd[1], rd[2]);
      s += bestId === -1 ? ' ' : bestId === -2 ? (bestT > 6 ? '~' : '-') : '#';
    }
    dirs.push(s);
  }
  console.log('\n' + dirs.join('\n'));
  // depth map: closer = darker, reveals floating / intersecting parts
  const ramp2 = '@%#*+=-:. ';
  const dep: string[] = [];
  for (let cy = 0; cy < CH; cy++) {
    let s2 = '';
    for (let cx = 0; cx < CW; cx++) {
      const u2 = ((cx + 0.5) / CW) * 2 - 1;
      const v2 = 1 - ((cy + 0.5) / CH) * 2;
      rayDir(b, u2, v2, rd);
      cast(CAM[0], CAM[1], CAM[2], rd[0], rd[1], rd[2]);
      const d = bestId === -1 ? 99 : bestT;
      s2 += ramp2[Math.max(0, Math.min(9, Math.round((d - 3.4) / 1.1)))];
    }
    dep.push(s2);
  }
  console.log('\n' + dep.join('\n'));
  process.exit(0);
}

const img = render();
const png = encodePNG(img);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const path = join(outDir, 'entry.png');
const t0 = Date.now();
writeFileSync(path, png);
console.log(`${path} ${W}x${H} ${(png.length / 1024).toFixed(1)} KiB in ${Date.now() - t0} ms`);