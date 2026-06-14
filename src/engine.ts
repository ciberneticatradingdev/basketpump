import type { Player, Ball, Team, MatchConfig, Stats, Particle } from './types';
import {
  WORLD_W, FLOOR_Y, WALL, PLAYER_W, PLAYER_H, BALL_R,
  targetRim, RIM_R, RIM_Y, POLE_X_L, POLE_X_R, RIM_REACH,
} from './court';
import type { Sfx } from './audio';

export interface UserInput {
  left: boolean; right: boolean; jumpHeld: boolean;
}

export interface EngineHooks {
  onScore: (t: Team) => void;
  onToast: (m: string) => void;
  onSound: (s: Sfx) => void;
}

const GRAV = 2100;          // px/s^2
const MOVE = 430;           // ground move speed
const AIR_MOVE = 300;
const JUMP_V = 880;         // jump impulse
const FRICTION = 0.82;

const HOME_NAMES = ['ApeDunker', 'GreenMamba', 'PumpKing', 'Saber', 'Lolo', 'ChainHooper'];
const AWAY_NAMES = ['DiamondSnipr', 'RedRocket', 'FadeGod', 'NightOwl', 'BlazeRun', 'IcePick'];
const FACES = ['🔥', '😤', '😎', '🤙', '👑', '🥶', '⚡', '💪'];

function mkStats(seed: number): Stats {
  const r = (a: number, b: number) => Math.floor(a + ((Math.sin(seed++ * 12.9898) * 43758.5453) % 1 + 1) % 1 * (b - a));
  return { speed: r(60, 95), jump: r(55, 95), shooting: r(55, 92), defense: r(55, 90), stamina: r(60, 95), handling: r(55, 92) };
}

export class Engine {
  players: Player[] = [];
  ball: Ball;
  user!: Player;
  scoreHome = 0; scoreAway = 0;
  timeLeft: number;
  running = false;
  flash = { home: 0, away: 0 };          // rim score flashes
  particles: Particle[] = [];            // visual FX
  shake = 0;                             // screen-shake intensity
  private hooks: EngineHooks;
  private possessionTeam: Team = 'home';
  private resetT = 0;                      // freeze timer after a score

  constructor(cfg: MatchConfig, hooks: EngineHooks) {
    this.hooks = hooks;
    this.timeLeft = cfg.minutes * 60;
    this.ball = {
      x: WORLD_W / 2, y: FLOOR_Y - 200, vx: 0, vy: 0, owner: null,
      inFlight: true, spin: 0, lastShooter: null, lastShotTeam: null, scoreLock: 0, grabLock: 0,
    };
    this.spawnTeams();
    this.giveBallTo(this.players[0]);      // user starts with the rock
  }

  private spawnTeams() {
    let id = 1;
    // 3 home (attack right), 3 away (attack left)
    const make = (team: Team, idx: number, names: string[]): Player => {
      const homeSide = team === 'home';
      const baseX = homeSide ? WORLD_W * 0.32 : WORLD_W * 0.68;
      const spread = (idx - 1) * 120 * (homeSide ? 1 : -1);
      return {
        id: id++, team, name: names[idx % names.length],
        emoji: FACES[(id + idx) % FACES.length],
        x: baseX + spread, y: FLOOR_Y, vx: 0, vy: 0, onGround: true,
        faceDir: homeSide ? 1 : -1, isUser: false, role: idx === 2 ? 'big' : 'guard',
        stats: mkStats(id * 7 + idx), stamina: 100,
        armT: 0, reachT: 0, stunT: 0, pumpT: 0, runPhase: Math.random() * 6, dunkT: 0,
      };
    };
    for (let i = 0; i < 3; i++) this.players.push(make('home', i, HOME_NAMES));
    for (let i = 0; i < 3; i++) this.players.push(make('away', i, AWAY_NAMES));
    this.user = this.players[0];
    this.user.isUser = true;
    this.user.name = 'YOU';
    this.user.emoji = '😎';
  }

  // ---------- ball helpers ----------
  giveBallTo(p: Player) {
    this.ball.owner = p.id; this.ball.inFlight = false; this.ball.vx = this.ball.vy = 0;
    this.possessionTeam = p.team;
  }
  holder(): Player | null {
    if (this.ball.owner == null) return null;
    return this.players.find(p => p.id === this.ball.owner) || null;
  }
  userHasBall() { return this.ball.owner === this.user.id; }

  private ballPos(): { x: number; y: number } {
    const h = this.holder();
    if (h) return { x: h.x + h.faceDir * (PLAYER_W * 0.42), y: h.y - PLAYER_H * (0.5 - h.armT * 0.42) };
    return { x: this.ball.x, y: this.ball.y };
  }

  // ---------- user actions ----------
  jump(p: Player) {
    if (p.onGround && p.stunT <= 0) {
      const jb = 1 + (p.stats.jump - 70) / 200;
      p.vy = -JUMP_V * jb; p.onGround = false; p.pumpT = 0;
      this.hooks.onSound('dribble');
    }
  }

  grab() {
    // user tries to grab a loose ball, or steal from a nearby opponent
    const u = this.user; u.reachT = 1;
    if (this.ball.inFlight && this.ball.grabLock <= 0) {
      const bp = { x: this.ball.x, y: this.ball.y };
      if (Math.hypot(bp.x - u.x, bp.y - (u.y - PLAYER_H * 0.5)) < 70) { this.giveBallTo(u); this.hooks.onSound('steal'); this.hooks.onToast(''); return; }
    }
    const h = this.holder();
    if (h && h.team !== u.team) {
      if (Math.abs(h.x - u.x) < 64 && Math.abs(h.y - u.y) < 60) {
        // steal chance based on defense vs handling
        const chance = 0.45 + (u.stats.defense - h.stats.handling) / 200;
        if (Math.random() < chance) { this.giveBallTo(u); this.hooks.onSound('steal'); this.hooks.onToast('STEAL!'); h.stunT = 0.3; }
      }
    }
  }

  pass() {
    const u = this.user; if (this.ball.owner !== u.id) return;
    // pass to nearest teammate ahead
    const mates = this.players.filter(p => p.team === u.team && p.id !== u.id);
    if (!mates.length) return;
    mates.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    const t = mates[0];
    this.launchBall(t.x, t.y - PLAYER_H * 0.5, 1.0, u, false);
    this.hooks.onSound('pass');
  }

  shoot(power: number) {
    const u = this.user; if (this.ball.owner !== u.id) return;
    const rim = targetRim(u.team);
    this.shootAt(u, rim, power);
  }

  private shootAt(p: Player, rim: { x: number; y: number }, power: number) {
    const from = this.ballPos();
    // ballistic solve: pick a nice arc, scale velocity by power & shooting stat
    const dx = rim.x - from.x;
    const dy = rim.y - from.y;
    const dist = Math.abs(dx);
    // perfect power for the distance, then apply player's power input as accuracy
    const g = GRAV;
    // choose flight time from an arc height proportional to distance
    const T = Math.max(0.55, Math.min(1.15, 0.6 + dist / 1600));
    let vx = dx / T;
    let vy = (dy - 0.5 * g * T * T) / T;
    // accuracy: how close power is to 1.0 (a full charge ~ perfect), plus shooting skill
    const skill = p.stats.shooting / 100;
    const err = (1 - power) * 0.9 + (1 - skill) * 0.25;
    const miss = (Math.random() - 0.5) * err;
    vx *= 1 + miss * 0.5;
    vy *= 1 + miss * 0.6;
    this.ball.owner = null; this.ball.inFlight = true;
    this.ball.x = from.x; this.ball.y = from.y;
    this.ball.vx = vx; this.ball.vy = vy;
    this.ball.lastShooter = p.id; this.ball.lastShotTeam = p.team;
    this.ball.scoreLock = 0; this.ball.grabLock = 0.25;
    p.armT = 1;
    this.hooks.onSound('shoot');
  }

  private launchBall(tx: number, ty: number, power: number, from: Player, _arc: boolean) {
    const fp = this.ballPos();
    const dx = tx - fp.x, dy = ty - fp.y;
    const T = Math.max(0.3, Math.min(0.7, Math.abs(dx) / 1200 + 0.3));
    const vx = dx / T;
    const vy = (dy - 0.5 * GRAV * T * T) / T;
    this.ball.owner = null; this.ball.inFlight = true;
    this.ball.x = fp.x; this.ball.y = fp.y;
    this.ball.vx = vx * power; this.ball.vy = vy * power;
    this.ball.lastShooter = from.id; this.ball.lastShotTeam = null;
    this.ball.grabLock = 0.12;
  }

  // ---------- particles ----------
  private burst(x: number, y: number, opts: { n: number; colors: string[]; speed: number; kind?: Particle['kind']; spread?: number; up?: number; size?: number; grav?: number; life?: number }) {
    const { n, colors, speed, kind = 'spark', spread = Math.PI * 2, up = 0, size = 4, grav = 1400, life = 0.6 } = opts;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const v = speed * (0.5 + Math.random());
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - up,
        life: life * (0.7 + Math.random() * 0.6), maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        grav, kind,
      });
    }
  }

  private ring(x: number, y: number, color: string, size = 30) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, size, color, grav: 0, kind: 'ring' });
  }

  private updateParticles(dt: number) {
    const arr = this.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind !== 'ring' && p.y > FLOOR_Y) { p.y = FLOOR_Y; p.vy *= -0.4; p.vx *= 0.7; }
    }
    if (arr.length > 400) arr.splice(0, arr.length - 400);
    this.shake = Math.max(0, this.shake - dt * 60);
  }

  // ---------- main step ----------
  step(dt: number, input: UserInput, charging: boolean) {
    if (!this.running) return;
    if (this.resetT > 0) { this.resetT -= dt; if (this.resetT <= 0) this.afterScoreReset(); }
    else this.timeLeft = Math.max(0, this.timeLeft - dt);

    this.flash.home = Math.max(0, this.flash.home - dt);
    this.flash.away = Math.max(0, this.flash.away - dt);
    this.ball.scoreLock = Math.max(0, this.ball.scoreLock - dt);
    this.ball.grabLock = Math.max(0, this.ball.grabLock - dt);

    // USER movement
    const u = this.user;
    if (u.stunT > 0) u.stunT -= dt;
    if (this.resetT <= 0 && u.stunT <= 0) {
      const accel = u.onGround ? MOVE : AIR_MOVE;
      const sp = 1 + (u.stats.speed - 70) / 220;
      if (input.left) { u.vx = -accel * sp; u.faceDir = -1; }
      else if (input.right) { u.vx = accel * sp; u.faceDir = 1; }
      else if (u.onGround) u.vx *= FRICTION;
      // jump handled on keydown in main; but allow held re-jump grace
    }
    // hold-to-charge crouch anticipation
    u.pumpT = charging && u.onGround ? Math.min(1, u.pumpT + dt * 4) : Math.max(0, u.pumpT - dt * 6);

    // AI for the other 5
    for (const p of this.players) {
      if (p.isUser) continue;
      this.aiThink(p, dt);
    }

    // integrate all players
    for (const p of this.players) {
      const wasAir = !p.onGround;
      const fallV = p.vy;
      this.integratePlayer(p, dt);
      // landing dust when a fast fall hits the floor
      if (wasAir && p.onGround && fallV > 520) {
        this.burst(p.x, FLOOR_Y + 2, { n: 8, colors: ['rgba(220,220,210,.9)', 'rgba(180,180,170,.7)'], speed: 140, kind: 'dust', spread: Math.PI, up: 30, size: 5, grav: 600, life: 0.4 });
      }
      // arm/reach decay
      p.armT = Math.max(0, p.armT - dt * 3);
      p.reachT = Math.max(0, p.reachT - dt * 4);
      p.dunkT = Math.max(0, p.dunkT - dt * 2.2);
      if (Math.abs(p.vx) > 12 && p.onGround) p.runPhase += dt * 16; else p.runPhase = 0;
    }

    // try dunk: ball-carrier high up & close to their rim → slam it
    this.tryDunk();

    // particles + screenshake
    this.updateParticles(dt);

    // ball physics
    this.integrateBall(dt);

    // user auto-aim facing toward target hoop when holding
    if (this.userHasBall()) {
      const rim = targetRim(u.team);
      u.faceDir = rim.x > u.x ? 1 : -1;
    }

    // stamina drain/regen
    const moving = input.left || input.right;
    u.stamina = Math.max(0, Math.min(100, u.stamina + (moving ? -dt * 4 : dt * 8)));
  }

  private integratePlayer(p: Player, dt: number) {
    if (!p.onGround) p.vy += GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    // walls
    if (p.x < WALL + PLAYER_W / 2) { p.x = WALL + PLAYER_W / 2; p.vx = 0; }
    if (p.x > WORLD_W - WALL - PLAYER_W / 2) { p.x = WORLD_W - WALL - PLAYER_W / 2; p.vx = 0; }
    // floor
    if (p.y >= FLOOR_Y) { p.y = FLOOR_Y; p.vy = 0; p.onGround = true; }
    else p.onGround = false;
  }

  private integrateBall(dt: number) {
    const b = this.ball;
    if (!b.inFlight) { b.spin += (this.holder()?.vx || 0) * dt * 0.02; return; }
    b.vy += GRAV * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.spin += b.vx * dt * 0.01;

    // walls / floor bounce
    if (b.x < WALL + BALL_R) { b.x = WALL + BALL_R; b.vx = Math.abs(b.vx) * 0.6; }
    if (b.x > WORLD_W - WALL - BALL_R) { b.x = WORLD_W - WALL - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; }
    if (b.y > FLOOR_Y - BALL_R) {
      b.y = FLOOR_Y - BALL_R; b.vy = -Math.abs(b.vy) * 0.55; b.vx *= 0.8;
      if (Math.abs(b.vy) < 60) { b.vy = 0; }
      this.hooks.onSound('dribble');
    }

    // rim collision + scoring for both hoops
    this.checkHoop(b, 'home');   // right rim
    this.checkHoop(b, 'away');   // left rim

    // pole collision (bounce off the post)
    for (const px of [POLE_X_L, POLE_X_R]) {
      if (Math.abs(b.x - px) < BALL_R + 6 && b.y > RIM_Y - 60 && b.y < FLOOR_Y) {
        b.x += (b.x < px ? -1 : 1) * (BALL_R + 6 - Math.abs(b.x - px));
        b.vx *= -0.5;
      }
    }

    // pick up loose ball by any player near it
    if (b.grabLock <= 0) {
      for (const p of this.players) {
        const hx = p.x, hy = p.y - PLAYER_H * 0.5;
        if (Math.hypot(b.x - hx, b.y - hy) < 46) {
          // user must press grab; AI auto-grabs
          if (!p.isUser) { this.giveBallTo(p); this.hooks.onToast(''); break; }
        }
      }
    }
  }

  private checkHoop(b: Ball, team: Team) {
    const rim = targetRim(team);
    // scoring: ball passes down through the rim plane within RIM_R, moving downward
    if (b.scoreLock <= 0 && b.vy > 0 &&
        Math.abs(b.x - rim.x) < RIM_R * 0.7 &&
        b.y > rim.y - 8 && b.y < rim.y + 18) {
      this.score(team);
      b.scoreLock = 1;
      return;
    }
    // rim edges bounce (two small bumpers at +/- RIM_R)
    for (const edge of [rim.x - RIM_R, rim.x + RIM_R]) {
      if (Math.hypot(b.x - edge, b.y - rim.y) < BALL_R + 4) {
        const nx = b.x - edge, ny = b.y - rim.y; const len = Math.hypot(nx, ny) || 1;
        const dot = (b.vx * nx + b.vy * ny) / len;
        b.vx -= 2 * dot * nx / len * 0.6; b.vy -= 2 * dot * ny / len * 0.6;
        this.hooks.onSound('rim');
      }
    }
  }

  // dunk: ball-carrier airborne and very close to their own rim → auto-slam
  private tryDunk() {
    if (this.resetT > 0) return;
    const h = this.holder();
    if (!h || h.onGround) return;
    const rim = targetRim(h.team);
    const nearX = Math.abs(h.x - rim.x) < 56;
    const highEnough = (h.y - PLAYER_H * 0.55) < rim.y + 30;   // hands reach rim level
    const rising = h.vy < 120;
    if (nearX && highEnough && rising) {
      // SLAM
      h.dunkT = 1; h.armT = 1;
      this.ball.owner = null; this.ball.inFlight = true;
      this.ball.x = rim.x; this.ball.y = rim.y - 6;
      this.ball.vx = 0; this.ball.vy = 240;        // drive it straight down
      this.ball.lastShooter = h.id; this.ball.lastShotTeam = h.team;
      this.ball.scoreLock = 0; this.ball.grabLock = 0.3;
      this.hooks.onSound('dunk');
      this.hooks.onToast(h.isUser ? 'SLAM DUNK! 🔥' : 'DUNK!');
      this.shake = 14;
      // explosion of sparks at the rim
      this.burst(rim.x, rim.y, { n: 22, colors: ['#7dff43', '#bfff58', '#ffd23b', '#ffffff'], speed: 360, up: 60, size: 5, life: 0.7 });
      this.ring(rim.x, rim.y, '#7dff43', 22);
    }
  }

  private score(team: Team) {
    if (team === 'home') { this.scoreHome += 2; this.flash.home = 0.8; }
    else { this.scoreAway += 2; this.flash.away = 0.8; }
    this.hooks.onSound('swish');
    // confetti + ring burst at the scoring rim
    const rim = targetRim(team);
    const teamCols = team === 'home'
      ? ['#7dff43', '#bfff58', '#5cd02e', '#ffffff']
      : ['#ec4040', '#ffd0d0', '#ff7a1a', '#ffffff'];
    this.burst(rim.x, rim.y + 30, { n: 26, colors: teamCols, speed: 300, up: 120, size: 5, life: 0.9, grav: 1200 });
    this.ring(rim.x, rim.y, '#7dff43', 18);
    this.shake = Math.max(this.shake, 8);
    this.hooks.onToast(team === 'home' ? 'BUCKET! +2 🟢' : 'AWAY SCORES +2');
    this.hooks.onScore(team);
    this.resetT = 1.4;
    // ball drops through net
    this.ball.vy = 200; this.ball.vx *= 0.2;
    // possession to conceding team
    this.possessionTeam = team === 'home' ? 'away' : 'home';
  }

  private afterScoreReset() {
    // reset positions, give ball to conceding team's guard
    for (const p of this.players) {
      const homeSide = p.team === 'home';
      const idx = this.players.filter(q => q.team === p.team).indexOf(p);
      p.x = (homeSide ? WORLD_W * 0.32 : WORLD_W * 0.68) + (idx - 1) * 120 * (homeSide ? 1 : -1);
      p.y = FLOOR_Y; p.vx = p.vy = 0; p.onGround = true; p.stunT = 0;
      p.faceDir = homeSide ? 1 : -1;
    }
    const taker = this.players.find(p => p.team === this.possessionTeam) || this.players[0];
    this.giveBallTo(taker);
    this.hooks.onToast('');
  }

  // ---------- AI ----------
  private aiThink(p: Player, dt: number) {
    if (this.resetT > 0) return;
    if (p.stunT > 0) { p.stunT -= dt; p.vx *= 0.8; return; }
    const has = this.ball.owner === p.id;
    const sp = 1 + (p.stats.speed - 70) / 220;
    const teamHasBall = this.possessionTeam === p.team;
    const rim = targetRim(p.team);

    if (has) {
      // drive toward own target rim, shoot when in range
      const dist = Math.abs(rim.x - p.x);
      p.faceDir = rim.x > p.x ? 1 : -1;
      if (dist > 360) { p.vx = MOVE * sp * p.faceDir; }
      else {
        p.vx *= FRICTION;
        // sometimes pass, mostly shoot
        if (Math.random() < dt * 0.6) {
          if (Math.random() < 0.25) {
            const mate = this.players.find(q => q.team === p.team && q.id !== p.id);
            if (mate) this.launchBall(mate.x, mate.y - PLAYER_H * 0.5, 1, p, false);
          } else {
            const power = 0.8 + Math.random() * 0.2;
            this.shootAt(p, rim, power);
          }
        } else if (p.onGround && Math.random() < dt * 1.2) {
          this.jump(p);
        }
      }
    } else if (teamHasBall) {
      // get open: spread into distinct lanes toward own rim side
      const mates = this.players.filter(q => q.team === p.team);
      const lane = mates.indexOf(p);                  // 0,1,2
      const spread = (lane - 1) * 240;
      const target = rim.x - p.faceDir * 150 + spread;
      this.aiSeek(p, target, sp, dt, 0.55);
    } else {
      // defense: closest defender chases the ball; others guard lanes (no stacking)
      const h = this.holder();
      const defenders = this.players.filter(q => q.team === p.team)
        .sort((a, b) => Math.abs(a.x - this.ball.x) - Math.abs(b.x - this.ball.x));
      const role = defenders.indexOf(p);
      if (role === 0) {
        const tx = h ? h.x : this.ball.x;
        this.aiSeek(p, tx, sp, dt, 1.0);
      } else {
        // hang back guarding own rim, spaced
        const guardX = rim.x + p.faceDir * (180 + role * 160);
        this.aiSeek(p, guardX, sp, dt, 0.6);
      }
      // contest / steal if close (with cooldown so it's not instant)
      if (h && h.team !== p.team && Math.abs(h.x - p.x) < 52 && Math.abs(h.y - p.y) < 60 && p.reachT <= 0 && Math.random() < dt * 0.5) {
        p.reachT = 1;
        const chance = 0.18 + (p.stats.defense - h.stats.handling) / 320;
        if (Math.random() < chance) { this.giveBallTo(p); this.hooks.onSound('steal'); h.stunT = 0.25; }
      }
      // jump to block a ball in flight overhead
      if (this.ball.inFlight && p.onGround && Math.abs(this.ball.x - p.x) < 50 && this.ball.y < p.y - 40 && Math.random() < dt * 2) {
        this.jump(p);
      }
    }
  }

  private aiSeek(p: Player, targetX: number, sp: number, _dt: number, aggression: number) {
    const dx = targetX - p.x;
    if (Math.abs(dx) > 14) { p.vx = MOVE * sp * aggression * Math.sign(dx); p.faceDir = Math.sign(dx) as 1 | -1; }
    else p.vx *= FRICTION;
  }
}

export { RIM_R, RIM_Y, RIM_REACH, POLE_X_L, POLE_X_R };
