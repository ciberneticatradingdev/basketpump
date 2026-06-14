import './style.css';
import { Engine, type UserInput } from './engine';
import {
  drawBackground, drawHoops, drawPlayer, drawBall, drawChargeRail, drawParticles,
  WORLD_W, WORLD_H, PLAYER_W, PLAYER_H, FLOOR_Y, WALL,
} from './court';
import type { MatchConfig, Team, Player, Particle } from './types';
import * as Audio from './audio';
import { Net, type RoomSummary, type RoomState, type NetPlayer, type InputPayload } from './net';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const menuScreen = $('#menu-screen'), gameScreen = $('#game-screen');
const canvas = $('#court') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreHomeEl = $('#score-home'), scoreAwayEl = $('#score-away');
const timerEl = $('#timer'), staminaFill = $('#stamina-fill'), toastEl = $('#toast');
const ballTagEl = $('#ball-tag'), hintEl = $('#action-hint');
const gameoverEl = $('#gameover');
const lobbyEl = $('#lobby'), roomsListEl = $('#rooms-list'), netDot = $('#net-dot'), nameInput = $('#name-input') as HTMLInputElement;

let cfg: MatchConfig = { mode: 'practice', minutes: 3 };
let engine: Engine | null = null;
let raf = 0;
let mode: 'offline' | 'online' = 'offline';

// ---------- NET ----------
let net: Net | null = null;
function ensureNet(): Net {
  if (net) return net;
  net = new Net();
  net.onStatus = (c) => { netDot.classList.toggle('on', c); netDot.textContent = c ? '● ONLINE' : '○ connecting…'; };
  net.onRooms = (r) => renderRooms(r);
  net.onJoinError = (m) => showToast(m || 'Could not join');
  net.onAssigned = () => { startOnlineMatch(); };
  net.onState = (s) => onSnapshot(s); // fires once per server snapshot (discrete events)
  return net;
}

// Discrete per-snapshot handling: score, timer, one-shot fx, toasts, sounds.
// Runs exactly ONCE per received snapshot (not per render frame) so particle
// bursts and sounds fire a single time instead of repeating for ~50ms.
function onSnapshot(s: RoomState) {
  if (mode !== 'online') return;
  // reconcile predicted self against authority
  const me = mySlot(s);
  if (me) reconcileSelf(me);
  scoreHomeEl.textContent = String(s.scoreHome);
  scoreAwayEl.textContent = String(s.scoreAway);
  setTimer(s.timeLeft);
  for (const fx of s.fx) {
    if (fx.kind === 'dunk') {
      spawnBurst(fx.x, fx.y, ['#7dff43', '#bfff58', '#ffd23b', '#fff'], 22, 60);
      spawnRing(fx.x, fx.y); clientShake = 14; Audio.play('dunk');
    } else {
      const cols = fx.team === 'home' ? ['#7dff43', '#bfff58', '#5cd02e', '#fff'] : ['#ec4040', '#ffd0d0', '#ff7a1a', '#fff'];
      spawnBurst(fx.x, fx.y + 30, cols, 26, 120); spawnRing(fx.x, fx.y);
      clientShake = Math.max(clientShake, 8); Audio.play('swish');
    }
  }
  if (s.toast && s.toast !== lastToast) { showToast(s.toast); lastToast = s.toast; }
  if (!s.toast) lastToast = '';
  if (s.status === 'ended') ballTagEl.classList.remove('show');
}

function renderRooms(rooms: RoomSummary[]) {
  roomsListEl.innerHTML = '';
  rooms.forEach((r) => {
    const full = r.humans >= r.capacity;
    const card = document.createElement('button');
    card.className = 'room-card' + (full ? ' full' : '');
    const statusLabel = r.status === 'playing' ? 'LIVE'
      : r.status === 'ended' ? 'ENDING'
      : r.humans > 0 ? 'WAITING' : 'OPEN';
    card.innerHTML = `
      <div class="room-top"><span class="room-name">${r.code}</span>
        <span class="room-status ${r.status}">${statusLabel}</span></div>
      <div class="room-mid">${r.scoreHome} : ${r.scoreAway}</div>
      <div class="room-bot"><span class="room-players">👤 ${r.humans}/${r.capacity}</span>
        <span class="room-join">${full ? 'FULL' : 'JOIN ▶'}</span></div>`;
    if (!full) card.addEventListener('click', () => { Audio.resumeAudio(); ensureNet().joinRoom(r.code, playerName()); });
    roomsListEl.appendChild(card);
  });
}

function playerName() { return (nameInput?.value || '').trim() || 'Baller'; }

// ---------- MENU ----------
// Two modes only: Practice (offline vs CPU) and Quick Match (online 3v3, fixed 3 min).
$('#play-btn').addEventListener('click', () => startMatch());          // PRACTICE
$('#quit-btn').addEventListener('click', () => leaveGame());
$('#go-menu').addEventListener('click', () => leaveGame());
$('#go-rematch').addEventListener('click', () => { gameoverEl.classList.add('hidden'); if (mode === 'offline') startMatch(); });

// online lobby controls — QUICK MATCH opens the live arenas
$('#online-btn').addEventListener('click', () => { lobbyEl.classList.add('open'); ensureNet().listRooms(); });
$('#lobby-close').addEventListener('click', () => lobbyEl.classList.remove('open'));
$('#quickplay-btn').addEventListener('click', () => { Audio.resumeAudio(); ensureNet().quickPlay(playerName()); });

function leaveGame() {
  cancelAnimationFrame(raf); engine = null; Audio.stopCrowd();
  if (mode === 'online' && net) net.leaveRoom();
  mode = 'offline';
  gameoverEl.classList.add('hidden');
  gameScreen.classList.remove('active'); menuScreen.classList.add('active');
  lobbyEl.classList.remove('open');
}

// ---------- INPUT ----------
const keys: Record<string, boolean> = {};
const input: UserInput = { left: false, right: false, jumpHeld: false };
let charging = false, charge = 0;
// edge events for online
let edgeJump = false, edgeGrab = false, edgePass = false, pendingShoot = 0;

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['a', 'd', 'w', 'q', 'e', ' '].includes(k)) e.preventDefault();
  const fresh = !keys[k];
  keys[k] = true;
  if (!playing()) return;
  if (fresh) {
    if (k === 'w') { edgeJump = true; if (engine) engine.jump(engine.user); }
    if (k === 'e') { edgeGrab = true; if (engine) engine.grab(); }
    if (k === 'q') { edgePass = true; if (engine) engine.pass(); }
    if (k === ' ') { Audio.resumeAudio(); charging = true; charge = 0; }
  }
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (!playing()) return;
  if (k === ' ' && charging) {
    if (mode === 'offline') { if (engine && engine.userHasBall()) engine.shoot(charge); }
    else pendingShoot = Math.max(0.15, charge);
    charging = false; charge = 0;
  }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  Audio.resumeAudio();
  if (!playing()) return;
  if (e.button === 0) { charging = true; charge = 0; }
  else if (e.button === 2) { edgeGrab = true; if (engine) engine.grab(); }
});
window.addEventListener('mouseup', e => {
  if (!playing() || e.button !== 0 || !charging) return;
  if (mode === 'offline') { if (engine && engine.userHasBall()) engine.shoot(charge); else if (engine) engine.grab(); }
  else pendingShoot = Math.max(0.15, charge);
  charging = false; charge = 0;
});

function playing() { return mode === 'offline' ? !!engine : !!(net && net.assigned); }

// ---------- CANVAS SIZE ----------
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

// ---------- OFFLINE MATCH ----------
function startMatch() {
  mode = 'offline';
  menuScreen.classList.remove('active'); gameScreen.classList.add('active');
  gameoverEl.classList.add('hidden'); lobbyEl.classList.remove('open'); resize();
  Audio.resumeAudio(); Audio.startCrowd();
  engine = new Engine(cfg, {
    onScore: (_t: Team) => {},
    onToast: (m: string) => showToast(m),
    onSound: (s) => Audio.play(s),
  });
  engine.running = true; charging = false; charge = 0;
  if (import.meta.env.DEV) (window as any).__bp = engine;
  scoreHomeEl.textContent = '0'; scoreAwayEl.textContent = '0';
  startLoop();
}

// ---------- ONLINE MATCH ----------
function startOnlineMatch() {
  mode = 'online'; engine = null;
  menuScreen.classList.remove('active'); gameScreen.classList.add('active');
  gameoverEl.classList.add('hidden'); lobbyEl.classList.remove('open'); resize();
  Audio.resumeAudio(); Audio.startCrowd();
  charging = false; charge = 0; clientParticles.length = 0;
  self.init = false; pendingInputs.length = 0; inputSeq = 0; // fresh prediction state for this match
  if (import.meta.env.DEV) { (window as any).__net = net; (window as any).__self = self; }
  showToast('Joined ' + (net?.assigned?.code || ''));
  startLoop();
}

function startLoop() {
  cancelAnimationFrame(raf);
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.045, (t - last) / 1000); last = t;
    if (mode === 'offline') { update(dt); render(); }
    else { updateOnline(dt); renderOnline(dt); }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

let toastTimer = 0;
function showToast(m: string) {
  if (!m) { toastEl.classList.remove('show'); return; }
  toastEl.textContent = m; toastEl.classList.add('show'); toastTimer = 1.4;
}

// ---------- OFFLINE update/render ----------
function update(dt: number) {
  if (!engine) return;
  input.left = !!keys['a']; input.right = !!keys['d']; input.jumpHeld = !!keys['w'];
  if (charging) charge = Math.min(1, charge + dt * 0.85);
  engine.step(dt, input, charging);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }
  scoreHomeEl.textContent = String(engine.scoreHome);
  scoreAwayEl.textContent = String(engine.scoreAway);
  setTimer(engine.timeLeft);
  staminaFill.style.width = engine.user.stamina + '%';
  if (engine.userHasBall()) { ballTagEl.classList.add('show'); hintEl.textContent = charging ? '⚡ Release to SHOOT' : 'Hold SPACE/Click to charge • Q pass'; }
  else { ballTagEl.classList.remove('show'); hintEl.textContent = 'E / Right-click to GRAB • W jump'; }
  if (engine.timeLeft <= 0 && engine.running) { engine.running = false; endMatch(engine.scoreHome, engine.scoreAway); }
}

function render() {
  if (!engine) return;
  beginFrame(engine.shake);
  drawBackground(ctx); drawHoops(ctx, engine.flash);
  const holder = engine.holder();
  const ordered = [...engine.players].sort((p, q) => p.y - q.y);
  for (const p of ordered) drawPlayer(ctx, p, engine.ball.owner === p.id);
  drawBall(ctx, engine.ball, holder);
  drawParticles(ctx, engine.particles);
  if (charging && engine.userHasBall()) drawChargeRail(ctx, charge);
  endFrame();
}

// ---------- ONLINE update/render ----------
const clientParticles: Particle[] = [];
let clientShake = 0;
let lastToast = '';

// ===== client-side prediction + server reconciliation (Gambetta/Valve model) =====
// Own player: predicted locally every frame (0ms input feel) AND reconciled against
// the server WITHOUT the 30Hz tug-of-war that caused self-stutter. On each snapshot we
// reset to the authoritative position, then REPLAY every input the server hasn't acked
// yet — so the predicted player lands exactly where prediction said, correcting only on
// real divergence (steal/collision), never visibly. Remote players + loose ball stay
// interpolated via net.sample().
const PRED = { GRAV: 2100, MOVE: 430, AIR_MOVE: 300, JUMP_V: 880, FRICTION: 0.82 };
interface SelfState { x: number; y: number; vx: number; vy: number; onGround: boolean; faceDir: 1 | -1; }
interface StampedInput { seq: number; dt: number; left: boolean; right: boolean; jump: boolean; stunned: boolean; }
const self = { x: 0, y: 0, vx: 0, vy: 0, onGround: true, faceDir: 1 as 1 | -1, armT: 0, init: false };
let inputSeq = 0;
const pendingInputs: StampedInput[] = []; // inputs sent but not yet acked by server

// Pure movement step — identical math to server room.ts tick(). Mutates `st`.
function stepMovement(st: SelfState, inp: { left: boolean; right: boolean; jump: boolean }, stunned: boolean, dt: number) {
  if (!stunned) {
    const accel = st.onGround ? PRED.MOVE : PRED.AIR_MOVE;
    if (inp.left) { st.vx = -accel; st.faceDir = -1; }
    else if (inp.right) { st.vx = accel; st.faceDir = 1; }
    else if (st.onGround) st.vx *= PRED.FRICTION;
    if (inp.jump && st.onGround) { st.vy = -PRED.JUMP_V; st.onGround = false; }
  } else if (st.onGround) st.vx *= PRED.FRICTION;
  if (!st.onGround) st.vy += PRED.GRAV * dt;
  st.x += st.vx * dt; st.y += st.vy * dt;
  const minX = WALL + PLAYER_W / 2, maxX = WORLD_W - WALL - PLAYER_W / 2;
  if (st.x < minX) { st.x = minX; st.vx = 0; }
  if (st.x > maxX) { st.x = maxX; st.vx = 0; }
  if (st.y >= FLOOR_Y) { st.y = FLOOR_Y; st.vy = 0; st.onGround = true; } else st.onGround = false;
}

// Apply this frame's input locally (instant feel) and record it for later replay.
function predictSelf(dt: number, inp: { left: boolean; right: boolean; jump: boolean }, stunned: boolean): number {
  if (!self.init) return inputSeq;
  const seq = ++inputSeq;
  pendingInputs.push({ seq, dt, left: inp.left, right: inp.right, jump: inp.jump, stunned });
  if (pendingInputs.length > 240) pendingInputs.shift(); // ~4s safety cap
  stepMovement(self, inp, stunned, dt);
  self.armT = Math.max(0, self.armT - dt * 3);
  return seq;
}

// On each authoritative snapshot: seed (first time) or reconcile by replaying unacked inputs.
function reconcileSelf(sp: NetPlayer) {
  if (!self.init) {
    self.x = sp.x; self.y = sp.y; self.vx = sp.vx; self.vy = sp.vy;
    self.onGround = sp.onGround; self.faceDir = sp.faceDir; self.armT = sp.armT; self.init = true;
    pendingInputs.length = 0;
    return;
  }
  const ack = sp.ack ?? 0;
  // drop inputs the server has already processed
  while (pendingInputs.length && pendingInputs[0].seq <= ack) pendingInputs.shift();
  // start from the authoritative state, then re-apply everything still in flight
  const st: SelfState = { x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy, onGround: sp.onGround, faceDir: sp.faceDir };
  for (const inp of pendingInputs) stepMovement(st, inp, inp.stunned, inp.dt);
  // If the replayed result is within a sane window, accept it outright (no tug-of-war).
  // Only a large gap (genuine desync — steal/teleport) is worth a hard correction.
  const err = Math.hypot(st.x - self.x, st.y - self.y);
  if (err > 220) { // hard desync → snap
    self.x = st.x; self.y = st.y; self.vx = st.vx; self.vy = st.vy; self.onGround = st.onGround; self.faceDir = st.faceDir;
  } else {
    // accept replayed authority fully — it already includes our pending inputs, so there's
    // no backward pull; tiny residual differences come only from float drift.
    self.x = st.x; self.y = st.y; self.vx = st.vx; self.vy = st.vy; self.onGround = st.onGround;
  }
  self.armT = sp.armT;
}

function updateOnline(dt: number) {
  if (!net) return;
  if (charging) charge = Math.min(1, charge + dt * 0.85);

  // predict own player locally so movement feels instant (0ms), independent of ping
  const stunned = !!(net.state && mySlot(net.state) && (mySlot(net.state)!.stunT > 0));
  const seq = predictSelf(dt, { left: !!keys['a'], right: !!keys['d'], jump: edgeJump }, stunned);

  // send input snapshot (stamped with seq so the server can ack it)
  const p: InputPayload = {
    left: !!keys['a'], right: !!keys['d'],
    jump: edgeJump, grab: edgeGrab, pass: edgePass,
    charging, shootPower: pendingShoot, seq,
  };
  net.sendInput(p);
  edgeJump = edgeGrab = edgePass = false; pendingShoot = 0;

  // ball-tag / hint reflect the newest raw state (cheap, no interpolation needed).
  // Score, timer, fx, toasts and sounds are handled once-per-snapshot in onSnapshot().
  const s = net.state;
  if (s) {
    const me = mySlot(s);
    staminaFill.style.width = '100%';
    if (me && s.ball.owner === me.id) { ballTagEl.classList.add('show'); hintEl.textContent = charging ? '⚡ Release to SHOOT' : 'Hold SPACE/Click to charge • Q pass'; }
    else { ballTagEl.classList.remove('show'); hintEl.textContent = 'E / Right-click to GRAB • W jump'; }
  }
  updateClientParticles(dt);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }
  clientShake = Math.max(0, clientShake - dt * 60);
}

function renderOnline(_dt: number) {
  const s = net?.sample(); // smoothly interpolated render state (~100ms behind, extrapolated if late)
  beginFrame(clientShake);
  drawBackground(ctx);
  if (s) {
    drawHoops(ctx, { home: s.flashHome, away: s.flashAway });
    const me = mySlot(s);
    const myId = me?.id;
    // Override the interpolated copy of MY player with the locally-predicted state
    // so my own movement shows zero input lag. Remote players stay interpolated.
    const players = s.players.map(np => {
      if (self.init && np.id === myId) {
        return { ...np, x: self.x, y: self.y, vx: self.vx, vy: self.vy, onGround: self.onGround, faceDir: self.faceDir, armT: Math.max(np.armT, self.armT) };
      }
      return np;
    });
    const ordered = [...players].sort((a, b) => a.y - b.y);
    for (const np of ordered) drawPlayer(ctx, netToPlayer(np, myId), np.hasBall);
    // ball: if I'm holding it, anchor to my predicted hand so it doesn't lag behind me
    let ball = { ...s.ball } as any;
    if (self.init && myId != null && s.ball.owner === myId) {
      ball = { ...ball, x: self.x + self.faceDir * (PLAYER_W * 0.42), y: self.y - PLAYER_H * (0.5 - self.armT * 0.42) };
    }
    drawBall(ctx, ball, holderOf(s));
    drawParticles(ctx, clientParticles);
    if (charging && me && s.ball.owner === me.id) drawChargeRail(ctx, charge);
    // waiting for a 1v1 minimum → show a banner over the (idle) court
    if (s.status === 'waiting') {
      ctx.fillStyle = 'rgba(5,7,15,.62)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      const homeN = s.players.filter(p => p.team === 'home').length;
      const awayN = s.players.filter(p => p.team === 'away').length;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7dff43'; ctx.font = '900 46px Segoe UI, sans-serif';
      ctx.fillText('WAITING FOR OPPONENT…', WORLD_W / 2, WORLD_H / 2 - 18);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '700 26px Segoe UI, sans-serif';
      ctx.fillText(`HOME ${homeN}  vs  ${awayN} AWAY · need at least 1v1 to tip off`, WORLD_W / 2, WORLD_H / 2 + 28);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 20px Segoe UI, sans-serif';
      ctx.fillText('Share the link or open a second arena tab to test', WORLD_W / 2, WORLD_H / 2 + 64);
    }
  } else {
    // connecting…
    ctx.fillStyle = 'rgba(125,255,67,.9)'; ctx.font = '900 30px Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('Connecting to arena…', WORLD_W / 2, WORLD_H / 2);
  }
  endFrame();
}

function mySlot(s: RoomState): NetPlayer | undefined {
  const id = net?.assigned?.slotId; if (id == null) return undefined;
  return s.players.find(p => p.id === id);
}
function holderOf(s: RoomState): Player | null {
  if (s.ball.owner == null) return null;
  const np = s.players.find(p => p.id === s.ball.owner); if (!np) return null;
  return netToPlayer(np, net?.assigned?.slotId);
}
const FACES = ['🔥', '😤', '😎', '🤙', '👑', '🥶', '⚡', '💪'];
function netToPlayer(np: NetPlayer, myId?: number): Player {
  return {
    id: np.id, team: np.team, name: np.name,
    emoji: np.socketId ? '😎' : FACES[np.id % FACES.length],
    x: np.x, y: np.y, vx: np.vx, vy: np.vy, onGround: np.onGround,
    faceDir: np.faceDir, isUser: np.id === myId, role: 'guard',
    stats: { speed: 80, jump: 80, shooting: 80, defense: 80, stamina: 80, handling: 80 },
    stamina: 100, armT: np.armT, reachT: np.reachT, stunT: np.stunT, pumpT: np.pumpT,
    runPhase: np.runPhase, dunkT: np.dunkT,
  };
}

// ---------- client particle helpers (online) ----------
function spawnBurst(x: number, y: number, colors: string[], n: number, up: number) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 2;
    const v = 300 * (0.5 + Math.random());
    clientParticles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life: 0.8 * (0.7 + Math.random() * 0.6), maxLife: 0.9, size: 5 * (0.6 + Math.random() * 0.8), color: colors[(Math.random() * colors.length) | 0], grav: 1200, kind: 'spark' });
  }
}
function spawnRing(x: number, y: number) { clientParticles.push({ x, y, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, size: 20, color: '#7dff43', grav: 0, kind: 'ring' }); }
function updateClientParticles(dt: number) {
  for (let i = clientParticles.length - 1; i >= 0; i--) {
    const p = clientParticles[i]; p.life -= dt;
    if (p.life <= 0) { clientParticles.splice(i, 1); continue; }
    p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
  if (clientParticles.length > 400) clientParticles.splice(0, clientParticles.length - 400);
}

// ---------- shared frame helpers ----------
function beginFrame(shake: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const shx = shake > 0 ? (Math.random() - 0.5) * shake * scale : 0;
  const shy = shake > 0 ? (Math.random() - 0.5) * shake * scale : 0;
  ctx.setTransform(scale, 0, 0, scale, offX + shx, offY + shy);
}
function endFrame() {
  ctx.strokeStyle = 'rgba(125,255,67,.35)'; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);
}
function setTimer(t: number) {
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  timerEl.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
}

function endMatch(h: number, a: number) {
  $('#go-home').textContent = String(h); $('#go-away').textContent = String(a);
  $('#go-title').textContent = h > a ? 'YOU WIN! 🏆' : h < a ? 'YOU LOSE' : 'DRAW';
  $('#go-sub').textContent = h > a ? 'PUMP HIGH! 🔥' : h < a ? 'Run it back.' : 'Overtime vibes.';
  gameoverEl.classList.remove('hidden');
  Audio.play('whistle'); Audio.stopCrowd();
}

console.log('%cBASKETPUMP', 'color:#7dff43;font-weight:900;font-size:20px', '— Play Hard. Pump High.');

// ---------- CONTRACT ADDRESS ----------
// Set this string when the token launches; until then it shows "will update soon".
const CONTRACT_ADDRESS = ''; // e.g. 'So1aNa...pump'
(() => {
  const chip = document.querySelector('#ca-chip') as HTMLButtonElement | null;
  const valEl = document.querySelector('#ca-value') as HTMLElement | null;
  const copyEl = document.querySelector('#ca-copy') as HTMLElement | null;
  if (!chip || !valEl) return;
  const ca = CONTRACT_ADDRESS.trim();
  if (ca) {
    valEl.textContent = ca.length > 16 ? `${ca.slice(0, 6)}…${ca.slice(-5)}` : ca;
    valEl.classList.add('set');
    chip.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ca);
        if (copyEl) { const o = copyEl.textContent; copyEl.textContent = '✓'; setTimeout(() => { if (copyEl) copyEl.textContent = o; }, 1200); }
      } catch { /* clipboard blocked — no-op */ }
    });
  } else {
    valEl.textContent = 'will update soon';
    if (copyEl) copyEl.style.display = 'none';
    chip.style.cursor = 'default';
  }
})();

