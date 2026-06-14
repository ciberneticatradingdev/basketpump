import './style.css';
import { Engine, type UserInput } from './engine';
import { drawCourt, drawPlayer, drawBall, drawShotMeter, COURT_W, COURT_H } from './court';
import type { MatchConfig, Team } from './types';
import * as Audio from './audio';

// ---------- DOM ----------
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const menuScreen = $('#menu-screen'), gameScreen = $('#game-screen');
const canvas = $('#court') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreHomeEl = $('#score-home'), scoreAwayEl = $('#score-away');
const timerEl = $('#timer'), staminaFill = $('#stamina-fill'), toastEl = $('#toast');
const gameoverEl = $('#gameover');

let cfg: MatchConfig = { mode: 'quick', minutes: 5 };
let engine: Engine | null = null;
let raf = 0;

// ---------- MENU ----------
$('#seg-mode').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('.seg-btn') as HTMLElement; if (!b) return;
  $('#seg-mode').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); cfg.mode = b.dataset.mode as MatchConfig['mode'];
});
$('#seg-time').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('.seg-btn') as HTMLElement; if (!b) return;
  $('#seg-time').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); cfg.minutes = parseInt(b.dataset.min!);
});
$('#play-btn').addEventListener('click', () => startMatch());
$('#quit-btn').addEventListener('click', () => toMenu());
$('#go-menu').addEventListener('click', () => toMenu());
$('#go-rematch').addEventListener('click', () => { gameoverEl.classList.add('hidden'); startMatch(); });

function toMenu() {
  cancelAnimationFrame(raf); engine = null; Audio.stopCrowd();
  gameoverEl.classList.add('hidden');
  gameScreen.classList.remove('active'); menuScreen.classList.add('active');
}

// ---------- INPUT ----------
const keys: Record<string, boolean> = {};
const input: UserInput = { up: false, down: false, left: false, right: false, sprint: false, steal: false };
let lastTap: Record<string, number> = {};
let dashDir = { x: 0, y: 0 };

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
  if (!keys[k]) {
    // double-tap dash detection on WASD
    if ('wasd'.includes(k) && engine) {
      const now = performance.now();
      if (now - (lastTap[k] || 0) < 260) {
        dashDir = { x: (k === 'd' ? 1 : k === 'a' ? -1 : 0), y: (k === 's' ? 1 : k === 'w' ? -1 : 0) };
        engine.doDash(dashDir.x, dashDir.y);
      }
      lastTap[k] = now;
    }
    if (k === ' ' && engine) engine.doCrossover();
  }
  keys[k] = true;
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Mouse: left = pass (hold to charge), right = shoot (hold to charge meter)
let passCharge = 0, shootCharge = 0, charging: 'pass' | 'shoot' | null = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  Audio.resumeAudio();
  if (!engine) return;
  if (e.button === 0) { charging = 'pass'; passCharge = 0; }
  else if (e.button === 2) { charging = 'shoot'; shootCharge = 0; }
});
window.addEventListener('mouseup', e => {
  if (!engine || !charging) return;
  if (e.button === 0 && charging === 'pass') { engine.doPass(passCharge); }
  if (e.button === 2 && charging === 'shoot') { engine.doShoot(shootCharge); }
  charging = null; passCharge = 0; shootCharge = 0;
});
// aim with mouse — set facing toward cursor
let mouseWorld = { x: 0, y: 0 };
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width, sy = (e.clientY - r.top) / r.height;
  mouseWorld.x = view.x + sx * view.w; mouseWorld.y = view.y + sy * view.h;
});

// ---------- CAMERA ----------
const view = { x: 0, y: 0, w: COURT_W, h: COURT_H, scale: 1 };
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resize); resize();

// ---------- MATCH ----------
function startMatch() {
  menuScreen.classList.remove('active'); gameScreen.classList.add('active');
  gameoverEl.classList.add('hidden');
  resize();
  Audio.resumeAudio(); Audio.startCrowd();
  engine = new Engine(cfg, {
    onScore: (_t: Team, _p: number) => {},
    onToast: (m: string) => showToast(m),
    onSound: (s) => Audio.play(s),
  });
  engine.running = true;
  scoreHomeEl.textContent = '0'; scoreAwayEl.textContent = '0';
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    update(dt); render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

let toastTimer = 0;
function showToast(m: string) {
  if (!m) { toastEl.classList.remove('show'); return; }
  toastEl.textContent = m; toastEl.classList.add('show'); toastTimer = 1.1;
}

function update(dt: number) {
  if (!engine) return;
  input.up = !!keys['w']; input.down = !!keys['s'];
  input.left = !!keys['a']; input.right = !!keys['d'];
  input.sprint = !!keys['shift']; input.steal = !!keys['e'] || charging === null && false;
  // steal on left-click tap when not holding ball handled via doPass; use 'f' for steal too
  input.steal = !!keys['e'] || !!keys['f'];

  if (charging === 'pass') passCharge = Math.min(1, passCharge + dt * 1.4);
  if (charging === 'shoot') shootCharge = Math.min(1, shootCharge + dt * 1.3);

  // aim user toward mouse when holding ball
  const u = engine.user;
  if (engine.userHasBall() && !(input.up || input.down || input.left || input.right)) {
    u.facing = Math.atan2(mouseWorld.y - u.y, mouseWorld.x - u.x);
  }

  engine.step(dt, input);

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }

  // HUD
  scoreHomeEl.textContent = String(engine.scoreHome);
  scoreAwayEl.textContent = String(engine.scoreAway);
  const mm = Math.floor(engine.timeLeft / 60), ss = Math.floor(engine.timeLeft % 60);
  timerEl.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
  staminaFill.style.width = engine.user.stamina + '%';

  if (!engine.running && engine.timeLeft <= 0) endMatch();
}

function endMatch() {
  if (!engine) return;
  const h = engine.scoreHome, a = engine.scoreAway;
  $('#go-home').textContent = String(h); $('#go-away').textContent = String(a);
  $('#go-title').textContent = h > a ? 'YOU WIN! 🏆' : h < a ? 'YOU LOSE' : 'DRAW';
  $('#go-sub').textContent = h > a ? 'PUMP HIGH! 🔥' : h < a ? 'Run it back.' : 'Overtime vibes.';
  gameoverEl.classList.remove('hidden');
  Audio.play('whistle'); Audio.stopCrowd();
}

// ---------- RENDER ----------
function render() {
  if (!engine) return;
  // camera follows user, clamps to court
  const u = engine.user;
  const targetScale = Math.max(canvas.width / (COURT_W * 0.72), canvas.height / (COURT_H * 0.72));
  view.scale += (targetScale - view.scale) * 0.1;
  view.w = canvas.width / view.scale; view.h = canvas.height / view.scale;
  let cx = u.x - view.w / 2, cy = u.y - view.h / 2;
  cx = Math.max(-40, Math.min(COURT_W - view.w + 40, cx));
  cy = Math.max(-40, Math.min(COURT_H - view.h + 40, cy));
  view.x += (cx - view.x) * 0.12; view.y += (cy - view.y) * 0.12;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070a06'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, -view.x * view.scale, -view.y * view.scale);

  drawCourt(ctx);

  // sort by y for depth
  const ordered = [...engine.players].sort((p, q) => p.y - q.y);
  for (const p of ordered) {
    const hasBall = engine.ball.state === 'held' && engine.ball.owner === p.id;
    drawPlayer(ctx, p, hasBall, p.isUser);
  }
  drawBall(ctx, engine.ball);

  // shot meter above user while charging shot
  if (charging === 'shoot' && engine.userHasBall()) drawShotMeter(ctx, engine.user, shootCharge);
  // pass-power ring while charging pass
  if (charging === 'pass' && engine.userHasBall()) {
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,67,.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(engine.user.x, engine.user.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * passCharge); ctx.stroke();
    ctx.restore();
  }
}

// touch fallback hint (desktop-first game)
console.log('%cBASKETPUMP', 'color:#7dff43;font-weight:900;font-size:20px', '— Play Hard. Pump High.');
