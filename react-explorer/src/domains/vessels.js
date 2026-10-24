// Domain: vessels (mugs, cups, vases, pitchers, carafes, jars, bowls).
// One side profile, spun round, plus a handle, a spout, color, a dipped glaze band, and a surface finish.
import { seeded, pick } from '../engine.js';

const GENES = ['height','base','belly','bellyPos','neck','lip','handle','handleDrop','spout','hue','sat','tone','band','bandHue','finish'];
const MM = 1.5;      // one drawing unit = 1.5 mm, so the labels are real sizes
const TILE = 150;    // the drawing is laid out on a 150-unit square and scaled to any canvas

// ---- Decode: genome -> body profile (radius at each height) ----
function decode(g) {
  const H = 55 + g.height * 70;                 // body height in px
  const rBase = 14 + g.base * 26;
  const rBelly = 16 + g.belly * 38;
  const rNeck = 8 + g.neck * 36;
  const rLip = Math.max(6, rNeck + (g.lip - 0.35) * 22);
  const yBelly = (0.2 + g.bellyPos * 0.45) * H;
  const yNeck = Math.max(yBelly + 0.15 * H, 0.86 * H);
  const pts = [[0, rBase], [yBelly, rBelly], [yNeck, rNeck], [H, rLip]];
  // smooth radius by Catmull-Rom through the four control points
  const prof = [];
  const P = [pts[0], ...pts, pts[3]];
  for (let i = 1; i < P.length - 2; i++) {
    for (let s = 0; s < 12; s++) {
      const t = s / 12, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      prof.push([cr(P[i-1][0], P[i][0], P[i+1][0], P[i+2][0]), Math.max(5, cr(P[i-1][1], P[i][1], P[i+1][1], P[i+2][1]))]);
    }
  }
  prof.push([H, rLip]);
  // real numbers an industrial designer cares about
  let vol = 0;
  for (let i = 1; i < prof.length; i++) {
    const r = Math.max(0, (prof[i][1] + prof[i-1][1]) / 2 * MM - 3), dy = (prof[i][0] - prof[i-1][0]) * MM;
    vol += Math.PI * r * r * dy;
  }
  return { H, prof, rLip, rBase, ml: vol / 1000, mm: H * MM };
}

function radiusAt(prof, y) {
  for (let i = 1; i < prof.length; i++) {
    if (prof[i][0] >= y) {
      const [y0, r0] = prof[i-1], [y1, r1] = prof[i];
      const t = (y - y0) / Math.max(1e-6, y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  }
  return prof[prof.length - 1][1];
}

// ---- Render: hatched line drawing ----
function draw(canvas, g, opts = {}) {
  const size = canvas.width, k = size / TILE, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(k, k);
  const { H, prof, rLip, rBase, ml, mm } = decode(g);
  const cx = 68, bottom = 136, top = bottom - H, sq = 0.26;
  const X = (r, side) => cx + side * r, Y = y => bottom - y;
  const hue = Math.round(g.hue * 360), sat = 25 + g.sat * 60, light = 50 + g.tone * 38;
  const fill = `hsl(${hue}, ${sat}%, ${light}%)`, ink = `hsl(${hue}, 35%, 18%)`;
  const finish = g.finish < 0.34 ? 'gloss' : g.finish < 0.67 ? 'speckle' : 'ribbed';

  // handle first, so the body overlaps its roots
  if (g.handle > 0.3) {
    const yTop = H * 0.82, yBot = H * (0.55 - g.handleDrop * 0.4);
    const grow = (g.handle - 0.3) / 0.7, reach = 3 + grow * 40, thick = 2.5 + Math.min(1, grow * 3) * 4;
    const x0 = X(radiusAt(prof, yTop), 1) - 2, x1 = X(radiusAt(prof, yBot), 1) - 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink; ctx.lineWidth = thick;
    ctx.beginPath(); ctx.moveTo(x0, Y(yTop));
    ctx.bezierCurveTo(x0 + reach, Y(yTop) - 4, x1 + reach, Y(yBot) + 4, x1, Y(yBot)); ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = Math.max(0.5, thick - 2.9);
    ctx.beginPath(); ctx.moveTo(x0, Y(yTop));
    ctx.bezierCurveTo(x0 + reach, Y(yTop) - 4, x1 + reach, Y(yBot) + 4, x1, Y(yBot)); ctx.stroke();
  }

  // body outline path
  const body = new Path2D();
  body.moveTo(X(prof[0][1], -1), Y(0));
  prof.forEach(([y, r]) => body.lineTo(X(r, -1), Y(y)));
  body.ellipse(cx, top, rLip, rLip * sq, 0, Math.PI, 0, false);
  for (let i = prof.length - 1; i >= 0; i--) body.lineTo(X(prof[i][1], 1), Y(prof[i][0]));
  body.ellipse(cx, bottom, rBase, rBase * sq, 0, 0, Math.PI, false);
  body.closePath();
  ctx.fillStyle = fill;
  ctx.fill(body);

  // dipped glaze band, a second color on the lower part
  if (g.band > 0.5) {
    const yBand = H * (0.2 + (g.band - 0.5) * 1.0), rB = radiusAt(prof, Math.min(yBand, H));
    ctx.save(); ctx.clip(body);
    ctx.fillStyle = `hsl(${Math.round((hue + 60 + g.bandHue * 240) % 360)}, ${sat}%, ${Math.max(22, light - 22)}%)`;
    ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(0, Y(yBand));
    ctx.ellipse(cx, Y(yBand), rB + 2, (rB + 2) * sq, 0, Math.PI, 0, true);
    ctx.lineTo(200, Y(yBand)); ctx.lineTo(200, 200); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // surface finish
  ctx.save(); ctx.clip(body);
  if (finish === 'gloss') {            // a soft highlight down the lit side
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = H * 0.12; y < H * 0.8; y += 3) { const x = cx - radiusAt(prof, y) * 0.6; y === H * 0.12 ? ctx.moveTo(x, Y(y)) : ctx.lineTo(x, Y(y)); }
    ctx.stroke();
  } else if (finish === 'speckle') {   // stoneware flecks
    const rnd = seeded(domain, g); ctx.fillStyle = ink;
    for (let i = 0; i < 150; i++) { ctx.globalAlpha = 0.25 + rnd() * 0.45; ctx.fillRect(cx - 60 + rnd() * 120, top - 6 + rnd() * (H + 14), 0.9 + rnd() * 0.9, 0.9 + rnd() * 0.9); }
    ctx.globalAlpha = 1;
  } else {                             // throwing rings all the way round
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 0.6;
    for (let y = 4; y < H; y += 7) { const r = radiusAt(prof, y); ctx.beginPath(); ctx.ellipse(cx, Y(y), r, r * sq, 0, 0.05 * Math.PI, 0.95 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // hatching: arcs that follow the round form, denser toward the shadow side
  ctx.save(); ctx.clip(body);
  ctx.strokeStyle = ink; ctx.lineWidth = 0.7;
  for (let y = 3; y < H + 6; y += 4) {
    const r = radiusAt(prof, Math.min(y, H));
    ctx.beginPath(); ctx.ellipse(cx, Y(y), r, r * sq, 0, 0.12 * Math.PI, 0.42 * Math.PI); ctx.stroke();
  }
  for (let y = 5; y < H + 6; y += 4) {
    const r = radiusAt(prof, Math.min(y, H));
    ctx.beginPath(); ctx.ellipse(cx, Y(y), r, r * sq, 0, 0.02 * Math.PI, 0.24 * Math.PI); ctx.stroke();
  }
  // cross strokes in the deepest shadow
  ctx.lineWidth = 0.6;
  for (let y = -10; y < H + 20; y += 5) {
    const r = radiusAt(prof, Math.max(0, Math.min(y, H)));
    ctx.beginPath(); ctx.moveTo(cx + r * 0.72, Y(y) + 6); ctx.lineTo(cx + r * 1.02, Y(y) - 7); ctx.stroke();
  }
  ctx.restore();

  // outline, rim, and the inside of the opening
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.stroke(body);
  ctx.beginPath(); ctx.ellipse(cx, top, rLip, rLip * sq, 0, 0, 2 * Math.PI);
  ctx.fillStyle = `hsl(${hue}, ${sat * 0.8}%, ${Math.max(12, light - 24)}%)`; ctx.fill(); ctx.stroke();
  ctx.save(); ctx.clip(); ctx.lineWidth = 0.6;
  for (let x = -rLip; x < rLip; x += 3.5) { ctx.beginPath(); ctx.moveTo(cx + x, top - rLip); ctx.lineTo(cx + x + 8, top + rLip); ctx.stroke(); }
  ctx.restore();
  // pouring spout, grows out of the rim on the side away from the handle
  if (g.spout > 0.6) {
    const s = 4 + (g.spout - 0.6) * 30;
    ctx.beginPath(); ctx.moveTo(cx - rLip * 0.8, top - rLip * sq * 0.55);
    ctx.quadraticCurveTo(cx - rLip - s * 0.5, top - s * 0.25, cx - rLip - s, top - s * 0.45);
    ctx.quadraticCurveTo(cx - rLip - s * 0.3, top + s * 0.25, cx - rLip * 0.8, top + rLip * sq * 0.6);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.3; ctx.stroke();
  }
  // size label (skipped on the small chips and trail thumbnails)
  if (opts.labels) {
  ctx.fillStyle = '#6b6558'; ctx.font = '8px -apple-system, Helvetica, Arial'; ctx.textAlign = 'left';
  ctx.fillText((ml >= 1000 ? (ml / 1000).toFixed(1) + ' L' : Math.round(ml / 10) * 10 + ' ml') + '  ' + Math.round(mm) + ' mm', 4, 10);
  }
  // ground shadow
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(cx + rBase * 0.2 + i * 5, bottom + rBase * sq + 2 + i * 0.6); ctx.lineTo(cx + rBase + 16 - i * 2, bottom + rBase * sq + 2 + i * 0.6); ctx.stroke(); }
  ctx.restore();
}

// ---- Genome -> words, for the 3D generator at the end ----
function describe(g) {
  const d = decode(g);
  const wide = Math.max(...d.prof.map(p => p[1])) * 2;
  const kind = g.spout > 0.6 ? (g.handle > 0.3 ? 'pitcher' : 'carafe') : g.handle > 0.3 ? 'mug' : (d.H > wide * 1.2 ? 'vase' : d.H > wide * 0.8 ? 'jar' : 'bowl');
  const finish = g.finish < 0.34 ? 'glossy glazed ceramic' : g.finish < 0.67 ? 'speckled stoneware' : 'hand-thrown ceramic with visible throwing rings';
  const hueName = pick(g.hue, ['red','orange','yellow','lime green','green','teal','sky blue','blue','violet','magenta','rose']);
  return `A ${pick(g.height, ['squat','medium-height','tall'])} ${kind} in ${finish}, about ${Math.round(d.mm)} mm tall and holding about ${Math.round(d.ml / 10) * 10} ml, ` +
    `${pick(g.belly, ['slim','gently rounded','full-bellied'])} body, widest ${pick(g.bellyPos, ['near the base','around the middle','high up'])}, ` +
    `${pick(g.neck, ['narrow','medium','wide'])} opening with a ${pick(g.lip, ['tucked-in','straight','flared'])} lip` +
    (g.handle > 0.3 ? `, ${pick((g.handle - 0.3) / 0.7, ['small','medium','large'])} handle` : ', no handle') +
    (g.spout > 0.6 ? ', pouring spout' : '') +
    `, ${pick(g.tone, ['deep','mid-tone','pale'])} ${pick(g.sat, ['muted','soft','vivid'])} ${hueName} glaze` +
    (g.band > 0.5 ? ', lower part dipped in a darker contrasting glaze' : '') + '. Product photo, plain background.';
}


const domain = {
  id: 'vessels',
  name: 'Mugs and vases',
  blurb: 'Mugs, cups, vases, pitchers, jars, and bowls.',
  genes: GENES,
  features: [
    { id: 'shape',  name: 'Shape',  genes: ['height','base','belly','bellyPos','neck','lip'] },
    { id: 'handle', name: 'Handle', genes: ['handle','handleDrop'], none: (g) => g.handle <= 0.3 },
    { id: 'spout',  name: 'Spout',  genes: ['spout'], none: (g) => g.spout <= 0.6 },
    { id: 'color',  name: 'Color',  genes: ['hue','sat','tone'] },
    { id: 'glaze',  name: 'Dip',    genes: ['band','bandHue'], show: ['hue','sat','tone'], none: (g) => g.band <= 0.5 },
    { id: 'finish', name: 'Finish', genes: ['finish'] },
  ],
  neutral: { height: 0.35, base: 0.55, belly: 0.4, bellyPos: 0.5, neck: 0.75, lip: 0.4, handle: 0, handleDrop: 0.4, spout: 0, hue: 0.1, sat: 0, tone: 0.85, band: 0, bandHue: 0.5, finish: 0.1 },
  draw,
  describe,
};
export default domain;
