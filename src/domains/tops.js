// Domain: tops (tees, V-necks, collared shirts, tanks, tunics), drawn as a flat front view.
import { pick } from '../engine.js';

const GENES = ['length','shoulder','waist','hemCurve','sleeveLen','sleeveWide','neckW','neckD','collar','hue','sat','tone','stripes','stripeHue'];
const TILE = 150;

function shape(g) {
  const cx = 75, y0 = 26;
  const sw = 28 + g.shoulder * 14;                 // half shoulder width
  const nw = 8 + g.neckW * 10, nd = 5 + g.neckD * 28;
  const L = 55 + g.length * 52, hy = y0 + L;
  const ww = sw - 9 + g.waist * 24;                // half width at the hem: low = fitted, high = flared
  const sleeveless = g.sleeveLen < 0.08;
  const sl = 6 + g.sleeveLen * 56, w = 13 + g.sleeveWide * 10;
  const armY = y0 + 12 + w;
  const kind = g.collar < 0.33 ? 'crew' : g.collar < 0.66 ? 'vee' : 'collared';
  return { cx, y0, sw, nw, nd, hy, ww, sleeveless, sl, w, armY, kind };
}

function outline(s) {
  const { cx, y0, sw, nw, hy, ww, sleeveless, sl, w, armY } = s;
  const p = new Path2D();
  const side = (d) => {                            // d = -1 left, +1 right; returns the points for one side
    const sh = [cx + d * sw, y0 + 6];
    const out = [sh[0] + d * sl * 0.6, sh[1] + sl * 0.8];
    const inn = [out[0] - d * w * 0.8, out[1] + w * 0.6];
    const arm = [cx + d * (sw - 3), armY];
    return { sh, out, inn, arm, hem: [cx + d * ww, hy] };
  };
  const l = side(-1), r = side(1);
  p.moveTo(cx - nw, y0);
  p.lineTo(...l.sh);
  if (!sleeveless) { p.lineTo(...l.out); p.lineTo(...l.inn); }
  p.lineTo(...l.arm);
  p.quadraticCurveTo(cx - (s.sw - 6 + (ww - s.sw) * 0.3), (armY + hy) / 2, ...l.hem);
  p.quadraticCurveTo(cx, hy + s.hemCurveY, ...r.hem);
  p.quadraticCurveTo(cx + (s.sw - 6 + (ww - s.sw) * 0.3), (armY + hy) / 2, ...r.arm);
  if (!sleeveless) { p.lineTo(...r.inn); p.lineTo(...r.out); }
  p.lineTo(...r.sh);
  p.lineTo(cx + nw, y0);
  return { p, l, r };
}

function draw(canvas, g, opts = {}) {
  const size = canvas.width, k = size / TILE, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(k, k);
  const s = shape(g);
  s.hemCurveY = -3 + g.hemCurve * 12;
  const { cx, y0, nw, nd, hy, kind } = s;
  const hue = Math.round(g.hue * 360), sat = 20 + g.sat * 60, light = 48 + g.tone * 40;
  const fill = `hsl(${hue}, ${sat}%, ${light}%)`, ink = `hsl(${hue}, 35%, 18%)`;
  const { p, l, r } = outline(s);

  // inside of the back neck, drawn first so the front sits over it
  ctx.fillStyle = `hsl(${hue}, ${sat * 0.8}%, ${Math.max(12, light - 24)}%)`;
  ctx.beginPath(); ctx.moveTo(cx - nw, y0); ctx.quadraticCurveTo(cx, y0 + 5, cx + nw, y0); ctx.quadraticCurveTo(cx, y0 + nd + 6, cx - nw, y0); ctx.fill();

  // front neckline closes the body shape
  const body = new Path2D(p);
  if (kind === 'crew') body.quadraticCurveTo(cx, y0 + nd * 1.5, cx - nw, y0);
  else { body.lineTo(cx, y0 + nd + 4); body.lineTo(cx - nw, y0); }
  body.closePath();
  ctx.fillStyle = fill; ctx.fill(body);

  ctx.save(); ctx.clip(body);
  // stripes
  if (g.stripes > 0.45) {
    const gap = 14 - (g.stripes - 0.45) * 15;
    ctx.strokeStyle = `hsl(${Math.round((hue + 90 + g.stripeHue * 200) % 360)}, ${sat + 10}%, ${Math.max(20, light - 26)}%)`;
    ctx.lineWidth = gap * 0.36;
    for (let y = y0 + 4; y < hy + 14; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(150, y); ctx.stroke(); }
  }
  // hatching down the shadow side, and under each sleeve
  ctx.strokeStyle = ink; ctx.lineWidth = 0.7;
  for (let y = s.armY; y < hy + 8; y += 4) { ctx.beginPath(); ctx.moveTo(r.hem[0] - 3 - (hy - y) * 0.02, y); ctx.lineTo(r.hem[0] + 8, y - 9); ctx.stroke(); }
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(r.arm[0] - 4 + i * 2.6, r.arm[1] - 5); ctx.lineTo(r.arm[0] + 4 + i * 2.6, r.arm[1] + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l.arm[0] - 12 + i * 2.6, l.arm[1] + 2); ctx.lineTo(l.arm[0] - 5 + i * 2.6, l.arm[1] - 5); ctx.stroke();
  }
  // two soft folds from the armpits
  ctx.lineWidth = 0.8; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(l.arm[0] + 2, l.arm[1] + 2); ctx.quadraticCurveTo(cx - 14, (s.armY + hy) / 2, l.hem[0] + 9, hy - 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(r.arm[0] - 2, r.arm[1] + 2); ctx.quadraticCurveTo(cx + 16, (s.armY + hy) / 2, r.hem[0] - 8, hy - 8); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke(body);
  // seams where the sleeves join
  if (!s.sleeveless) { ctx.lineWidth = 0.9; [l, r].forEach((q) => { ctx.beginPath(); ctx.moveTo(...q.sh); ctx.lineTo(...q.arm); ctx.stroke(); }); }
  // back neck edge
  ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - nw, y0); ctx.quadraticCurveTo(cx, y0 + 5, cx + nw, y0); ctx.stroke();

  if (kind === 'collared') {
    const tip = y0 + Math.min(nd + 4, 22);
    ctx.fillStyle = fill; ctx.lineWidth = 1.2;
    [-1, 1].forEach((d) => { ctx.beginPath(); ctx.moveTo(cx + d * nw, y0); ctx.lineTo(cx + d * (nw + 7), y0 + 9); ctx.lineTo(cx + d * 3, tip); ctx.lineTo(cx, y0 + nd + 4); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx, y0 + nd + 4); ctx.lineTo(cx, hy + s.hemCurveY * 0.5); ctx.stroke();
    ctx.fillStyle = ink;
    for (let y = y0 + nd + 12; y < hy - 6; y += 13) { ctx.beginPath(); ctx.arc(cx + 2.4, y, 1.1, 0, 2 * Math.PI); ctx.fill(); }
  }
  if (opts.labels) {
    ctx.fillStyle = '#6b6558'; ctx.font = '8px -apple-system, Helvetica, Arial'; ctx.textAlign = 'left';
    ctx.fillText(Math.round((hy - y0) * 5.2) + ' mm long', 4, 10);
  }
  ctx.restore();
}

function describe(g) {
  const s = shape(g);
  const hueName = pick(g.hue, ['red','orange','yellow','lime green','green','teal','sky blue','blue','violet','magenta','rose']);
  const garment = s.kind === 'collared' ? 'collared button-front shirt' : s.kind === 'vee' ? 'V-neck top' : 'crew-neck tee';
  const sleeves = s.sleeveless ? 'sleeveless' : pick(g.sleeveLen, ['cap-sleeved','short-sleeved','elbow-length-sleeved','long-sleeved']);
  return `A ${pick(g.length, ['cropped','regular-length','long, tunic-length'])} ${sleeves} ${garment}, ` +
    `${pick(g.waist, ['fitted','straight','flared'])} cut, ${pick(g.neckD, ['high','medium','deep'])} neckline, ` +
    `${pick(g.tone, ['deep','mid-tone','pale'])} ${pick(g.sat, ['muted','soft','vivid'])} ${hueName} fabric` +
    (g.stripes > 0.45 ? `, ${pick((g.stripes - 0.45) / 0.55, ['wide','medium','narrow'])} horizontal stripes` : ', solid color') +
    '. Flat-lay product photo, plain background.';
}

const domain = {
  id: 'tops',
  name: 'Shirts and blouses',
  blurb: 'Tees, V-necks, collared shirts, tanks, and tunics.',
  genes: GENES,
  features: [
    { id: 'body',    name: 'Body',    genes: ['length','shoulder','waist','hemCurve'] },
    { id: 'sleeves', name: 'Sleeves', genes: ['sleeveLen','sleeveWide'], none: (g) => g.sleeveLen < 0.08 },
    { id: 'neck',    name: 'Neck',    genes: ['neckW','neckD','collar'] },
    { id: 'color',   name: 'Color',   genes: ['hue','sat','tone'] },
    { id: 'pattern', name: 'Stripes', genes: ['stripes','stripeHue'], show: ['hue','sat','tone'], none: (g) => g.stripes <= 0.45 },
  ],
  neutral: { length: 0.4, shoulder: 0.5, waist: 0.35, hemCurve: 0.3, sleeveLen: 0.25, sleeveWide: 0.5, neckW: 0.4, neckD: 0.2, collar: 0.1, hue: 0.1, sat: 0, tone: 0.85, stripes: 0, stripeHue: 0.5 },
  draw,
  describe,
};
export default domain;
