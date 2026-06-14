import './style.css';
import { Engine, type UserInput } from './engine';
import {
  drawBackground, drawHoops, drawPlayer, drawBall, drawChargeRail,
  WORLD_W, WORLD_H,
} from './court';
import type { MatchConfig, Team } from './types';
import * as Audio from './audio';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const menuScreen = $('#menu-screen'), gameScreen = $('#game-screen');
const canvas = $('#court') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreHomeEl = $('#score-home'), scoreAwayEl = $('#score-away');
const timerEl = $('#timer'), staminaFill = $('#stamina-fill'), toastEl = $('#toast');
const ballTagEl = $('#ball-tag'), hintEl = $('#action-hint');
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
const input: UserInput = { left: false, right: false, jumpHeld: false };
let charging = false, charge = 0;

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['a', 'd', 'w', 'q', 'e', ' '].includes(k)) e.preventDefault();
  const fresh = !keys[k];
  keys[k] = true;
  if (!engine) return;
  if (fresh) {
    if (k === 'w') engine.jump(engine.user);
    if (k === 'e') engine.grab();
    if (k === 'q') engine.pass();
    if (k === ' ') { Audio.resumeAudio(); charging = true; charge = 0; }
  }
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (!engine) return;
  if (k === ' ' && charging) {
    if (engine.userHasBall()) engine.shoot(charge);
    charging = false; charge = 0;
  }
});

// also allow mouse hold-to-charge-shoot (Hold left = charge, release = shoot)
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  Audio.resumeAudio();
  if (!engine) return;
  if (e.button === 0) { charging = true; charge = 0; }
  else if (e.button === 2) { engine.grab(); }
});
window.addEventListener('mouseup', e => {
  if (!engine || e.button !== 0 || !charging) return;
  if (engine.userHasBall()) engine.shoot(charge); else engine.grab();
  charging = false; charge = 0;
});

// ---------- CANVAS SIZE (letterboxed world) ----------
let scale = 1, offX = 0, offY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  canvas.width = Math.floor(vw * dpr); canvas.height = Math.floor(vh * dpr);
  canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
  scale = Math.min((vw * dpr) / WORLD_W, (vh * dpr) / WORLD_H);
  offX = ((vw * dpr) - WORLD_W * scale) / 2;
  offY = ((vh * dpr) - WORLD_H * scale) / 2;
}
window.addEventListener('resize', resize); resize();

// ---------- MATCH ----------
function startMatch() {
  menuScreen.classList.remove('active'); gameScreen.classList.add('active');
  gameoverEl.classList.add('hidden'); resize();
  Audio.resumeAudio(); Audio.startCrowd();
  engine = new Engine(cfg, {
    onScore: (_t: Team) => {},
    onToast: (m: string) => showToast(m),
    onSound: (s) => Audio.play(s),
  });
  engine.running = true; charging = false; charge = 0;
  if (import.meta.env.DEV) (window as any).__bp = engine;
  scoreHomeEl.textContent = '0'; scoreAwayEl.textContent = '0';
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.045, (t - last) / 1000); last = t;
    update(dt); render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

let toastTimer = 0;
function showToast(m: string) {
  if (!m) { toastEl.classList.remove('show'); return; }
  toastEl.textContent = m; toastEl.classList.add('show'); toastTimer = 1.2;
}

function update(dt: number) {
  if (!engine) return;
  input.left = !!keys['a']; input.right = !!keys['d']; input.jumpHeld = !!keys['w'];
  if (charging) charge = Math.min(1, charge + dt * 0.85);

  engine.step(dt, input, charging);

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }

  scoreHomeEl.textContent = String(engine.scoreHome);
  scoreAwayEl.textContent = String(engine.scoreAway);
  const mm = Math.floor(engine.timeLeft / 60), ss = Math.floor(engine.timeLeft % 60);
  timerEl.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
  staminaFill.style.width = engine.user.stamina + '%';

  // contextual prompts
  if (engine.userHasBall()) {
    ballTagEl.classList.add('show');
    hintEl.textContent = charging ? '⚡ Release to SHOOT' : 'Hold SPACE/Click to charge • Q pass';
  } else {
    ballTagEl.classList.remove('show');
    hintEl.textContent = 'E / Right-click to GRAB • W jump';
  }

  if (engine.timeLeft <= 0 && engine.running) { engine.running = false; endMatch(); }
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, offX, offY);

  drawBackground(ctx);
  drawHoops(ctx, engine.flash);

  const holder = engine.holder();
  // draw players back-to-front by x for slight depth (and behind/in-front of poles ok)
  const ordered = [...engine.players].sort((p, q) => p.y - q.y);
  for (const p of ordered) drawPlayer(ctx, p, engine.ball.owner === p.id);
  drawBall(ctx, engine.ball, holder);

  // charge rail (left side) while charging a shot with ball
  if (charging && engine.userHasBall()) drawChargeRail(ctx, charge);

  // border frame around world (matches reference rounded panel)
  ctx.strokeStyle = 'rgba(125,255,67,.35)'; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);
}

console.log('%cBASKETPUMP', 'color:#7dff43;font-weight:900;font-size:20px', '— Play Hard. Pump High.');
