import type { Player, Ball, Team, Particle } from './types';

// ===== Side-view world =====
// Origin top-left. Gravity pulls +y. Home attacks the RIGHT hoop, Away the LEFT hoop.
export const WORLD_W = 1280;
export const WORLD_H = 720;
export const FLOOR_Y = 628;           // ground contact line (player feet)
export const WALL = 26;               // invisible side walls keep players in

export const PLAYER_H = 96;           // body height (feet->head)
export const PLAYER_W = 46;
export const BALL_R = 17;

// Hoops: a pole at each end, rim sticking inward.
export const RIM_Y = 300;             // rim height
export const RIM_R = 34;              // rim half-width (scoring gap)
export const POLE_X_L = 64;           // left pole center x
export const POLE_X_R = WORLD_W - 64; // right pole center x
export const RIM_REACH = 92;          // how far the rim extends from the pole into the court

// Rim center (the scoring point) for each team's TARGET hoop.
export const targetRim = (t: Team) => t === 'home'
  ? { x: POLE_X_R - RIM_REACH, y: RIM_Y }   // home shoots at right hoop
  : { x: POLE_X_L + RIM_REACH, y: RIM_Y };  // away shoots at left hoop

let bgCache: HTMLCanvasElement | null = null;
let courtImg: HTMLImageElement | null = null;
let courtReady = false;

// load the real court photo for the game background
(() => {
  const img = new Image();
  img.onload = () => { courtReady = true; bgCache = null; /* rebuild with photo */ };
  img.src = '/brand/arena.jpg';
  courtImg = img;
})();

function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = WORLD_W; c.height = WORLD_H;
  const x = c.getContext('2d')!;

  if (courtReady && courtImg) {
    // cover-fit the photo into the world rect
    const iw = courtImg.naturalWidth, ih = courtImg.naturalHeight;
    const s = Math.max(WORLD_W / iw, WORLD_H / ih);
    const dw = iw * s, dh = ih * s;
    x.drawImage(courtImg, (WORLD_W - dw) / 2, (WORLD_H - dh) / 2, dw, dh);
    // light touch — only a soft bottom shade so players + ball read against the floor; keep the bright daytime look
    const shade = x.createLinearGradient(0, 0, 0, WORLD_H);
    shade.addColorStop(0, 'rgba(6,10,20,.04)');
    shade.addColorStop(0.62, 'rgba(6,10,20,.02)');
    shade.addColorStop(0.82, 'rgba(8,14,24,.20)');
    shade.addColorStop(1, 'rgba(6,10,18,.40)');
    x.fillStyle = shade; x.fillRect(0, 0, WORLD_W, WORLD_H);
    // soft green ground-line glow where players stand
    radialGlow(x, WORLD_W / 2, FLOOR_Y, 520, 'rgba(86,196,43,.08)');
    return c;
  }

  // ---- fallback procedural arena (used until the photo loads) ----
  // night-sky court gradient
  const sky = x.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, '#0c1430');
  sky.addColorStop(0.55, '#13357a');
  sky.addColorStop(1, '#1d57b0');
  roundRect(x, 0, 0, WORLD_W, WORLD_H, 0); x.fillStyle = sky; x.fill();

  radialGlow(x, WORLD_W * 0.22, 120, 360, 'rgba(86,196,43,.16)');
  radialGlow(x, WORLD_W * 0.8, 80, 420, 'rgba(86,196,43,.12)');

  const floorH = WORLD_H - FLOOR_Y;
  const wood = x.createLinearGradient(0, FLOOR_Y, 0, WORLD_H);
  wood.addColorStop(0, '#b07a3e');
  wood.addColorStop(0.08, '#9c6a34');
  wood.addColorStop(1, '#7c5226');
  x.fillStyle = wood; x.fillRect(0, FLOOR_Y, WORLD_W, floorH);
  x.strokeStyle = 'rgba(255,255,255,.65)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, FLOOR_Y); x.lineTo(WORLD_W, FLOOR_Y); x.stroke();

  return c;
}

function radialGlow(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color); g.addColorStop(1, 'transparent');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
}

export function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) {
  r = Math.min(r, W / 2, H / 2);
  x.beginPath();
  x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}

export function drawBackground(ctx: CanvasRenderingContext2D) {
  if (!bgCache) bgCache = buildBackground();
  ctx.drawImage(bgCache, 0, 0);
}

// ===== Hoops (drawn live; rim front net animates on score) =====
export function drawHoops(ctx: CanvasRenderingContext2D, flash: { home: number; away: number }) {
  drawHoop(ctx, 'left', flash.away);   // left hoop = away's target
  drawHoop(ctx, 'right', flash.home);  // right hoop = home's target
}

function drawHoop(ctx: CanvasRenderingContext2D, side: 'left' | 'right', flash: number) {
  const poleX = side === 'left' ? POLE_X_L : POLE_X_R;
  const inward = side === 'left' ? 1 : -1;
  const rimX = poleX + inward * RIM_REACH;
  const scored = flash > 0;

  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // ---- pole (green-tinted chrome, BasketPump palette) ----
  const pg = ctx.createLinearGradient(poleX - 8, 0, poleX + 8, 0);
  pg.addColorStop(0, '#16331a'); pg.addColorStop(0.5, '#dff7d2'); pg.addColorStop(1, '#2c5a26');
  ctx.fillStyle = pg;
  roundRect(ctx, poleX - 7, RIM_Y - 30, 14, FLOOR_Y - (RIM_Y - 30), 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
  roundRect(ctx, poleX - 7, RIM_Y - 30, 14, FLOOR_Y - (RIM_Y - 30), 7); ctx.stroke();
  // pole pad with BP
  const padY = RIM_Y + 120;
  ctx.fillStyle = '#0e1a0c';
  roundRect(ctx, poleX - 11, padY, 22, 120, 8); ctx.fill();
  ctx.fillStyle = '#7dff43'; ctx.font = '900 13px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(poleX, padY + 60); ctx.fillText('BP', 0, 0); ctx.restore();

  // ---- backboard (dark green branded glass) ----
  const bbW = 16, bbH = 116;
  const bbX = side === 'left' ? poleX + 4 : poleX - 4 - bbW;
  const bbY = RIM_Y - 70;
  const bbg = ctx.createLinearGradient(bbX, bbY, bbX + bbW, bbY + bbH);
  bbg.addColorStop(0, 'rgba(18,40,16,.94)'); bbg.addColorStop(1, 'rgba(10,24,9,.94)');
  ctx.fillStyle = bbg;
  roundRect(ctx, bbX, bbY, bbW, bbH, 5); ctx.fill();
  // glow frame (green, brightens on score)
  ctx.strokeStyle = scored ? '#7dff43' : 'rgba(125,255,67,.7)';
  ctx.lineWidth = scored ? 4 : 2.5;
  if (scored) { ctx.shadowColor = '#7dff43'; ctx.shadowBlur = 20; }
  roundRect(ctx, bbX, bbY, bbW, bbH, 5); ctx.stroke();
  ctx.shadowBlur = 0;
  // shooter's square (white, target on the inward face)
  const sqX = side === 'left' ? bbX + bbW - 9 : bbX + 1;
  ctx.strokeStyle = 'rgba(244,248,240,.95)'; ctx.lineWidth = 2.5;
  ctx.strokeRect(sqX, RIM_Y - 24, 8, 24);
  // BP mark on the board
  ctx.fillStyle = 'rgba(125,255,67,.85)'; ctx.font = '900 11px Segoe UI, sans-serif';
  ctx.save(); ctx.translate(bbX + bbW / 2, bbY + 16); ctx.fillText('BP', 0, 0); ctx.restore();

  // ---- rim arm + hanger ----
  ctx.strokeStyle = '#ff6a12'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(side === 'left' ? bbX + bbW : bbX, RIM_Y); ctx.lineTo(rimX, RIM_Y); ctx.stroke();

  // ---- net (drawn behind the rim front edge) ----
  const netH = 46 + (scored ? Math.sin(flash * 26) * 5 : 0);
  ctx.strokeStyle = scored ? 'rgba(125,255,67,.85)' : 'rgba(255,255,255,.72)';
  ctx.lineWidth = 1.5;
  const strands = 7;
  for (let i = 0; i <= strands; i++) {
    const tX = rimX - RIM_R + (i / strands) * (RIM_R * 2);
    const bX = rimX - RIM_R * 0.42 + (i / strands) * (RIM_R * 0.84);
    ctx.beginPath(); ctx.moveTo(tX, RIM_Y + 5); ctx.lineTo(bX, RIM_Y + netH); ctx.stroke();
  }
  // braided cross rings
  for (let r = 1; r <= 4; r++) {
    const yy = RIM_Y + 5 + (netH / 4) * r;
    const wRatio = 1 - r * 0.14;
    ctx.beginPath();
    ctx.moveTo(rimX - RIM_R * wRatio, yy);
    ctx.quadraticCurveTo(rimX, yy + 4, rimX + RIM_R * wRatio, yy);
    ctx.stroke();
  }

  // ---- rim (chunky orange torus, green glow on score) ----
  ctx.strokeStyle = scored ? '#7dff43' : '#ff7a1a';
  ctx.lineWidth = scored ? 9 : 7;
  if (scored) { ctx.shadowColor = '#7dff43'; ctx.shadowBlur = 24; }
  ctx.beginPath(); ctx.ellipse(rimX, RIM_Y, RIM_R, 8, 0, 0, Math.PI * 2); ctx.stroke();
  // front-edge highlight
  ctx.strokeStyle = scored ? 'rgba(190,255,150,.9)' : 'rgba(255,180,90,.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(rimX, RIM_Y + 1, RIM_R - 1, 7, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ===== Players (articulated cartoon baller, side view) =====
export function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, hasBall: boolean) {
  const col = p.team === 'home' ? '#5cd02e' : '#ec4040';
  const dark = p.team === 'home' ? '#2f7a14' : '#9c2323';
  const trim = p.team === 'home' ? '#bfff58' : '#ffd0d0';
  const skin = '#f2c79a', skinDark = '#d9a774';
  const f = p.faceDir;
  const feetY = p.y;
  const squash = p.pumpT;                            // 0..1 crouch anticipation
  const bodyH = PLAYER_H * (1 - squash * 0.14);
  const hipY = feetY - bodyH * 0.46;
  const shoulderY = feetY - bodyH * 0.80;
  const neckY = shoulderY - 4;
  const headR = 15;
  const headY = neckY - headR - 2;
  const cx = p.x;

  const moving = Math.abs(p.vx) > 14 && p.onGround;
  const air = !p.onGround;
  const swing = moving ? Math.sin(p.runPhase) * 16 : 0;
  const swing2 = moving ? Math.sin(p.runPhase + Math.PI) * 16 : 0;
  const reach = Math.max(p.armT, p.reachT);          // 0..1 arm raise

  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // ---- ground shadow (shrinks with jump height) ----
  const airGap = Math.max(0, FLOOR_Y - feetY);
  const shScale = 1 - Math.min(0.5, airGap / 360);
  ctx.fillStyle = `rgba(0,0,0,${0.30 * shScale})`;
  ctx.beginPath(); ctx.ellipse(cx, FLOOR_Y + 5, 26 * shScale, 7 * shScale, 0, 0, Math.PI * 2); ctx.fill();

  // ---- user ring under feet ----
  if (p.isUser) {
    ctx.strokeStyle = 'rgba(125,255,67,.95)'; ctx.lineWidth = 3.5;
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = (performance.now() / 55) % 13;
    ctx.beginPath(); ctx.ellipse(cx, FLOOR_Y + 5, 28, 9, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // limb helper: draw a tapered limb via two segments with a joint
  const limb = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  // ========== BACK LEG (further from camera, drawn first, darker) ==========
  {
    const footX = cx + (air ? -f * 8 : swing2 * 0.7);
    const kneeX = cx + (footX - cx) * 0.5;
    const kneeY = (hipY + feetY) / 2 + (air ? 10 : 2);
    limb(cx - 4, hipY, kneeX - 3, kneeY, footX - 3, feetY, 11, skinDark);
    // back sneaker
    sneaker(ctx, footX - 3, feetY, f, '#cfd6e0', '#9aa3b2');
  }

  // ========== BACK ARM ==========
  {
    const sx = cx - f * 6, sy = shoulderY + 5;
    let ex = sx - f * 10, ey = sy + 20, hx = ex - f * 6, hy = ey + 14;
    if (hasBall && reach < 0.2) { // cradle/dribble: back arm relaxed
      ex = sx - f * 8; ey = sy + 18; hx = ex - f * 4; hy = ey + 12;
    } else if (reach > 0.2) {     // raise back arm with shot too
      ex = sx + f * 4; ey = sy - 10 - reach * 16; hx = ex + f * 12; hy = ey - reach * 22;
    }
    limb(sx, sy, ex, ey, hx, hy, 8, skinDark);
    ctx.fillStyle = skinDark; dot(ctx, hx, hy, 4.5);
  }

  // ========== LEGS / SHORTS base ==========
  // front leg
  const frontFootX = cx + (air ? f * 12 : swing * 0.7);
  {
    const kneeX = cx + (frontFootX - cx) * 0.5 + f * 2;
    const kneeY = (hipY + feetY) / 2 + (air ? 6 : 0);
    limb(cx + 4, hipY, kneeX + 3, kneeY, frontFootX + 3, feetY, 12, skin);
    sneaker(ctx, frontFootX + 3, feetY, f, '#ffffff', '#c7ced9');
  }

  // ---- shorts (over hips) ----
  const shortsTop = hipY - 6, shortsH = 26;
  ctx.fillStyle = dark;
  roundRect(ctx, cx - 17, shortsTop, 34, shortsH, 7); ctx.fill();
  // shorts stripe
  ctx.fillStyle = trim;
  ctx.fillRect(cx - 17, shortsTop + shortsH - 7, 34, 3);
  // split for legs
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(cx - 1.5, shortsTop + 12, 3, shortsH - 12);

  // ========== TORSO (jersey, tapered) ==========
  const torsoTop = shoulderY, torsoBot = hipY - 2;
  const tg = ctx.createLinearGradient(cx, torsoTop, cx, torsoBot);
  tg.addColorStop(0, col); tg.addColorStop(1, dark);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(cx - 18, torsoTop + 4);
  ctx.quadraticCurveTo(cx - 21, torsoTop + 1, cx - 14, torsoTop - 1);   // shoulder
  ctx.lineTo(cx + 14, torsoTop - 1);
  ctx.quadraticCurveTo(cx + 21, torsoTop + 1, cx + 18, torsoTop + 4);
  ctx.lineTo(cx + 15, torsoBot);
  ctx.quadraticCurveTo(cx, torsoBot + 5, cx - 15, torsoBot);
  ctx.closePath(); ctx.fill();
  // side shading
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.beginPath(); ctx.moveTo(cx + 15 * f, torsoTop); ctx.lineTo(cx + 18 * f, torsoTop + 4);
  ctx.lineTo(cx + 15 * f, torsoBot); ctx.lineTo(cx + 9 * f, torsoBot); ctx.closePath(); ctx.fill();
  // jersey collar
  ctx.strokeStyle = trim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, torsoTop, 7, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  // jersey number
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = '900 16px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(p.id % 10 || 1), cx - f * 2, (torsoTop + torsoBot) / 2);

  // ========== FRONT ARM (shooting / dunking / dribbling / reaching) ==========
  {
    const sx = cx + f * 8, sy = shoulderY + 5;
    let ex: number, ey: number, hx: number, hy: number;
    if (p.dunkT > 0.05) {
      // big overhead slam: arm fully extended up toward the rim
      const d = p.dunkT;
      ex = sx + f * (10 + d * 4); ey = sy - 24 * d;
      hx = ex + f * (12 + d * 10); hy = ey - 40 * d;
    } else if (reach > 0.05) {
      // raise to shoot / contest
      ex = sx + f * (8 - reach * 2); ey = sy - reach * 20;
      hx = ex + f * (10 + reach * 16); hy = ey - reach * 30;
    } else if (hasBall) {
      // dribble: hand bobs near hip
      const bob = Math.sin(performance.now() / 120) * 5;
      ex = sx + f * 12; ey = sy + 16; hx = ex + f * 10; hy = ey + 18 + bob;
    } else {
      // running arm pump
      ex = sx + f * 6; ey = sy + 16 + swing * 0.4; hx = ex + f * 8; hy = ey + 14 - swing * 0.3;
    }
    limb(sx, sy, ex, ey, hx, hy, 8.5, skin);
    ctx.fillStyle = skin; dot(ctx, hx, hy, 5);
  }

  // ========== NECK + HEAD ==========
  ctx.strokeStyle = skinDark; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(cx, shoulderY - 1); ctx.lineTo(cx, neckY); ctx.stroke();

  // head
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx + f * 2, headY, headR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1.4; ctx.stroke();
  // hair / cap (team color) over the back-top
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx + f * 2, headY, headR + 1, Math.PI * 0.85, Math.PI * 1.95); ctx.fill();
  // headband
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx + f * 2, headY, headR - 1, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  // face: eye + brow looking toward faceDir
  ctx.fillStyle = '#1a1a1a';
  dot(ctx, cx + f * (headR - 6), headY - 2, 2.2);
  // little smile
  ctx.strokeStyle = 'rgba(40,20,10,.6)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx + f * (headR - 9), headY + 5, 4, Math.PI * 0.1, Math.PI * 0.7); ctx.stroke();

  // ========== name tag ==========
  ctx.font = '700 12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  const label = p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name;
  const tw = ctx.measureText(label).width + 16;
  const tagY = headY - headR - 18;
  ctx.fillStyle = hasBall ? 'rgba(255,140,30,.95)' : 'rgba(12,18,34,.66)';
  roundRect(ctx, cx - tw / 2, tagY, tw, 17, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx, tagY + 9);
  if (hasBall) {
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath(); ctx.moveTo(cx, tagY + 24); ctx.lineTo(cx - 5, tagY + 18); ctx.lineTo(cx + 5, tagY + 18); ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function sneaker(ctx: CanvasRenderingContext2D, x: number, y: number, f: number, top: string, sole: string) {
  ctx.save();
  // shoe body pointing in facing dir
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x - f * 5, y - 7);
  ctx.lineTo(x + f * 11, y - 4);
  ctx.quadraticCurveTo(x + f * 14, y - 1, x + f * 12, y + 2);
  ctx.lineTo(x - f * 6, y + 2);
  ctx.closePath(); ctx.fill();
  // sole
  ctx.fillStyle = sole;
  ctx.beginPath();
  ctx.moveTo(x - f * 6, y + 1); ctx.lineTo(x + f * 12, y + 1);
  ctx.quadraticCurveTo(x + f * 14, y + 2, x + f * 12, y + 4);
  ctx.lineTo(x - f * 6, y + 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}


export function drawBall(ctx: CanvasRenderingContext2D, b: Ball, holder: Player | null) {
  let bx = b.x, by = b.y;
  if (holder) {
    const f = holder.faceDir;
    const reach = Math.max(holder.armT, 0);
    if (reach > 0.05) {
      // ball up at the shooting hand
      const sy = holder.y - PLAYER_H * 0.80 + 5;
      bx = holder.x + f * (18 + reach * 18);
      by = sy - reach * 52 - 6;
    } else {
      // low dribble near the front hand, bouncing
      const bob = Math.abs(Math.sin(performance.now() / 120)) * 22;
      bx = holder.x + f * (PLAYER_W * 0.5);
      by = FLOOR_Y - BALL_R - bob;
    }
  }
  ctx.save();
  // shadow on floor
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(bx, FLOOR_Y + 4, BALL_R * 0.8, 5, 0, 0, Math.PI * 2); ctx.fill();

  ctx.translate(bx, by); ctx.rotate(b.spin);
  const g = ctx.createRadialGradient(-5, -5, 3, 0, 0, BALL_R);
  g.addColorStop(0, '#ffb259'); g.addColorStop(1, '#d4641a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(30,12,0,.75)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-BALL_R, 0); ctx.lineTo(BALL_R, 0);
  ctx.moveTo(0, -BALL_R); ctx.lineTo(0, BALL_R);
  ctx.arc(0, -BALL_R * 1.6, BALL_R * 1.4, Math.PI * 0.32, Math.PI * 0.68);
  ctx.stroke();
  ctx.restore();
}

// particle FX (sparks, confetti, dust, expanding rings)
export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  ctx.save();
  for (const p of particles) {
    const t = Math.max(0, p.life / p.maxLife);
    if (p.kind === 'ring') {
      const r = p.size + (1 - t) * 70;
      ctx.globalAlpha = t * 0.8;
      ctx.strokeStyle = p.color; ctx.lineWidth = 3 * t + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === 'star') {
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = Math.min(1, t * 1.3);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  ctx.restore();
}

// vertical charge meter on the left rail (matches reference red bar)
export function drawChargeRail(ctx: CanvasRenderingContext2D, value: number) {
  const x = 30, y = 150, w = 18, h = WORLD_H - 320;
  ctx.save();
  roundRect(ctx, x, y, w, h, 9); ctx.fillStyle = 'rgba(8,14,30,.7)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 2; roundRect(ctx, x, y, w, h, 9); ctx.stroke();
  const fillH = (h - 6) * Math.min(1, value);
  const grad = ctx.createLinearGradient(0, y + h, 0, y);
  grad.addColorStop(0, '#56c42b'); grad.addColorStop(0.6, '#ffd23b'); grad.addColorStop(1, '#e23b3b');
  ctx.fillStyle = grad;
  roundRect(ctx, x + 3, y + h - 3 - fillH, w - 6, fillH, 6); ctx.fill();
  ctx.restore();
}
