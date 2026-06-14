import type { Team, NetPlayer, NetBall, RoomState, RoomSummary, InputPayload, NetParticleEvent } from './protocol';

// ===== world constants (must match client court.ts) =====
const WORLD_W = 1280, FLOOR_Y = 628, WALL = 26;
const PLAYER_W = 46, PLAYER_H = 96, BALL_R = 17;
const RIM_Y = 300, RIM_R = 34, POLE_X_L = 64, POLE_X_R = WORLD_W - 64, RIM_REACH = 92;
const GRAV = 2100, MOVE = 430, AIR_MOVE = 300, JUMP_V = 880, FRICTION = 0.82;
const MATCH_SECONDS = 180;

const targetRim = (t: Team) => t === 'home'
  ? { x: POLE_X_R - RIM_REACH, y: RIM_Y }
  : { x: POLE_X_L + RIM_REACH, y: RIM_Y };

interface Input extends InputPayload {}
const emptyInput = (): Input => ({ left: false, right: false, jump: false, grab: false, pass: false, charging: false, shootPower: 0 });

export class Room {
  code: string;
  status: 'waiting' | 'playing' | 'ended' = 'waiting';
  players: NetPlayer[] = [];
  ball: NetBall = { x: WORLD_W / 2, y: FLOOR_Y - 200, vx: 0, vy: 0, owner: null, inFlight: true, spin: 0 };
  scoreHome = 0; scoreAway = 0;
  timeLeft = MATCH_SECONDS;
  flashHome = 0; flashAway = 0;
  toast = '';
  private inputs = new Map<number, Input>();   // slotId -> latest input
  private ack = new Map<number, number>();      // slotId -> last processed input seq
  private fx: NetParticleEvent[] = [];
  private resetT = 0;
  private possession: Team = 'home';
  private endedAt = 0;

  constructor(code: string) {
    this.code = code;
    // No players until humans join. No bots — Quick Match is human-only (min 1v1 to play).
  }

  private nextId = 1;
  private makeHuman(team: Team, name: string, socketId: string): NetPlayer {
    const homeSide = team === 'home';
    const baseX = homeSide ? WORLD_W * 0.32 : WORLD_W * 0.68;
    const idx = this.players.filter(p => p.team === team).length; // 0..2
    const spread = (idx - 1) * 120 * (homeSide ? 1 : -1);
    return {
      id: this.nextId++, team, name, isBot: false, socketId,
      x: baseX + spread, y: FLOOR_Y, vx: 0, vy: 0, faceDir: homeSide ? 1 : -1, onGround: true,
      armT: 0, reachT: 0, stunT: 0, pumpT: 0, runPhase: 0, dunkT: 0, hasBall: false,
    };
  }

  // ---- membership ----
  humanCount() { return this.players.length; }   // every player is a human now
  capacity() { return 6; }
  hasHumans() { return this.players.length > 0; }
  private bothTeamsPresent() {
    return this.players.some(p => p.team === 'home') && this.players.some(p => p.team === 'away');
  }

  addHuman(socketId: string, name: string): NetPlayer | null {
    const homeH = this.players.filter(p => p.team === 'home').length;
    const awayH = this.players.filter(p => p.team === 'away').length;
    if (homeH + awayH >= 6) return null;
    // balance teams, respect 3-per-side cap
    let team: Team = homeH <= awayH ? 'home' : 'away';
    if (team === 'home' && homeH >= 3) team = 'away';
    if (team === 'away' && awayH >= 3) team = 'home';
    const slot = this.makeHuman(team, name && name.trim() ? name.trim().slice(0, 14) : 'Baller', socketId);
    this.players.push(slot);
    this.inputs.set(slot.id, emptyInput());
    this.checkStart();
    return slot;
  }

  removeHuman(socketId: string) {
    const i = this.players.findIndex(p => p.socketId === socketId);
    if (i < 0) return;
    const [slot] = this.players.splice(i, 1);
    this.inputs.delete(slot.id);
    this.ack.delete(slot.id);
    if (this.ball.owner === slot.id) { this.ball.owner = null; this.ball.inFlight = true; }
    if (!this.hasHumans()) this.resetMatch();   // empty room → idle reset
    else this.checkStart();                     // dropped below 1v1 → back to waiting
  }

  // Start the match once both teams have at least one human (1v1 minimum).
  private checkStart() {
    if (this.bothTeamsPresent()) {
      if (this.status === 'waiting') {
        this.status = 'playing';
        this.scoreHome = 0; this.scoreAway = 0; this.timeLeft = MATCH_SECONDS;
        this.possession = 'home'; this.toast = '';
        this.afterScoreReset();   // line everyone up + tip off the ball
      }
    } else if (this.status === 'playing') {
      this.status = 'waiting';    // a side emptied mid-game → pause
    }
  }

  setInput(slotId: number, input: Input) {
    this.inputs.set(slotId, input);
    if (typeof input.seq === 'number') this.ack.set(slotId, input.seq);
  }

  private resetMatch() {
    this.scoreHome = 0; this.scoreAway = 0; this.timeLeft = MATCH_SECONDS;
    this.status = 'waiting'; this.resetT = 0; this.toast = '';
    this.afterScoreReset();
  }

  summary(): RoomSummary {
    return {
      code: this.code, status: this.status, humans: this.humanCount(), capacity: this.capacity(),
      scoreHome: this.scoreHome, scoreAway: this.scoreAway, timeLeft: Math.ceil(this.timeLeft),
    };
  }

  snapshot(): RoomState {
    // stamp each slot with the last input seq we processed (for client reconciliation)
    for (const p of this.players) p.ack = this.ack.get(p.id) ?? 0;
    const s: RoomState = {
      code: this.code, status: this.status, scoreHome: this.scoreHome, scoreAway: this.scoreAway,
      timeLeft: this.timeLeft, players: this.players, ball: this.ball,
      flashHome: this.flashHome, flashAway: this.flashAway, fx: this.fx, toast: this.toast,
    };
    return s;
  }
  consumeFx() { const f = this.fx; this.fx = []; return f; }

  // ---- ball helpers ----
  private holder(): NetPlayer | null { return this.ball.owner == null ? null : this.players.find(p => p.id === this.ball.owner) || null; }
  private giveBallTo(p: NetPlayer) {
    this.players.forEach(q => q.hasBall = false);
    this.ball.owner = p.id; p.hasBall = true; this.ball.inFlight = false; this.ball.vx = this.ball.vy = 0;
    this.possession = p.team;
  }
  private ballPos() {
    const h = this.holder();
    if (h) return { x: h.x + h.faceDir * (PLAYER_W * 0.42), y: h.y - PLAYER_H * (0.5 - h.armT * 0.42) };
    return { x: this.ball.x, y: this.ball.y };
  }

  // ---- actions ----
  private jump(p: NetPlayer) {
    if (p.onGround && p.stunT <= 0) { p.vy = -JUMP_V; p.onGround = false; p.pumpT = 0; }
  }
  private doGrab(p: NetPlayer) {
    p.reachT = 1;
    if (this.ball.inFlight) {
      if (Math.hypot(this.ball.x - p.x, this.ball.y - (p.y - PLAYER_H * 0.5)) < 70) { this.giveBallTo(p); return; }
    }
    const h = this.holder();
    if (h && h.team !== p.team && Math.abs(h.x - p.x) < 64 && Math.abs(h.y - p.y) < 60) {
      if (Math.random() < 0.5) { this.giveBallTo(p); h.stunT = 0.3; }
    }
  }
  private doPass(p: NetPlayer) {
    if (this.ball.owner !== p.id) return;
    const mates = this.players.filter(q => q.team === p.team && q.id !== p.id);
    if (!mates.length) return;
    mates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    const t = mates[0];
    this.launch(t.x, t.y - PLAYER_H * 0.5, 1, p);
  }
  private doShoot(p: NetPlayer, power: number) {
    if (this.ball.owner !== p.id) return;
    this.shootAt(p, targetRim(p.team), power);
  }
  private shootAt(p: NetPlayer, rim: { x: number; y: number }, power: number) {
    const from = this.ballPos();
    const dx = rim.x - from.x, dy = rim.y - from.y, dist = Math.abs(dx);
    const T = Math.max(0.55, Math.min(1.15, 0.6 + dist / 1600));
    let vx = dx / T, vy = (dy - 0.5 * GRAV * T * T) / T;
    const err = (1 - power) * 0.9 + 0.12;
    const miss = (Math.random() - 0.5) * err;
    vx *= 1 + miss * 0.5; vy *= 1 + miss * 0.6;
    this.players.forEach(q => q.hasBall = false);
    this.ball.owner = null; this.ball.inFlight = true;
    this.ball.x = from.x; this.ball.y = from.y; this.ball.vx = vx; this.ball.vy = vy;
    p.armT = 1; this.grabLock = 0.25;
  }
  private launch(tx: number, ty: number, power: number, from: NetPlayer) {
    const fp = this.ballPos();
    const dx = tx - fp.x, dy = ty - fp.y;
    const T = Math.max(0.3, Math.min(0.7, Math.abs(dx) / 1200 + 0.3));
    const vx = dx / T, vy = (dy - 0.5 * GRAV * T * T) / T;
    this.players.forEach(q => q.hasBall = false);
    this.ball.owner = null; this.ball.inFlight = true;
    this.ball.x = fp.x; this.ball.y = fp.y; this.ball.vx = vx * power; this.ball.vy = vy * power;
    void from; this.grabLock = 0.12;
  }

  // ---- tick ----
  private grabLock = 0; private scoreLock = 0;
  tick(dt: number) {
    if (this.resetT > 0) { this.resetT -= dt; if (this.resetT <= 0) this.afterScoreReset(); }
    else if (this.status === 'playing') this.timeLeft = Math.max(0, this.timeLeft - dt);

    this.flashHome = Math.max(0, this.flashHome - dt);
    this.flashAway = Math.max(0, this.flashAway - dt);
    this.grabLock = Math.max(0, this.grabLock - dt);
    this.scoreLock = Math.max(0, this.scoreLock - dt);

    // apply human inputs
    for (const p of this.players) {
      const inp = this.inputs.get(p.id) || emptyInput();
      if (p.stunT > 0) p.stunT -= dt;
      if (this.resetT <= 0 && p.stunT <= 0) {
        const accel = p.onGround ? MOVE : AIR_MOVE;
        if (inp.left) { p.vx = -accel; p.faceDir = -1; }
        else if (inp.right) { p.vx = accel; p.faceDir = 1; }
        else if (p.onGround) p.vx *= FRICTION;
      }
      p.pumpT = inp.charging && p.onGround ? Math.min(1, p.pumpT + dt * 4) : Math.max(0, p.pumpT - dt * 6);
      if (inp.jump) { this.jump(p); inp.jump = false; }
      if (inp.grab) { this.doGrab(p); inp.grab = false; }
      if (inp.pass) { this.doPass(p); inp.pass = false; }
      if (inp.shootPower > 0) { this.doShoot(p, inp.shootPower); inp.shootPower = 0; inp.charging = false; }
      if (this.ball.owner === p.id) { const rim = targetRim(p.team); p.faceDir = rim.x > p.x ? 1 : -1; }
    }

    // integrate
    for (const p of this.players) {
      if (!p.onGround) p.vy += GRAV * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < WALL + PLAYER_W / 2) { p.x = WALL + PLAYER_W / 2; p.vx = 0; }
      if (p.x > WORLD_W - WALL - PLAYER_W / 2) { p.x = WORLD_W - WALL - PLAYER_W / 2; p.vx = 0; }
      if (p.y >= FLOOR_Y) { p.y = FLOOR_Y; p.vy = 0; p.onGround = true; } else p.onGround = false;
      p.armT = Math.max(0, p.armT - dt * 3);
      p.reachT = Math.max(0, p.reachT - dt * 4);
      p.dunkT = Math.max(0, p.dunkT - dt * 2.2);
      if (Math.abs(p.vx) > 12 && p.onGround) p.runPhase += dt * 16; else p.runPhase = 0;
    }

    this.tryDunk();
    this.integrateBall(dt);

    if (this.timeLeft <= 0 && this.status === 'playing') {
      this.status = 'ended'; this.endedAt = Date.now();
    }
    // auto-restart an ended match a few seconds later if both teams still present
    if (this.status === 'ended' && Date.now() - this.endedAt > 6000) {
      if (this.bothTeamsPresent()) this.resetMatchKeepHumans();
      else if (this.hasHumans()) { this.status = 'waiting'; }
      else this.resetMatch();
    }
  }

  private resetMatchKeepHumans() {
    this.scoreHome = 0; this.scoreAway = 0; this.timeLeft = MATCH_SECONDS;
    this.status = 'playing'; this.toast = ''; this.afterScoreReset();
  }

  private integrateBall(dt: number) {
    const b = this.ball;
    if (!b.inFlight) { return; }
    b.vy += GRAV * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.spin += b.vx * dt * 0.01;
    if (b.x < WALL + BALL_R) { b.x = WALL + BALL_R; b.vx = Math.abs(b.vx) * 0.6; }
    if (b.x > WORLD_W - WALL - BALL_R) { b.x = WORLD_W - WALL - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; }
    if (b.y > FLOOR_Y - BALL_R) { b.y = FLOOR_Y - BALL_R; b.vy = -Math.abs(b.vy) * 0.55; b.vx *= 0.8; if (Math.abs(b.vy) < 60) b.vy = 0; }
    this.checkHoop('home'); this.checkHoop('away');
    for (const px of [POLE_X_L, POLE_X_R]) {
      if (Math.abs(b.x - px) < BALL_R + 6 && b.y > RIM_Y - 60 && b.y < FLOOR_Y) {
        b.x += (b.x < px ? -1 : 1) * (BALL_R + 6 - Math.abs(b.x - px)); b.vx *= -0.5;
      }
    }
    if (this.grabLock <= 0) {
      for (const p of this.players) {
        const hx = p.x, hy = p.y - PLAYER_H * 0.5;
        if (Math.hypot(b.x - hx, b.y - hy) < 46) { this.giveBallTo(p); break; }
      }
    }
  }

  private checkHoop(team: Team) {
    const b = this.ball, rim = targetRim(team);
    if (this.scoreLock <= 0 && b.vy > 0 && Math.abs(b.x - rim.x) < RIM_R * 0.7 && b.y > rim.y - 8 && b.y < rim.y + 18) {
      this.score(team); this.scoreLock = 1; return;
    }
    for (const edge of [rim.x - RIM_R, rim.x + RIM_R]) {
      if (Math.hypot(b.x - edge, b.y - rim.y) < BALL_R + 4) {
        const nx = b.x - edge, ny = b.y - rim.y, len = Math.hypot(nx, ny) || 1;
        const dot = (b.vx * nx + b.vy * ny) / len;
        b.vx -= 2 * dot * nx / len * 0.6; b.vy -= 2 * dot * ny / len * 0.6;
      }
    }
  }

  private tryDunk() {
    if (this.resetT > 0) return;
    const h = this.holder(); if (!h || h.onGround) return;
    const rim = targetRim(h.team);
    if (Math.abs(h.x - rim.x) < 56 && (h.y - PLAYER_H * 0.55) < rim.y + 30 && h.vy < 120) {
      h.dunkT = 1; h.armT = 1;
      this.players.forEach(q => q.hasBall = false);
      this.ball.owner = null; this.ball.inFlight = true;
      this.ball.x = rim.x; this.ball.y = rim.y - 6; this.ball.vx = 0; this.ball.vy = 240;
      this.grabLock = 0.3;
      this.toast = 'SLAM DUNK! 🔥';
      this.fx.push({ kind: 'dunk', team: h.team, x: rim.x, y: rim.y });
    }
  }

  private score(team: Team) {
    if (team === 'home') { this.scoreHome += 2; this.flashHome = 0.8; } else { this.scoreAway += 2; this.flashAway = 0.8; }
    const rim = targetRim(team);
    this.fx.push({ kind: 'score', team, x: rim.x, y: rim.y });
    this.toast = team === 'home' ? 'BUCKET! +2 🟢' : 'AWAY +2';
    this.resetT = 1.4; this.ball.vy = 200; this.ball.vx *= 0.2;
    this.possession = team === 'home' ? 'away' : 'home';
  }

  private afterScoreReset() {
    for (const p of this.players) {
      const homeSide = p.team === 'home';
      const idx = this.players.filter(q => q.team === p.team).indexOf(p);
      p.x = (homeSide ? WORLD_W * 0.32 : WORLD_W * 0.68) + (idx - 1) * 120 * (homeSide ? 1 : -1);
      p.y = FLOOR_Y; p.vx = p.vy = 0; p.onGround = true; p.stunT = 0; p.faceDir = homeSide ? 1 : -1;
    }
    const taker = this.players.find(p => p.team === this.possession) || this.players[0];
    if (taker) { this.giveBallTo(taker); }
    else { this.ball.owner = null; this.ball.inFlight = true; this.ball.x = WORLD_W / 2; this.ball.y = FLOOR_Y - 200; this.ball.vx = this.ball.vy = 0; }
    this.toast = '';
  }
}
