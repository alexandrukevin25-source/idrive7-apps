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
  '  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);',
  '  vec3 cKm = vec3(0.25, 0.90, 0.45);',
  '  vec3 cPc = vec3(0.35, 0.75, 1.00);',
  '  vec3 cDim = vec3(0.80, 0.80, 0.80);',
  '  float wKm = u_km.w * 0.62;',
  '  float ux = wKm + 0.05;',
  '  float sx = ux + 0.66 + 0.12;',
  '  float px0 = sx + 0.35 + 0.12;',
  '  float wPc = u_pc.w * 0.62;',
  '  float qx = px0 + wPc + 0.05;',
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
// the band's edge, in px of a 783x846 crop of the photo (846 = 1 height unit); 0 % bottom-left, 100 % top
const GP = [[205, 592], [270, 608], [330, 611], [395, 602], [455, 578], [505, 538], [550, 488],
    [585, 432], [615, 372], [636, 312], [644, 250], [636, 190], [612, 138], [572, 102]];
const GP_NOTCH = 7;      // the point that is the 50 % notch
const GP_SIGN = -1.0;    // which side of the curve is the inside
const GAUGE_ASPECT = 783 / 846;

const GI = (() => {
    const cum = [0];
    for (let i = 1; i < GP.length; i++) cum.push(cum[i - 1] + Math.hypot((GP[i][0] - GP[i - 1][0]) / 846, (GP[i][1] - GP[i - 1][1]) / 846));
    const total = cum[cum.length - 1];
    return { cum, total, s50: cum[GP_NOTCH] / total };
})();

/** charge 0..1 -> position along the band 0..1 (the 50 % notch is at s50) */
function chargeToS(f) {
    return f < 0.5 ? f / 0.5 * GI.s50 : GI.s50 + (f - 0.5) / 0.5 * (1 - GI.s50);
}

function gaugeShader() {
    const n = GP.length, f = (v) => v.toFixed(6), L = [];
    L.push('#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif');
    L.push('varying vec2 v_uv;', 'uniform float u_aspect;', 'uniform float u_px;', 'uniform float u_s;');
    L.push('const float TOTAL = ' + f(GI.total) + ';', 'const float S50 = ' + f(GI.s50) + ';',
        'const float S25 = ' + f(chargeToS(0.25)) + ';', 'const float S75 = ' + f(chargeToS(0.75)) + ';',
        'const float SGN = ' + f(GP_SIGN) + ';', 'const float SC = ' + f(1 / 846) + ';');
    L.push('vec2 pt(int i) {');
    for (let i = 0; i < n - 1; i++) L.push('  if (i == ' + i + ') return vec2(' + f(GP[i][0] / 846) + ', ' + f(GP[i][1] / 846) + ');');
    L.push('  return vec2(' + f(GP[n - 1][0] / 846) + ', ' + f(GP[n - 1][1] / 846) + ');', '}');
    L.push('float cumAt(int i) {');
    for (let j = 0; j < n - 1; j++) L.push('  if (i == ' + j + ') return ' + f(GI.cum[j]) + ';');
    L.push('  return ' + f(GI.cum[n - 1]) + ';', '}');
    L.push(
        'float seg(vec2 p, vec2 a, vec2 b, float w) {',
        '  vec2 pa = p - a;', '  vec2 ba = b - a;',
        '  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
        '  float d = length(pa - ba * h);',
        '  return 1.0 - smoothstep(w - u_px, w + u_px, d);', '}',
        'float sp(vec2 p, float x0, float y0, float x1, float y1, float w) {',
        '  return seg(p, vec2(x0, y0) * SC, vec2(x1, y1) * SC, w * SC);', '}',
        'float ell(vec2 p, vec2 c, vec2 r, float w) {',
        '  float d = abs(length((p - c) / r) - 1.0) * min(r.x, r.y);',
        '  return 1.0 - smoothstep(w - u_px, w + u_px, d);', '}',
        'float g0(vec2 p, vec2 o, vec2 sz, float sw) { return ell(p, o + sz * 0.5, sz * 0.5, sw); }',
        'float g1(vec2 p, vec2 o, vec2 sz, float sw) {',
        '  float a = seg(p, o + vec2(0.55 * sz.x, 0.0), o + vec2(0.55 * sz.x, sz.y), sw);',
        '  return max(a, seg(p, o + vec2(0.55 * sz.x, 0.0), o + vec2(0.15 * sz.x, 0.22 * sz.y), sw));', '}',
        'float g5(vec2 p, vec2 o, vec2 sz, float sw) {',
        '  float w = sz.x;', '  float h = sz.y;',
        '  float a = seg(p, o + vec2(0.90 * w, 0.0), o + vec2(0.12 * w, 0.0), sw);',
        '  a = max(a, seg(p, o + vec2(0.12 * w, 0.0), o + vec2(0.10 * w, 0.46 * h), sw));',
        '  a = max(a, seg(p, o + vec2(0.10 * w, 0.46 * h), o + vec2(0.62 * w, 0.40 * h), sw));',
        '  a = max(a, seg(p, o + vec2(0.62 * w, 0.40 * h), o + vec2(0.92 * w, 0.62 * h), sw));',
        '  a = max(a, seg(p, o + vec2(0.92 * w, 0.62 * h), o + vec2(0.80 * w, 0.92 * h), sw));',
        '  a = max(a, seg(p, o + vec2(0.80 * w, 0.92 * h), o + vec2(0.50 * w, h), sw));',
        '  return max(a, seg(p, o + vec2(0.50 * w, h), o + vec2(0.10 * w, 0.90 * h), sw));', '}',
        'vec4 over(vec4 acc, vec3 c, float m) {',
        '  m = clamp(m, 0.0, 1.0);',
        '  float a = m + acc.a * (1.0 - m);',
        '  vec3 rgb = (c * m + acc.rgb * acc.a * (1.0 - m)) / max(a, 0.0001);',
        '  return vec4(rgb, a);', '}',
        'void main() {',
        '  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);',
        '  float best = 10.0;', '  float bs = 0.0;', '  float bside = 0.0;',
        '  for (int i = 0; i < ' + (n - 1) + '; i++) {',
        '    vec2 a = pt(i);', '    vec2 b = pt(i + 1);', '    vec2 ba = b - a;', '    vec2 pa = p - a;',
        '    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
        '    float d = length(pa - ba * h);',
        '    if (d < best) {',
        '      best = d;',
        '      bs = (cumAt(i) + h * (cumAt(i + 1) - cumAt(i))) / TOTAL;',
        '      bside = ba.x * pa.y - ba.y * pa.x;',
        '    }', '  }',
        '  float inside = step(0.00001, bside * SGN);',
        '  float on = step(0.0, u_s) * step(bs, u_s);',
        '  float interior = step(0.001, bs) * step(bs, 0.999);',
        '  float D = 0.15;',
        '  float fillA = inside * step(best, D) * on * interior * 0.95 * pow(clamp(1.0 - best / D, 0.0, 1.0), 0.9);',
        '  float tk = step(best, D * 0.8);',
        '  fillA *= 1.0 - 0.6 * step(abs(bs - S25), 0.006) * tk;',
        '  fillA *= 1.0 - 0.6 * step(abs(bs - S75), 0.006) * tk;',
        '  fillA *= 1.0 - 0.6 * step(abs(bs - S50), 0.006) * tk;',
        '  float edgeBlue = (1.0 - smoothstep(0.005 - u_px, 0.005 + u_px, best)) * mix(0.25, 1.0, on);',
        '  float sd = mix(-best, best, inside);',
        '  float outline = (1.0 - smoothstep(0.0065 - u_px, 0.0065 + u_px, abs(sd + 0.031)));',
        '  outline *= step(0.008, abs(bs - S50));',
        '  vec2 sz = vec2(34.0, 58.0) * SC;',
        '  float sw = 4.5 * SC;',
        '  float lab = g1(p, vec2(418.0, 66.0) * SC, sz, sw);',
        '  lab = max(lab, g0(p, vec2(462.0, 66.0) * SC, sz, sw));',
        '  lab = max(lab, g0(p, vec2(506.0, 66.0) * SC, sz, sw));',
        '  lab = max(lab, g5(p, vec2(425.0, 376.0) * SC, sz, sw));',
        '  lab = max(lab, g0(p, vec2(469.0, 376.0) * SC, sz, sw));',
        '  lab = max(lab, g0(p, vec2(198.0, 508.0) * SC, sz, sw));',
        '  lab = max(lab, ell(p, vec2(632.0, 495.0) * SC, vec2(11.0) * SC, 3.5 * SC));',
        '  lab = max(lab, ell(p, vec2(672.0, 530.0) * SC, vec2(11.0) * SC, 3.5 * SC));',
        '  lab = max(lab, sp(p, 676.0, 482.0, 628.0, 540.0, 4.0));',
        '  lab = max(lab, sp(p, 575.0, 562.0, 690.0, 562.0, 3.0));',
        '  lab = max(lab, sp(p, 690.0, 562.0, 690.0, 600.0, 3.0));',
        '  lab = max(lab, sp(p, 690.0, 600.0, 575.0, 600.0, 3.0));',
        '  lab = max(lab, sp(p, 575.0, 600.0, 575.0, 562.0, 3.0));',
        '  lab = max(lab, sp(p, 600.0, 581.0, 618.0, 581.0, 3.0));',
        '  lab = max(lab, sp(p, 648.0, 581.0, 666.0, 581.0, 3.0));',
        '  lab = max(lab, sp(p, 657.0, 572.0, 657.0, 590.0, 3.0));',
        '  lab = max(lab, sp(p, 582.0, 614.0, 697.0, 614.0, 3.0));',
        '  lab = max(lab, sp(p, 582.0, 628.0, 697.0, 628.0, 3.0));',
        '  vec3 teal = vec3(0.02, 0.50, 0.62);',
        '  vec3 blue = vec3(0.10, 0.62, 0.96);',
        '  vec3 white = vec3(0.93, 0.96, 0.96);',
        '  vec4 acc = vec4(0.0);',
        '  acc = over(acc, teal, fillA);',
        '  acc = over(acc, blue, edgeBlue);',
        '  acc = over(acc, white, outline);',
        '  acc = over(acc, white, lab);',
        '  gl_FragColor = acc;',
        '}');
    return L.join('\n');
}
const GAUGE_FS = gaugeShader();

/* ---------------- geometry ---------------- */
const CW = 1920, CH = 720;      // the cluster, target "panel"
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** where the two layers go for the settings (dx, dy in px, size in %) */
function geometry(dx, dy, sizePct) {
    const s = sizePct / 100;
    const gw = Math.round(265 * s), gh = Math.round(286 * s);
    const gx = clamp(CW - gw + dx, 0, CW - gw), gy = clamp(400 + dy, 0, CH - gh);
    const tw = Math.round(215 * s), th = Math.round(38 * s);
    const tx = clamp(gx + Math.round(35 * s), 0, CW - tw), ty = clamp(gy + Math.round(247 * s), 0, CH - th);
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

module.exports = { TEXT_FS, GAUGE_FS, GAUGE_ASPECT, chargeToS, geometry, digitsOf };
