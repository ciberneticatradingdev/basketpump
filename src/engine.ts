import type { Player, Ball, Team, Stats, MatchConfig } from './types';
import { COURT_W, COURT_H, MARGIN, PLAYER_R, BALL_R, HOOP_R, hoopFor } from './court';

function normAng(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

const HOME_NAMES = ['Quin', 'Saber', 'Pump'];
const AWAY_NAMES = ['Vex', 'Ryo', 'Dash'];

function mkStats(role: 'guard' | 'wing' | 'big', base: number): Stats {
  const j = () => Math.round(base + (Math.random() * 16 - 8));
  if (role === 'guard') return { speed: j() + 8, passing: j() + 10, shooting: j() + 4, defense: j(), stamina: j() + 6, dribbling: j() + 12 };
  if (role === 'big') return { speed: j() - 6, passing: j(), shooting: j() - 2, defense: j() + 12, stamina: j() - 2, dribbling: j() - 8 };
  return { speed: j() + 2, passing: j(), shooting: j() + 10, defense: j() + 4, stamina: j(), dribbling: j() + 2 };
}
const clampStat = (s: Stats): Stats => {
  for (const k in s) (s as any)[k] = Math.max(35, Math.min(99, (s as any)[k]));
  return s;
};

export interface Events {
  onScore?: (t: Team, pts: number) => void;
  onToast?: (msg: string) => void;
  onSound?: (s: 'shoot' | 'swish' | 'rim' | 'pass' | 'steal' | 'dribble' | 'whistle') => void;
}

export class Engine {
  players: Player[] = [];
  ball!: Ball;
  scoreHome = 0; scoreAway = 0;
  timeLeft: number;
  running = false;
  practice: boolean;
  userId = 1;
  private ev: Events;
  private resetTimer = 0;
  private possessionTeam: Team = 'home';

  constructor(cfg: MatchConfig, ev: Events) {
    this.ev = ev;
    this.timeLeft = cfg.minutes * 60;
    this.practice = cfg.mode === 'practice';
    this.spawn(cfg);
  }

  private spawn(cfg: MatchConfig) {
    const roles: ('guard' | 'wing' | 'big')[] = ['guard', 'wing', 'big'];
    let id = 1;
    const cy = COURT_H / 2;
    // home (left side start), user is id 1
    for (let i = 0; i < 3; i++) {
      this.players.push({
        id: id, team: 'home', name: HOME_NAMES[i], role: roles[i],
        x: COURT_W * 0.5 - 140, y: cy + (i - 1) * 150, vx: 0, vy: 0, facing: 0,
        stats: clampStat(mkStats(roles[i], 74)), stamina: 100,
        isUser: id === this.userId, cooldown: 0, shakeT: 0,
      }); id++;
    }
    const awayCount = cfg.mode === 'practice' ? 2 : 3;
    for (let i = 0; i < awayCount; i++) {
      this.players.push({
        id: id, team: 'away', name: AWAY_NAMES[i], role: roles[i],
        x: COURT_W * 0.5 + 140, y: cy + (i - 1) * 150, vx: 0, vy: 0, facing: Math.PI,
        stats: clampStat(mkStats(roles[i], cfg.mode === 'ranked' ? 78 : 70)), stamina: 100,
        isUser: false, cooldown: 0, shakeT: 0,
      }); id++;
    }
    this.ball = {
      x: COURT_W / 2, y: cy, vx: 0, vy: 0, z: 0, vz: 0,
      state: 'held', owner: this.userId, tx: 0, ty: 0, kind: 'loose',
      shotTeam: null, shotMake: false, lastTouch: this.userId,
    };
  }

  get user() { return this.players.find(p => p.id === this.userId)!; }
  playerById(id: number | null) { return id == null ? null : this.players.find(p => p.id === id) || null; }
  teammates(t: Team) { return this.players.filter(p => p.team === t); }

  // ---------- USER ACTIONS ----------
  userHasBall() { return this.ball.state === 'held' && this.ball.owner === this.userId; }

  doPass(power: number) {
    const u = this.user;
    if (!this.userHasBall()) return;
    // pick teammate in facing direction (or nearest forward)
    const mates = this.teammates(u.team).filter(p => p.id !== u.id);
    if (!mates.length) return;
    let best = mates[0], bestScore = -1e9;
    for (const m of mates) {
      const ang = Math.atan2(m.y - u.y, m.x - u.x);
      let d = Math.abs(normAng(ang - u.facing));
      const dist = Math.hypot(m.x - u.x, m.y - u.y);
      const score = -d * 220 - dist * 0.25;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    const kind = power > 0.66 ? 'lob' : power < 0.3 ? 'bounce' : 'pass';
    this.launchPass(u, best.x, best.y, kind, power);
    this.ev.onSound?.('pass');
  }

  doShoot(meter: number) {
    const u = this.user;
    if (!this.userHasBall()) return;
    this.launchShot(u, meter);
  }

  doCrossover() {
    const u = this.user;
    if (!this.userHasBall() || u.cooldown > 0) return;
    // burst forward + freeze nearest defender briefly
    const sp = 5.5 + u.stats.dribbling / 30;
    u.vx += Math.cos(u.facing) * sp; u.vy += Math.sin(u.facing) * sp;
    u.cooldown = 0.7;
    const def = this.nearestOpp(u);
    if (def && Math.hypot(def.x - u.x, def.y - u.y) < 90) { def.shakeT = 0.5; this.ev.onToast?.('ANKLES! 🔥'); }
    this.ev.onSound?.('dribble');
  }

  doDash(dx: number, dy: number) {
    const u = this.user;
    if (u.cooldown > 0) return;
    const m = Math.hypot(dx, dy) || 1;
    const sp = 7 + u.stats.speed / 26;
    u.vx += (dx / m) * sp; u.vy += (dy / m) * sp;
    u.cooldown = 0.55;
    this.ev.onSound?.('dribble');
  }

  // ---------- BALL LAUNCH ----------
  private launchPass(from: Player, tx: number, ty: number, kind: 'pass' | 'bounce' | 'lob', power: number) {
    const b = this.ball;
    b.state = 'flight'; b.owner = null; b.kind = kind; b.lastTouch = from.id;
    b.shotTeam = null;
    const d = Math.hypot(tx - from.x, ty - from.y) || 1;
    const speed = (kind === 'bounce' ? 13 : kind === 'lob' ? 15 : 17) * (0.7 + power * 0.5 + from.stats.passing / 200);
    b.vx = (tx - from.x) / d * speed; b.vy = (ty - from.y) / d * speed;
    b.tx = tx; b.ty = ty;
    b.z = PLAYER_R; b.vz = kind === 'lob' ? 7 : kind === 'bounce' ? 1 : 3;
    b.x = from.x + Math.cos(from.facing) * (PLAYER_R + 4);
    b.y = from.y + Math.sin(from.facing) * (PLAYER_R + 4);
  }

  private launchShot(from: Player, meter: number) {
    const b = this.ball;
    const hoop = hoopFor(from.team);
    const dist = Math.hypot(hoop.x - from.x, hoop.y - from.y);
    b.state = 'flight'; b.owner = null; b.kind = 'shot'; b.shotTeam = from.team; b.lastTouch = from.id;
    // success probability
    const timing = 1 - Math.min(1, Math.abs(meter - 0.85) / 0.85); // 1 at green
    const greenBonus = (meter >= 0.78 && meter <= 0.92) ? 0.28 : 0;
    const distFactor = Math.max(0, 1 - dist / 720);
    const def = this.nearestOpp(from);
    const contest = def ? Math.max(0, 1 - Math.hypot(def.x - from.x, def.y - from.y) / 130) : 0;
    let p = 0.18 + timing * 0.34 + greenBonus + distFactor * 0.3 + from.stats.shooting / 320 - contest * 0.4;
    p = Math.max(0.03, Math.min(0.97, p));
    b.shotMake = Math.random() < p;
    const isThree = dist > 360;
    (b as any)._pts = isThree ? 3 : 2;
    if (from.team === 'home' && from.id === this.userId && greenBonus > 0) this.ev.onToast?.('GREEN! 🟢');
    // aim: makes go to rim; misses near rim
    const aimX = hoop.x + (b.shotMake ? 0 : (Math.random() * 70 - 35));
    const aimY = hoop.y + (b.shotMake ? 0 : (Math.random() * 70 - 35));
    const d = Math.hypot(aimX - from.x, aimY - from.y) || 1;
    const speed = 9 + dist / 90;
    b.vx = (aimX - from.x) / d * speed; b.vy = (aimY - from.y) / d * speed;
    b.tx = aimX; b.ty = aimY;
    b.z = PLAYER_R + 10; b.vz = 9 + dist / 130;   // arc
    b.x = from.x + Math.cos(from.facing) * 8; b.y = from.y - 10;
    this.ev.onSound?.('shoot');
  }

  private nearestOpp(p: Player) {
    let best: Player | null = null, bd = 1e9;
    for (const o of this.players) if (o.team !== p.team) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------- MAIN STEP ----------
  step(dt: number, input: UserInput) {
    if (!this.running) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.running = false; return; }

    for (const p of this.players) { if (p.cooldown > 0) p.cooldown -= dt; if (p.shakeT > 0) p.shakeT -= dt; }

    this.controlUser(input, dt);
    for (const p of this.players) if (!p.isUser) this.controlAI(p, dt);

    // integrate players
    for (const p of this.players) {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.78; p.vy *= 0.78;
      p.x = Math.max(MARGIN + PLAYER_R, Math.min(COURT_W - MARGIN - PLAYER_R, p.x));
      p.y = Math.max(MARGIN + PLAYER_R, Math.min(COURT_H - MARGIN - PLAYER_R, p.y));
    }
    this.resolvePlayerCollisions();
    this.updateBall(dt);
    this.updateStamina(dt, input);

    if (this.resetTimer > 0) { this.resetTimer -= dt; if (this.resetTimer <= 0) this.inbound(this.possessionTeam); }
  }

  private updateStamina(dt: number, input: UserInput) {
    for (const p of this.players) {
      const moving = Math.hypot(p.vx, p.vy) > 0.6;
      const sprint = p.isUser ? input.sprint : (this.ball.owner === p.id || this.ball.state !== 'held');
      if (moving && sprint) p.stamina -= dt * 9;
      else p.stamina += dt * (moving ? 1.5 : 6);
      p.stamina = Math.max(0, Math.min(100, p.stamina));
    }
  }

  private controlUser(input: UserInput, dt: number) {
    const u = this.user;
    const staminaMul = u.stamina > 5 ? 1 : 0.55;
    const shakeMul = u.shakeT > 0 ? 0.4 : 1;
    let sp = (1.9 + u.stats.speed / 42) * staminaMul * shakeMul;
    if (input.sprint && u.stamina > 5) sp *= 1.55;
    if (this.userHasBall()) sp *= 0.94;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx || dy) {
      const m = Math.hypot(dx, dy);
      u.vx += (dx / m) * sp; u.vy += (dy / m) * sp;
      u.facing = Math.atan2(u.vy || dy, u.vx || dx);
    }
    // aim toward hoop when holding ball & not moving for cleaner shots
    if (this.userHasBall() && !dx && !dy) {
      const h = hoopFor(u.team); u.facing = Math.atan2(h.y - u.y, h.x - u.x);
    }
    // steal attempt when no ball
    if (input.steal && !this.userHasBall() && u.cooldown <= 0) {
      u.cooldown = 0.6; this.attemptSteal(u);
    }
    void dt;
  }

  private attemptSteal(p: Player) {
    const holder = this.playerById(this.ball.owner);
    this.ev.onSound?.('steal');
    if (this.ball.state === 'flight' && this.ball.kind !== 'shot') {
      // intercept pass if close to ball line
      if (Math.hypot(this.ball.x - p.x, this.ball.y - p.y) < 46) this.giveBall(p);
      return;
    }
    if (holder && holder.team !== p.team) {
      const d = Math.hypot(holder.x - p.x, holder.y - p.y);
      if (d < PLAYER_R * 2.4) {
        const chance = 0.28 + p.stats.defense / 260 - holder.stats.dribbling / 320;
        if (Math.random() < chance) { this.giveBall(p); this.ev.onToast?.(p.isUser ? 'STEAL! 🟢' : 'Turnover'); }
      }
    }
  }

  private giveBall(p: Player) {
    this.ball.state = 'held'; this.ball.owner = p.id; this.ball.lastTouch = p.id;
    this.ball.z = 0; this.ball.vz = 0; this.possessionTeam = p.team;
  }

  // ---------- BALL ----------
  private updateBall(dt: number) {
    const b = this.ball;
    if (b.state === 'held') {
      const o = this.playerById(b.owner);
      if (o) {
        b.x = o.x + Math.cos(o.facing) * (PLAYER_R + 2);
        b.y = o.y + Math.sin(o.facing) * (PLAYER_R + 2);
        b.z = 6 + Math.abs(Math.sin(performance.now() / 90)) * 5; // dribble bob
      }
      return;
    }

    b.x += b.vx; b.y += b.vy;
    // height arc
    b.z += b.vz; b.vz -= 38 * dt;
    if (b.z < 0) { b.z = 0; b.vz = b.kind === 'bounce' ? Math.abs(b.vz) * 0.55 : b.vz; }

    if (b.state === 'flight') {
      if (b.kind === 'shot') this.updateShot(b);
      else this.updatePass(b);
    } else if (b.state === 'loose') {
      b.vx *= 0.95; b.vy *= 0.95;
      // wall bounce
      if (b.x < MARGIN + BALL_R || b.x > COURT_W - MARGIN - BALL_R) { b.vx *= -0.6; b.x = Math.max(MARGIN + BALL_R, Math.min(COURT_W - MARGIN - BALL_R, b.x)); }
      if (b.y < MARGIN + BALL_R || b.y > COURT_H - MARGIN - BALL_R) { b.vy *= -0.6; b.y = Math.max(MARGIN + BALL_R, Math.min(COURT_H - MARGIN - BALL_R, b.y)); }
      // pickup
      for (const p of this.players) {
        if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_R + BALL_R + 4 && b.z < 30) { this.giveBall(p); break; }
      }
      if (Math.hypot(b.vx, b.vy) < 0.4 && b.z <= 0) {
        // settle — nearest player grabs
        let best: Player | null = null, bd = 1e9;
        for (const p of this.players) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = p; } }
        if (best && bd < 80) this.giveBall(best);
      }
    }
  }

  private updatePass(b: Ball) {
    const reached = Math.hypot(b.tx - b.x, b.ty - b.y) < 22;
    // any player can catch/intercept
    for (const p of this.players) {
      if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_R + BALL_R + 2 && b.z < 40) {
        if (p.id === b.lastTouch && !reached) continue;
        this.giveBall(p); return;
      }
    }
    if (reached) { b.state = 'loose'; b.vx *= 0.4; b.vy *= 0.4; }
  }

  private updateShot(b: Ball) {
    const team = b.shotTeam!;
    const hoop = hoopFor(team);
    const d = Math.hypot(hoop.x - b.x, hoop.y - b.y);
    if (d < HOOP_R + 6 && b.vz < 0) {
      if (b.shotMake) {
        const pts = (b as any)._pts || 2;
        if (team === 'home') this.scoreHome += pts; else this.scoreAway += pts;
        this.ev.onScore?.(team, pts);
        this.ev.onSound?.('swish');
        this.ev.onToast?.(pts === 3 ? `+3 ${team === 'home' ? 'HOME' : 'AWAY'}!` : `BUCKET! +2`);
        this.ev.onSound?.('whistle');
        // opponent inbounds
        this.possessionTeam = team === 'home' ? 'away' : 'home';
        b.state = 'held'; b.owner = null; this.resetTimer = 1.0; b.vx = b.vy = b.vz = 0; b.z = 0;
        b.x = hoop.x; b.y = hoop.y;
      } else {
        // rim out -> rebound
        this.ev.onSound?.('rim');
        b.state = 'loose'; b.vz = 6 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        b.vx = Math.cos(a) * 4; b.vy = Math.sin(a) * 4;
        this.assignRebound(team);
      }
      return;
    }
    // landed short/long without scoring => loose
    if (b.z <= 0 && Math.hypot(b.vx, b.vy) < 6) { b.state = 'loose'; }
  }

  private assignRebound(shotTeam: Team) {
    // bias rebound positioning toward defense, weighted by defense stat
    void shotTeam;
  }

  private inbound(team: Team) {
    const mates = this.teammates(team);
    const g = mates.find(m => m.role === 'guard') || mates[0];
    const baseX = team === 'home' ? MARGIN + 120 : COURT_W - MARGIN - 120;
    g.x = baseX; g.y = COURT_H / 2;
    this.giveBall(g);
    this.ev.onToast?.('');
  }

  // ---------- AI ----------
  private controlAI(p: Player, dt: number) {
    const b = this.ball;
    const hoop = hoopFor(p.team);
    const oppHoop = hoopFor(p.team === 'home' ? 'away' : 'home');
    const sp = (1.7 + p.stats.speed / 44) * (p.stamina > 5 ? 1 : 0.6) * (p.shakeT > 0 ? 0.4 : 1);
    let tx = p.x, ty = p.y;

    const hasBall = b.state === 'held' && b.owner === p.id;
    const teamHasBall = (b.state === 'held' && this.playerById(b.owner)?.team === p.team);
    const ballFree = b.state !== 'held' || b.owner == null;

    if (hasBall) {
      const dHoop = Math.hypot(hoop.x - p.x, hoop.y - p.y);
      const def = this.nearestOpp(p);
      const dDef = def ? Math.hypot(def.x - p.x, def.y - p.y) : 999;
      // shoot if open & in range
      if (dHoop < 330 && dDef > 95 && Math.random() < 0.04 + p.stats.shooting / 2600) {
        p.facing = Math.atan2(hoop.y - p.y, hoop.x - p.x);
        this.launchShot(p, 0.85 + (Math.random() * 0.1 - 0.05)); return;
      }
      // pass if pressured
      if (dDef < 80 && Math.random() < 0.05) {
        const mate = this.teammates(p.team).filter(m => m.id !== p.id)
          .sort((a, c) => Math.hypot(hoop.x - c.x, hoop.y - c.y) - Math.hypot(hoop.x - a.x, hoop.y - a.y))[0];
        if (mate) { p.facing = Math.atan2(mate.y - p.y, mate.x - p.x); this.launchPass(p, mate.x, mate.y, 'pass', 0.5); this.ev.onSound?.('pass'); return; }
      }
      // drive to hoop, avoid defender
      tx = hoop.x; ty = hoop.y;
      if (dDef < 70 && def) { ty += (p.y < def.y ? -80 : 80); }
      p.facing = Math.atan2(hoop.y - p.y, hoop.x - p.x);
    } else if (teamHasBall) {
      // spacing: spread out around offensive end
      const carrier = this.playerById(b.owner)!;
      const spread = p.role === 'big' ? 70 : 180;
      tx = (hoop.x + carrier.x) / 2 + (p.id % 2 ? spread : -spread);
      ty = COURT_H / 2 + (p.role === 'guard' ? -150 : p.role === 'big' ? 40 : 150);
      // cut to basket occasionally
      if (Math.random() < 0.004) { tx = hoop.x; ty = COURT_H / 2 + (Math.random() * 200 - 100); }
    } else if (ballFree) {
      // chase loose ball / rebound (bigs prioritize)
      tx = b.x; ty = b.y;
      const others = this.players.filter(o => o.team === p.team && o.id !== p.id);
      const meDist = Math.hypot(b.x - p.x, b.y - p.y);
      const closer = others.some(o => Math.hypot(b.x - o.x, b.y - o.y) < meDist - 20 && o.role !== 'big');
      if (closer && p.role !== 'big') { tx = oppHoop.x; ty = COURT_H / 2; } // leak out / get back
      // pickup
      if (meDist < PLAYER_R + BALL_R + 6 && b.z < 30) this.giveBall(p);
    } else {
      // defense: guard nearest opponent, contest carrier
      const carrier = this.playerById(b.owner);
      if (carrier && carrier.team !== p.team) {
        const guardHoop = hoopFor(p.team);
        // stay between carrier and own hoop
        tx = (carrier.x + guardHoop.x) / 2; ty = (carrier.y + guardHoop.y) / 2;
        const dCar = Math.hypot(carrier.x - p.x, carrier.y - p.y);
        if (dCar < PLAYER_R * 2.6 && p.cooldown <= 0 && Math.random() < 0.02 + p.stats.defense / 3000) {
          p.cooldown = 0.7; this.attemptSteal(p);
        }
        p.facing = Math.atan2(carrier.y - p.y, carrier.x - p.x);
      }
    }

    const ddx = tx - p.x, ddy = ty - p.y, dm = Math.hypot(ddx, ddy);
    if (dm > 6) { p.vx += (ddx / dm) * sp; p.vy += (ddy / dm) * sp; if (!hasBall) p.facing = Math.atan2(ddy, ddx); }
    void dt;
  }

  private resolvePlayerCollisions() {
    for (let i = 0; i < this.players.length; i++)
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], c = this.players[j];
        const dx = c.x - a.x, dy = c.y - a.y; const d = Math.hypot(dx, dy) || 1;
        const min = PLAYER_R * 2 - 4;
        if (d < min) {
          const ov = (min - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * ov; a.y -= ny * ov; c.x += nx * ov; c.y += ny * ov;
        }
      }
  }
}

export interface UserInput {
  up: boolean; down: boolean; left: boolean; right: boolean;
  sprint: boolean; steal: boolean;
}
