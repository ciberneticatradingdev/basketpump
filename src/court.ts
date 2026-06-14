import type { Player, Ball, Team } from './types';

// World dimensions (full mini-court, horizontal). Home attacks RIGHT, Away attacks LEFT.
export const COURT_W = 1500;
export const COURT_H = 900;
export const MARGIN = 70;
export const HOOP_R = 26;          // rim radius (scoring zone)
export const PLAYER_R = 26;
export const BALL_R = 12;

export const hoopFor = (t: Team) => t === 'home'
  ? { x: COURT_W - MARGIN + 6, y: COURT_H / 2 }   // right
  : { x: MARGIN - 6, y: COURT_H / 2 };            // left

const C = {
  woodA: '#b9d98f', woodB: '#aed080',
  line: 'rgba(255,255,255,.82)', paint: 'rgba(86,196,43,.30)',
  paintLine: 'rgba(255,255,255,.7)', shadow: 'rgba(0,0,0,.28)',
};

let fieldCache: HTMLCanvasElement | null = null;

function buildField(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = COURT_W; c.height = COURT_H;
  const x = c.getContext('2d')!;
  // backdrop (dark surround)
  x.fillStyle = '#0a1207'; x.fillRect(0, 0, COURT_W, COURT_H);

  // court floor with green paint-splash gradient
  const fx = MARGIN, fy = MARGIN, fw = COURT_W - MARGIN * 2, fh = COURT_H - MARGIN * 2;
  const g = x.createLinearGradient(fx, fy, fx, fy + fh);
  g.addColorStop(0, C.woodA); g.addColorStop(1, C.woodB);
  roundRect(x, fx, fy, fw, fh, 18); x.fillStyle = g; x.fill();

  // subtle plank streaks
  x.save(); roundRect(x, fx, fy, fw, fh, 18); x.clip();
  x.globalAlpha = .05; x.strokeStyle = '#2c4012'; x.lineWidth = 2;
  for (let i = 0; i < fw; i += 26) { x.beginPath(); x.moveTo(fx + i, fy); x.lineTo(fx + i, fy + fh); x.stroke(); }
  // green graffiti splashes in corners
  x.globalAlpha = .16; x.fillStyle = '#3d9e1a';
  splash(x, fx + 60, fy + 60, 50); splash(x, fx + fw - 70, fy + fh - 70, 60); splash(x, fx + fw - 90, fy + 80, 36);
  x.restore();

  // court lines
  x.strokeStyle = C.line; x.lineWidth = 4;
  roundRect(x, fx, fy, fw, fh, 18); x.stroke();
  // halfcourt line
  const cx = COURT_W / 2, cy = COURT_H / 2;
  x.beginPath(); x.moveTo(cx, fy); x.lineTo(cx, fy + fh); x.stroke();
  // center circle
  x.beginPath(); x.arc(cx, cy, 95, 0, Math.PI * 2); x.stroke();
  x.save(); x.fillStyle = C.paint; x.beginPath(); x.arc(cx, cy, 95, 0, Math.PI * 2); x.fill(); x.restore();

  // both ends: paint key + arc + hoop
  drawEnd(x, 'home'); drawEnd(x, 'away');

  // center logo text
  x.save(); x.translate(cx, cy); x.globalAlpha = .14; x.fillStyle = '#1c3a09';
  x.font = '900 60px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BP', 0, 0); x.restore();

  return c;
}

function drawEnd(x: CanvasRenderingContext2D, t: Team) {
  const h = hoopFor(t);
  const left = t === 'away';
  const baseX = left ? MARGIN : COURT_W - MARGIN;
  const dir = left ? 1 : -1;            // into court
  const keyW = 220, keyH = 300;
  const ky = COURT_H / 2 - keyH / 2;
  const kx = left ? MARGIN : COURT_W - MARGIN - keyW;
  // painted key
  x.save(); x.fillStyle = C.paint; roundRect(x, kx, ky, keyW, keyH, 6); x.fill();
  x.strokeStyle = C.paintLine; x.lineWidth = 3; roundRect(x, kx, ky, keyW, keyH, 6); x.stroke();
  // free-throw circle
  x.beginPath(); x.arc(left ? kx + keyW : kx, COURT_H / 2, 70, 0, Math.PI * 2); x.stroke();
  x.restore();
  // 3pt arc
  x.save(); x.strokeStyle = C.line; x.lineWidth = 4;
  x.beginPath(); x.arc(baseX, COURT_H / 2, 360, left ? -Math.PI / 2.3 : Math.PI / 2.3, left ? Math.PI / 2.3 : -Math.PI / 2.3, left); x.stroke();
  x.restore();
  // backboard + rim
  x.save();
  x.strokeStyle = '#f4f8f0'; x.lineWidth = 6;
  x.beginPath(); x.moveTo(baseX, COURT_H / 2 - 46); x.lineTo(baseX, COURT_H / 2 + 46); x.stroke();
  x.strokeStyle = '#ff7a1a'; x.lineWidth = 5;
  x.beginPath(); x.arc(h.x, h.y, HOOP_R, 0, Math.PI * 2); x.stroke();
  // net
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1.5;
  for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(h.x + i * 9, h.y - HOOP_R + 6); x.lineTo(h.x + i * 5, h.y + HOOP_R + 16); x.stroke(); }
  x.restore();
  void dir;
}

function splash(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
    const rr = r * (0.55 + Math.random() * 0.7);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
  }
  x.closePath(); x.fill();
}

export function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) {
  x.beginPath();
  x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}

export function drawCourt(ctx: CanvasRenderingContext2D) {
  if (!fieldCache) fieldCache = buildField();
  ctx.drawImage(fieldCache, 0, 0);
}

export function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, hasBall: boolean, isUser: boolean) {
  const col = p.team === 'home' ? '#56c42b' : '#e23b3b';
  const dark = p.team === 'home' ? '#2f7a14' : '#8f1f1f';
  // shadow
  ctx.save();
  ctx.fillStyle = C.shadow; ctx.beginPath();
  ctx.ellipse(p.x, p.y + PLAYER_R * 0.78, PLAYER_R * 0.95, PLAYER_R * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // user highlight ring
  if (isUser) {
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,67,.9)'; ctx.lineWidth = 3.5;
    ctx.setLineDash([6, 6]); ctx.lineDashOffset = (performance.now() / 60) % 12;
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // body (jersey circle)
  const g = ctx.createRadialGradient(p.x - 8, p.y - 10, 4, p.x, p.y, PLAYER_R);
  g.addColorStop(0, col); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();

  // facing chevron
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.facing);
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.beginPath(); ctx.moveTo(PLAYER_R - 6, 0); ctx.lineTo(PLAYER_R - 16, -7); ctx.lineTo(PLAYER_R - 16, 7); ctx.closePath(); ctx.fill();
  ctx.restore();

  // jersey number
  ctx.fillStyle = '#fff'; ctx.font = '900 18px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(p.id % 10 || 1), p.x, p.y - 1);

  // ball-carrier glow
  if (hasBall) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,180,40,.9)'; ctx.lineWidth = 3;
    ctx.shadowColor = '#ff9a1a'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

export function drawBall(ctx: CanvasRenderingContext2D, b: Ball) {
  const zlift = b.z;
  // shadow on floor scales with height
  ctx.save();
  ctx.fillStyle = C.shadow;
  const s = 1 + zlift / 220;
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, BALL_R * 0.9 * (1 / s) + 2, BALL_R * 0.5 * (1 / s) + 1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const by = b.y - zlift;
  const g = ctx.createRadialGradient(b.x - 4, by - 4, 2, b.x, by, BALL_R);
  g.addColorStop(0, '#ff9d3a'); g.addColorStop(1, '#d4641a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, by, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,10,0,.7)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(b.x, by, BALL_R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(b.x - BALL_R, by); ctx.lineTo(b.x + BALL_R, by);
  ctx.moveTo(b.x, by - BALL_R); ctx.lineTo(b.x, by + BALL_R); ctx.stroke();
}

// Shot meter drawn above the user player
export function drawShotMeter(ctx: CanvasRenderingContext2D, p: Player, value: number) {
  const w = 86, h = 12, gx = p.x - w / 2, gy = p.y - PLAYER_R - 26;
  ctx.save();
  roundRect(ctx, gx, gy, w, h, 6); ctx.fillStyle = 'rgba(8,12,6,.85)'; ctx.fill();
  // green perfect zone 0.78..0.92
  const zoneA = gx + w * 0.78, zoneW = w * 0.14;
  ctx.fillStyle = 'rgba(125,255,67,.85)'; roundRect(ctx, zoneA, gy, zoneW, h, 3); ctx.fill();
  // fill
  ctx.fillStyle = '#f4f8f0'; roundRect(ctx, gx + 2, gy + 2, (w - 4) * Math.min(1, value), h - 4, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.5; roundRect(ctx, gx, gy, w, h, 6); ctx.stroke();
  ctx.restore();
}
