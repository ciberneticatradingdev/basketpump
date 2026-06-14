import type { Player, Ball, Team } from './types';

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

function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = WORLD_W; c.height = WORLD_H;
  const x = c.getContext('2d')!;

  // night-sky court gradient (matches the reference: deep blue arena)
  const sky = x.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, '#0c1430');
  sky.addColorStop(0.55, '#13357a');
  sky.addColorStop(1, '#1d57b0');
  roundRect(x, 0, 0, WORLD_W, WORLD_H, 0); x.fillStyle = sky; x.fill();

  // subtle green spotlight glows (BasketPump branding)
  radialGlow(x, WORLD_W * 0.22, 120, 360, 'rgba(86,196,43,.16)');
  radialGlow(x, WORLD_W * 0.8, 80, 420, 'rgba(86,196,43,.12)');

  // faint crowd dots up top
  x.save();
  for (let i = 0; i < 240; i++) {
    const px = Math.random() * WORLD_W, py = 20 + Math.random() * 150;
    x.globalAlpha = 0.05 + Math.random() * 0.12;
    x.fillStyle = Math.random() > 0.7 ? '#7dff43' : '#bcd0ff';
    x.beginPath(); x.arc(px, py, 1.5 + Math.random() * 1.6, 0, Math.PI * 2); x.fill();
  }
  x.restore();

  // wooden floor
  const floorH = WORLD_H - FLOOR_Y;
  const wood = x.createLinearGradient(0, FLOOR_Y, 0, WORLD_H);
  wood.addColorStop(0, '#b07a3e');
  wood.addColorStop(0.08, '#9c6a34');
  wood.addColorStop(1, '#7c5226');
  x.fillStyle = wood; x.fillRect(0, FLOOR_Y, WORLD_W, floorH);
  // planks
  x.save(); x.globalAlpha = .18; x.strokeStyle = '#5e3d1a'; x.lineWidth = 2;
  for (let i = 0; i < WORLD_W; i += 46) { x.beginPath(); x.moveTo(i, FLOOR_Y); x.lineTo(i, WORLD_H); x.stroke(); }
  x.restore();
  // floor highlight line
  x.strokeStyle = 'rgba(255,255,255,.65)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, FLOOR_Y); x.lineTo(WORLD_W, FLOOR_Y); x.stroke();

  // center logo on floor
  x.save(); x.translate(WORLD_W / 2, FLOOR_Y + floorH / 2);
  x.globalAlpha = .14; x.fillStyle = '#3d2510';
  x.font = '900 46px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BASKETPUMP', 0, 0); x.restore();

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

  ctx.save();
  // pole
  const pg = ctx.createLinearGradient(poleX - 7, 0, poleX + 7, 0);
  pg.addColorStop(0, '#c9d4e6'); pg.addColorStop(0.5, '#eef3fb'); pg.addColorStop(1, '#aeb9cc');
  ctx.fillStyle = pg;
  roundRect(ctx, poleX - 6, RIM_Y - 40, 12, FLOOR_Y - (RIM_Y - 40), 6); ctx.fill();

  // backboard
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  const bbX = poleX + inward * 6;
  ctx.save(); ctx.globalAlpha = .9;
  roundRect(ctx, side === 'left' ? bbX : bbX - 14, RIM_Y - 64, 14, 110, 4); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(40,60,110,.5)'; ctx.lineWidth = 2;
  roundRect(ctx, side === 'left' ? bbX : bbX - 14, RIM_Y - 64, 14, 110, 4); ctx.stroke();
  // square target
  ctx.strokeStyle = '#e23b3b'; ctx.lineWidth = 3;
  ctx.strokeRect(side === 'left' ? bbX + 3 : bbX - 11, RIM_Y - 26, 8, 26);

  // rim arm
  ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bbX, RIM_Y); ctx.lineTo(rimX, RIM_Y); ctx.stroke();

  // rim (ellipse opening, seen at slight angle)
  const rimGlow = flash > 0;
  ctx.strokeStyle = rimGlow ? '#7dff43' : '#ff7a1a';
  ctx.lineWidth = rimGlow ? 8 : 6;
  if (rimGlow) { ctx.shadowColor = '#7dff43'; ctx.shadowBlur = 22; }
  ctx.beginPath();
  ctx.ellipse(rimX, RIM_Y, RIM_R, 7, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;

  // net
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.4;
  const netH = 40 + (flash > 0 ? Math.sin(flash * 24) * 4 : 0);
  for (let i = -3; i <= 3; i++) {
    const topx = rimX + (i / 3) * RIM_R;
    const botx = rimX + (i / 3) * (RIM_R * 0.45);
    ctx.beginPath(); ctx.moveTo(topx, RIM_Y + 4); ctx.lineTo(botx, RIM_Y + netH); ctx.stroke();
  }
  for (let r = 1; r <= 3; r++) {
    const yy = RIM_Y + (netH / 3) * r;
    const wRatio = 1 - r * 0.18;
    ctx.beginPath(); ctx.moveTo(rimX - RIM_R * wRatio, yy); ctx.lineTo(rimX + RIM_R * wRatio, yy); ctx.stroke();
  }
  ctx.restore();
}

// ===== Players (cartoon humanoid, side view) =====
export function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, hasBall: boolean) {
  const col = p.team === 'home' ? '#56c42b' : '#e23b3b';
  const dark = p.team === 'home' ? '#2f7a14' : '#9c2323';
  const feetY = p.y;
  const squash = p.pumpT;                          // 0..1 crouch
  const bodyH = PLAYER_H * (1 - squash * 0.18);
  const headR = 17;
  const hipY = feetY - bodyH * 0.42;
  const shoulderY = feetY - bodyH * 0.78;
  const headY = feetY - bodyH + headR * 0.2;

  ctx.save();

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.beginPath(); ctx.ellipse(p.x, FLOOR_Y + 4, PLAYER_W * 0.6, 8, 0, 0, Math.PI * 2); ctx.fill();

  // user ring under feet
  if (p.isUser) {
    ctx.strokeStyle = 'rgba(125,255,67,.95)'; ctx.lineWidth = 3.5;
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = (performance.now() / 55) % 13;
    ctx.beginPath(); ctx.ellipse(p.x, FLOOR_Y + 4, PLAYER_W * 0.66, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // legs (run cycle when grounded & moving)
  const moving = Math.abs(p.vx) > 12 && p.onGround;
  const swing = moving ? Math.sin(p.runPhase) * 14 : 0;
  ctx.strokeStyle = dark; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(p.x, hipY); ctx.lineTo(p.x - 8 + swing, feetY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x, hipY); ctx.lineTo(p.x + 8 - swing, feetY); ctx.stroke();

  // torso (jersey)
  const tg = ctx.createLinearGradient(p.x, shoulderY, p.x, hipY + 6);
  tg.addColorStop(0, col); tg.addColorStop(1, dark);
  ctx.fillStyle = tg;
  roundRect(ctx, p.x - PLAYER_W / 2 + 4, shoulderY, PLAYER_W - 8, hipY - shoulderY + 10, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
  roundRect(ctx, p.x - PLAYER_W / 2 + 4, shoulderY, PLAYER_W - 8, hipY - shoulderY + 10, 9); ctx.stroke();

  // arms — raise toward shot when armT>0, else reach when reachT>0
  ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.lineCap = 'round';
  const reach = Math.max(p.armT, p.reachT);
  const ax = p.x + p.faceDir * (PLAYER_W * 0.32);
  const armElbowY = shoulderY + 16 - reach * 22;
  const handX = ax + p.faceDir * (10 + reach * 18);
  const handY = armElbowY - reach * 26;
  ctx.beginPath(); ctx.moveTo(p.x + p.faceDir * 6, shoulderY + 6); ctx.lineTo(ax, armElbowY); ctx.lineTo(handX, handY); ctx.stroke();
  // back arm
  ctx.strokeStyle = dark;
  ctx.beginPath(); ctx.moveTo(p.x - p.faceDir * 6, shoulderY + 6); ctx.lineTo(p.x - p.faceDir * 12, shoulderY + 24); ctx.stroke();

  // head
  ctx.fillStyle = '#ffe2c2';
  ctx.beginPath(); ctx.arc(p.x, headY, headR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
  // emoji face
  ctx.font = '20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.emoji, p.x, headY + 1);

  // headband (team color)
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(p.x, headY, headR - 1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();

  // name tag
  ctx.font = '700 13px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  const label = p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name;
  const tw = ctx.measureText(label).width + 16;
  const tagY = headY - headR - 20;
  ctx.fillStyle = hasBall ? 'rgba(255,140,30,.92)' : 'rgba(12,18,34,.7)';
  roundRect(ctx, p.x - tw / 2, tagY, tw, 18, 9); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, p.x, tagY + 9);
  // ball-carrier marker
  if (hasBall) {
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath(); ctx.moveTo(p.x, tagY + 26); ctx.lineTo(p.x - 6, tagY + 19); ctx.lineTo(p.x + 6, tagY + 19); ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

export function drawBall(ctx: CanvasRenderingContext2D, b: Ball, holder: Player | null) {
  let bx = b.x, by = b.y;
  if (holder) {
    bx = holder.x + holder.faceDir * (PLAYER_W * 0.42);
    by = holder.y - PLAYER_H * (0.5 - holder.armT * 0.42);
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
