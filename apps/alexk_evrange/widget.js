'use strict';
/**
 * Shaders and geometry of the cluster widget (GLSL ES 1.00, effect layers of cluster-render).
 *  - TEXT_FS : "37km/82%" in 7-segment digits (u_km, u_pc = vec4(d0, d1, d2, n); digit 11 = dash)
 *  - GAUGE_FS: a band imitating the original eDrive indicator, traced from a photo
 * Everything is drawn in "height units" (the strip is 1 high, u_aspect wide).
 */

/* ---------------- text strip ---------------- */
const TEXT_FS = [
  'precision mediump float;',
  'varying vec2 v_uv;',
  'uniform vec4 u_km;',
  'uniform vec4 u_pc;',
  'uniform float u_aspect;',
  'uniform float u_px;',
  'uniform float u_right;',   // 1: the text ends at the strip's right edge
  'float mask(float d) {',
  '  if (d < 0.5) return 63.0;',
  '  if (d < 1.5) return 6.0;',
  '  if (d < 2.5) return 91.0;',
  '  if (d < 3.5) return 79.0;',
  '  if (d < 4.5) return 102.0;',
  '  if (d < 5.5) return 109.0;',
  '  if (d < 6.5) return 125.0;',
  '  if (d < 7.5) return 7.0;',
  '  if (d < 8.5) return 127.0;',
  '  if (d < 9.5) return 111.0;',
  '  if (d < 10.5) return 0.0;',
  '  return 64.0;',
  '}',
  'float bit(float m, float s) { return mod(floor(m / pow(2.0, s)), 2.0); }',
  'float box(vec2 p, vec2 lo, vec2 hi) {',
  '  return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y);',
  '}',
  'float digit(vec2 p, float d) {',
  '  float m = mask(d);',
  '  float tx = 0.24;',
  '  float ty = 0.12;',
  '  float on = 0.0;',
  '  on += bit(m, 0.0) * box(p, vec2(0.0, 0.0), vec2(1.0, ty));',
  '  on += bit(m, 1.0) * box(p, vec2(1.0 - tx, 0.0), vec2(1.0, 0.5 + ty * 0.5));',
  '  on += bit(m, 2.0) * box(p, vec2(1.0 - tx, 0.5 - ty * 0.5), vec2(1.0, 1.0));',
  '  on += bit(m, 3.0) * box(p, vec2(0.0, 1.0 - ty), vec2(1.0, 1.0));',
  '  on += bit(m, 4.0) * box(p, vec2(0.0, 0.5 - ty * 0.5), vec2(tx, 1.0));',
  '  on += bit(m, 5.0) * box(p, vec2(0.0, 0.0), vec2(tx, 0.5 + ty * 0.5));',
  '  on += bit(m, 6.0) * box(p, vec2(0.0, 0.5 - ty * 0.5), vec2(1.0, 0.5 + ty * 0.5));',
  '  return clamp(on, 0.0, 1.0);',
  '}',
  'float digitOf(vec4 u, float j) {',
  '  if (j < 0.5) return u.x;',
  '  if (j < 1.5) return u.y;',
  '  return u.z;',
  '}',
  'float numAt(vec2 p, float x0, vec4 u) {',
  '  float a = 0.0;',
  '  for (int i = 0; i < 3; i++) {',
  '    float j = float(i);',
  '    if (j < u.w) {',
  '      vec2 q = vec2((p.x - (x0 + j * 0.62)) / 0.5, p.y);',
  '      if (q.x >= 0.0 && q.x <= 1.0) a = max(a, digit(q, digitOf(u, j)));',
  '    }',
  '  }',
  '  return a;',
  '}',
  'float seg(vec2 p, vec2 a, vec2 b, float w) {',
  '  vec2 pa = p - a;',
  '  vec2 ba = b - a;',
  '  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
  '  float d = length(pa - ba * h);',
  '  return 1.0 - smoothstep(w - u_px, w + u_px, d);',
  '}',
  'float ring(vec2 p, vec2 c, float r, float w) {',
  '  float d = abs(length(p - c) - r);',
  '  return 1.0 - smoothstep(w - u_px, w + u_px, d);',
  '}',
  'void main() {',
  '  vec3 cKm = vec3(1.00, 1.00, 1.00);',
  '  vec3 cPc = vec3(0.86, 0.88, 0.90);',
  '  vec3 cDim = vec3(0.80, 0.80, 0.80);',
  '  float wKm = u_km.w * 0.62;',
  '  float ux = wKm + 0.05;',
  '  float sx = ux + 0.66 + 0.12;',
  '  float px0 = sx + 0.35 + 0.12;',
  '  float wPc = u_pc.w * 0.62;',
  '  float qx = px0 + wPc + 0.05;',
  '  float total = qx + 0.40;',
  '  float shift = max(u_aspect - total, 0.0) * u_right;',
  '  vec2 p = vec2(v_uv.x * u_aspect - shift, v_uv.y);',
  '  float aKm = numAt(p, 0.0, u_km);',
  '  float aPc = numAt(p, px0, u_pc);',
  '  float aU = 0.0;',
  '  aU = max(aU, seg(p, vec2(ux + 0.03, 0.60), vec2(ux + 0.03, 1.0), 0.035));',
  '  aU = max(aU, seg(p, vec2(ux + 0.26, 0.68), vec2(ux + 0.03, 0.85), 0.035));',
  '  aU = max(aU, seg(p, vec2(ux + 0.10, 0.80), vec2(ux + 0.26, 1.0), 0.035));',
  '  float mx = ux + 0.34;',
  '  aU = max(aU, seg(p, vec2(mx + 0.03, 0.70), vec2(mx + 0.29, 0.70), 0.035));',
  '  aU = max(aU, seg(p, vec2(mx + 0.03, 0.70), vec2(mx + 0.03, 1.0), 0.035));',
  '  aU = max(aU, seg(p, vec2(mx + 0.16, 0.70), vec2(mx + 0.16, 1.0), 0.035));',
  '  aU = max(aU, seg(p, vec2(mx + 0.29, 0.70), vec2(mx + 0.29, 1.0), 0.035));',
  '  float aS = seg(p, vec2(sx + 0.30, 0.05), vec2(sx + 0.05, 0.95), 0.04);',
  '  float aP = 0.0;',
  '  aP = max(aP, ring(p, vec2(qx + 0.09, 0.69), 0.06, 0.03));',
  '  aP = max(aP, ring(p, vec2(qx + 0.31, 0.91), 0.06, 0.03));',
  '  aP = max(aP, seg(p, vec2(qx + 0.34, 0.60), vec2(qx + 0.06, 1.0), 0.03));',
  '  float aPP = max(aPc, aP);',
  '  float aUS = max(aU, aS);',
  '  float a = max(aKm, max(aPP, aUS));',
  '  vec3 col = cKm * aKm + cPc * aPP + cDim * aUS;',
  '  col = col / max(aKm + aPP + aUS, 0.001);',
  '  gl_FragColor = vec4(col, a);',
  '}'
].join('\n');

/* ---------------- gauge band ---------------- */
/*
 * Imitates the small gauges of the M theme (the fuel gauge, the coolant gauge): a double white outline
 * (thick outer, thin inner), small ticks on the outer line, a pale lit fill inside that follows the charge,
 * a red level line at the present charge, wide italic labels 0 / 50 / 100 on thin leader lines, and a mini battery.
 * The arc's centre line is a traced curve (GP), in px of a 783x846 crop (846 = 1 height unit).
 */
const GP_RAW = [[205, 592], [270, 608], [330, 611], [395, 602], [455, 578], [505, 538], [550, 488],
    [585, 432], [615, 372], [636, 312], [644, 250], [636, 190], [612, 138], [572, 102]];
const GP_RAW_NOTCH = 7;  // the raw point that is the 50 % tick
const SUB = 2;           // smooth: each raw segment becomes SUB segments (Catmull-Rom)
const GP = (() => {
    const P = GP_RAW, out = [];
    const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
    for (let i = 0; i < P.length - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let k = 0; k < SUB; k++) {
            const t = k / SUB, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map((j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
        }
    }
    out.push(P[P.length - 1].slice());
    return out;
})();
const GP_NOTCH = GP_RAW_NOTCH * SUB;      // the point that is the 50 % tick
const GP_SIGN = -1.0;    // which side of the curve is the inside
const GAUGE_ASPECT = 783 / 846;

const GI = (() => {
    const cum = [0];
    for (let i = 1; i < GP.length; i++) cum.push(cum[i - 1] + Math.hypot((GP[i][0] - GP[i - 1][0]) / 846, (GP[i][1] - GP[i - 1][1]) / 846));
    const total = cum[cum.length - 1];
    return { cum, total, s50: cum[GP_NOTCH] / total };
})();

/** charge 0..1 -> position along the band 0..1 (the 50 % tick is at s50) */
function chargeToS(f) {
    return Math.max(0, Math.min(1, f));      // linear along the arc: 50 % is exactly halfway
}

/** point (px) and inward unit normal at position s (0..1) along the arc */
function arcAt(s) {
    const t = s * GI.total * 846;           // px along the curve
    let acc = 0;
    for (let i = 1; i < GP.length; i++) {
        const dx = GP[i][0] - GP[i - 1][0], dy = GP[i][1] - GP[i - 1][1], L = Math.hypot(dx, dy);
        if (t <= acc + L || i === GP.length - 1) {
            const h = Math.max(0, Math.min(1, (t - acc) / L));
            return { x: GP[i - 1][0] + dx * h, y: GP[i - 1][1] + dy * h, nx: dy / L, ny: -dx / L };
        }
        acc += L;
    }
}

/* glyphs of the labels: wide, squared, leaning right (like the M cluster's font). Polylines in a 0..1 box, y down. */
const GLYPH = {
    '0': [[[.24, 0], [.76, 0], [1, .2], [1, .8], [.76, 1], [.24, 1], [0, .8], [0, .2], [.24, 0]]],
    '1': [[[.14, .26], [.64, 0], [.64, 1]]],
    '5': [[[.92, 0], [.12, 0], [.08, .46], [.62, .40], [.94, .62], [.84, .92], [.52, 1], [.08, .88]]],
};
const SHEAR = 0.20;
const GL_W = 38, GL_H = 54, GL_GAP = 9, GL_SW = 6.0;   // glyph size, gap, stroke (px of the crop)

/* what is baked into the shader (px of the crop) */
const LABELS = [[0, '0', 0], [0.5, '50', 26], [1, '100', 0]];   // [charge, text, nudge down in px]
const LAYOUT = LABELS.map(([f, txt, nudge]) => {
    const a = arcAt(chargeToS(f));
    const L = 50;                                         // leader length
    const ex = a.x + a.nx * L, ey = a.y + a.ny * L;       // leader end
    const w = txt.length * GL_W + (txt.length - 1) * GL_GAP;
    const ext = Math.abs(a.nx) * w / 2 + Math.abs(a.ny) * GL_H / 2 + 7;   // label centre: beyond the leader's end
    const cx = ex + a.nx * ext, cy = ey + a.ny * ext;
    return { f, txt, ax: a.x, ay: a.y, ex, ey, lx: Math.round(cx - w / 2), ly: Math.round(cy - GL_H / 2 + nudge) };
});
const TICKS = [];          // [x0, y0, x1, y1, width]
for (let k = 0; k <= 10; k++) {
    const a = arcAt(chargeToS(k / 10));
    if (k % 5 === 0) TICKS.push([a.x - a.nx * 15, a.y - a.ny * 15, a.x + a.nx * 34, a.y + a.ny * 34, 4.6]);
    else TICKS.push([a.x - a.nx * 11, a.y - a.ny * 11, a.x + a.nx * 2, a.y + a.ny * 2, 2.6]);
}
// the mini battery, to the right of the arc
const BAT = { x0: 559, y0: 531, x1: 623, y1: 567, w: 3.8, fx0: 565, fx1: 617, fy0: 537, fy1: 561 };

function gaugeShader() {
    const n = GP.length, f = (v) => v.toFixed(6), L = [];
    L.push('#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif');
    L.push('varying vec2 v_uv;', 'uniform float u_aspect;', 'uniform float u_px;', 'uniform float u_s;', 'uniform float u_f;',
        'uniform vec4 u_ca;', 'uniform vec4 u_cb;', 'uniform vec4 u_cc;', 'uniform vec4 u_cm;');
    L.push('const float TOTAL = ' + f(GI.total) + ';',
        'const float SGN = ' + f(GP_SIGN) + ';', 'const float SC = ' + f(1 / 846) + ';');
    L.push(
        'float seg(vec2 p, vec2 a, vec2 b, float w) {',
        '  vec2 pa = p - a;', '  vec2 ba = b - a;',
        '  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
        '  float d = length(pa - ba * h);',
        '  return 1.0 - smoothstep(w - u_px, w + u_px, d);', '}',
        'float sp(vec2 p, float x0, float y0, float x1, float y1, float w) {',
        '  return seg(p, vec2(x0, y0) * SC, vec2(x1, y1) * SC, w * SC);', '}');
    for (const ch of Object.keys(GLYPH)) {
        L.push('float g' + ch + '(vec2 p, vec2 o, vec2 sz, float sw) {',
            '  p.x -= (o.y + sz.y - p.y) * ' + f(SHEAR) + ';', '  float a = 0.0;');
        for (const pl of GLYPH[ch]) for (let i = 0; i < pl.length - 1; i++)
            L.push('  a = max(a, seg(p, o + vec2(' + f(pl[i][0]) + ', ' + f(pl[i][1]) + ') * sz, o + vec2(' + f(pl[i + 1][0]) + ', ' + f(pl[i + 1][1]) + ') * sz, sw));');
        L.push('  return a;', '}');
    }
    L.push(
        'vec4 over(vec4 acc, vec3 c, float m) {',
        '  m = clamp(m, 0.0, 1.0);',
        '  float a = m + acc.a * (1.0 - m);',
        '  vec3 rgb = (c * m + acc.rgb * acc.a * (1.0 - m)) / max(a, 0.0001);',
        '  return vec4(rgb, a);', '}',
        'void sgm(vec2 p, vec2 a, vec2 ba, float inv, float c0, float dc, inout float best, inout float bs, inout float bside) {',
        '  vec2 pa = p - a;',
        '  float h = clamp(dot(pa, ba) * inv, 0.0, 1.0);',
        '  float d = length(pa - ba * h);',
        '  if (d < best) { best = d; bs = c0 + h * dc; bside = ba.x * pa.y - ba.y * pa.x; }', '}',
        'void main() {',
        '  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);',
        '  float best = 10.0;', '  float bs = 0.0;', '  float bside = 0.0;');
    for (let i = 0; i < n - 1; i++) {
        const ax = GP[i][0] / 846, ay = GP[i][1] / 846, bx = (GP[i + 1][0] - GP[i][0]) / 846, by = (GP[i + 1][1] - GP[i][1]) / 846;
        L.push('  sgm(p, vec2(' + f(ax) + ', ' + f(ay) + '), vec2(' + f(bx) + ', ' + f(by) + '), ' + f(1 / (bx * bx + by * by)) + ', '
            + f(GI.cum[i] / GI.total) + ', ' + f((GI.cum[i + 1] - GI.cum[i]) / GI.total) + ', best, bs, bside);');
    }
    L.push(
        '  float inside = step(0.00001, bside * SGN);',
        '  float sd = mix(best, -best, inside);',                       // + outside the arc, - inside
        '  float on = step(0.0, u_s) * step(bs, u_s);',
        '  float interior = step(0.001, bs) * step(bs, 0.999);',
        '  float aa = u_px;',
        '  vec3 c = mix(u_ca.rgb, u_cb.rgb, smoothstep(0.0, 0.12, bs));',
        '  c = mix(c, u_cc.rgb, smoothstep(0.10, 0.30, bs));',
        // the lit fill inside the arc, over the charged part: fuller near the arc, fading inward
        '  float D = 0.15;',
        '  float depth = clamp(1.0 - best / D, 0.0, 1.0);',
        '  float vol = inside * interior * on * step(best, D) * (0.22 + 0.78 * pow(depth, 1.25)) * smoothstep(0.0, 0.05, bs);',
        '  float rim = inside * interior * on * step(best, 0.05) * (1.0 - best / 0.05);',
        // the double outline: thick outer, thin inner
        '  float l1 = (1.0 - smoothstep(0.0062 - aa, 0.0062 + aa, abs(sd))) * interior;',
        '  float l2w = mix(0.0028, 0.0050, step(bs, ' + f(chargeToS(0.1)) + '));',
        '  float l2 = (1.0 - smoothstep(l2w - aa, l2w + aa, abs(sd + 0.021))) * interior;',
        '  vec3 lc = mix(vec3(0.68, 0.69, 0.72), vec3(0.98, 0.98, 1.0), on);',
        '  vec3 l2c = mix(lc * 0.9, vec3(1.0, 0.10, 0.14), step(bs, ' + f(chargeToS(0.1)) + '));',
        // the red level line at the present charge, fading inward
        '  float mk = (1.0 - smoothstep(0.0080 - aa, 0.0080 + aa, abs(bs - u_s) * TOTAL)) * step(0.0, u_s) * interior;',
        '  mk *= step(-D, sd) * step(sd, 0.016) * (1.0 - smoothstep(0.0, D, -min(sd, 0.0)));',
        '  float mkGlow = (1.0 - smoothstep(0.0, 0.022, abs(bs - u_s) * TOTAL)) * step(0.0, u_s) * interior * step(-0.06, sd) * step(sd, 0.016) * 0.35;');
    L.push('  float lab = 0.0;', '  float lead = 0.0;', '  float tick = 0.0;', '  float bat = 0.0;');
    for (const t of TICKS) L.push('  tick = max(tick, sp(p, ' + t.slice(0, 4).map(f).join(', ') + ', ' + t[4] + '));');
    for (const t of LAYOUT) {
        L.push('  lead = max(lead, sp(p, ' + [t.ax, t.ay, t.ex, t.ey].map(f).join(', ') + ', 3.4));');
        for (let i = 0; i < t.txt.length; i++) {
            const gx = t.lx + i * (GL_W + GL_GAP);
            L.push('  lab = max(lab, g' + t.txt[i] + '(p, vec2(' + gx + '.0, ' + t.ly + '.0) * SC, vec2(' + GL_W + '.0, ' + GL_H + '.0) * SC, ' + f(GL_SW) + ' * SC));');
        }
    }
    // mini battery: outline, terminal, level
    const B = BAT;
    L.push('  bat = max(bat, sp(p, ' + B.x0 + '.0, ' + B.y0 + '.0, ' + B.x1 + '.0, ' + B.y0 + '.0, ' + B.w + '));',
        '  bat = max(bat, sp(p, ' + B.x1 + '.0, ' + B.y0 + '.0, ' + B.x1 + '.0, ' + B.y1 + '.0, ' + B.w + '));',
        '  bat = max(bat, sp(p, ' + B.x1 + '.0, ' + B.y1 + '.0, ' + B.x0 + '.0, ' + B.y1 + '.0, ' + B.w + '));',
        '  bat = max(bat, sp(p, ' + B.x0 + '.0, ' + B.y1 + '.0, ' + B.x0 + '.0, ' + B.y0 + '.0, ' + B.w + '));',
        '  bat = max(bat, sp(p, ' + (B.x1 + 8) + '.0, ' + (B.y0 + 11) + '.0, ' + (B.x1 + 8) + '.0, ' + (B.y1 - 11) + '.0, 4.6));',
        '  float fx = ' + B.fx0 + '.0 * SC + ' + (B.fx1 - B.fx0) + '.0 * SC * clamp(u_f, 0.0, 1.0);',
        '  float lvl = step(' + B.fx0 + '.0 * SC, p.x) * step(p.x, fx) * step(' + B.fy0 + '.0 * SC, p.y) * step(p.y, ' + B.fy1 + '.0 * SC) * step(0.005, u_f) * step(0.0, u_s);');
    L.push(
        '  vec4 acc = vec4(0.0);',
        '  acc = over(acc, c, vol * 0.60);',
        '  acc = over(acc, mix(c, vec3(1.0), 0.45), rim * 0.55);',
        '  acc = over(acc, l2c, l2 * mix(0.6, 0.95, on));',
        '  acc = over(acc, lc, l1);',
        '  acc = over(acc, lc, tick * 0.95);',
        '  acc = over(acc, vec3(0.85, 0.86, 0.9), lead * 0.7);',
        '  acc = over(acc, u_cm.rgb, mkGlow);',
        '  acc = over(acc, u_cm.rgb, mk);',
        '  acc = over(acc, vec3(0.97), lab);',
        '  acc = over(acc, vec3(0.97), bat);',
        '  acc = over(acc, mix(vec3(0.97), u_cm.rgb, step(u_f, 0.15)), lvl * 0.92);',
        '  gl_FragColor = acc;',
        '}');
    return L.join('\n');
}
const GAUGE_FS = gaugeShader();

/** colours for a theme: fill at the start / middle / end of the arc, and the level line (rgb 0..1) */
const RED = [1.00, 0.10, 0.14], WHITE = [1, 1, 1];
const THEMES = {
    m_fuel:      [[0.80, 0.78, 0.90], [0.80, 0.78, 0.90], [0.80, 0.78, 0.90], RED],
    m_tricolour: [[0.20, 0.62, 1.00], [0.30, 0.25, 0.85], [0.95, 0.10, 0.16], WHITE],
    m_red:       [[0.95, 0.10, 0.16], [0.95, 0.10, 0.16], [0.95, 0.10, 0.16], WHITE],
    ice:         [[0.55, 0.85, 1.00], [0.55, 0.85, 1.00], [0.55, 0.85, 1.00], WHITE],
    amber:       [[1.00, 0.62, 0.10], [1.00, 0.62, 0.10], [1.00, 0.62, 0.10], WHITE],
};
function themeColors(name) {
    const t = THEMES[name] || THEMES.m_fuel;
    return t.map((c) => c.map((v) => v.toFixed(3)).join(' ') + ' 1.000');   // vec4, like the text strip's uniforms
}
const LAYOUT_DATA = { GP, GLYPH, SHEAR, GL_W, GL_H, GL_GAP, GL_SW, LAYOUT, TICKS, BAT, TOTAL: GI.total };

/* ---------------- geometry ---------------- */
const CW_ = 1920, CH_ = 720;    // the cluster, target "panel" (geometry() takes the 'map' scene's size itself)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Where the two layers go. The whole widget (dx, dy px; size %) is anchored at the cluster's right edge;
 * the text has its own offset (tdx, tdy px) and size (tsize %) relative to the gauge's bottom.
 */
function geometry(dx, dy, sizePct, tdx, tdy, tsizePct, scene) {
    const map = scene === 'map';          // the centre slot 0x100 (1088x480) instead of the whole panel
    const CW = map ? 1088 : 1920, CH = map ? 480 : 720;
    const s = sizePct / 100, ts = (tsizePct || 100) / 100;
    const gw = Math.round(265 * s), gh = Math.round(286 * s);
    const gx = clamp(CW - gw + dx, 0, CW - gw), gy = clamp((map ? CH - gh - 34 : 400) + dy, 0, CH - gh);
    const tw = Math.round(215 * s * ts), th = Math.round(38 * s * ts);
    // the strip's right edge starts 15 px inside the gauge's right edge
    const tx = clamp(gx + gw - Math.round(15 * s) - tw + (tdx || 0), 0, CW - tw);
    const ty = clamp(gy + Math.round(247 * s) + (tdy || 0), 0, CH - th);
    return { gauge: { x: gx, y: gy, w: gw, h: gh }, text: { x: tx, y: ty, w: tw, h: th } };
}

/** "d0 d1 d2 n": up to 3 digits of a value; unknown -> one dash (digit 11) */
function digitsOf(v, max) {
    if (v === null || v === undefined || !isFinite(v)) return '11 0 0 1';
    const s = String(Math.max(0, Math.min(max, Math.round(v))));
    const d = [0, 0, 0];
    for (let i = 0; i < s.length; i++) d[i] = s.charCodeAt(i) - 48;
    return d[0] + ' ' + d[1] + ' ' + d[2] + ' ' + s.length;
}

module.exports = { TEXT_FS, GAUGE_FS, GAUGE_ASPECT, chargeToS, geometry, digitsOf, themeColors, LAYOUT_DATA };
