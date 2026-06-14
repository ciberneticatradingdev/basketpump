import { io, Socket } from 'socket.io-client';

// ===== wire types (mirror server/src/protocol.ts) =====
export type Team = 'home' | 'away';

export interface NetPlayer {
  id: number; team: Team; name: string; isBot: boolean; socketId: string | null;
  x: number; y: number; vx: number; vy: number; faceDir: 1 | -1; onGround: boolean;
  armT: number; reachT: number; stunT: number; pumpT: number; runPhase: number; dunkT: number; hasBall: boolean;
  ack?: number;   // last input seq the server processed for this slot
}
export interface NetBall { x: number; y: number; vx: number; vy: number; owner: number | null; inFlight: boolean; spin: number; }
export interface NetParticleEvent { kind: 'score' | 'dunk'; team: Team; x: number; y: number; }
export interface RoomState {
  code: string; status: 'waiting' | 'playing' | 'ended';
  scoreHome: number; scoreAway: number; timeLeft: number;
  players: NetPlayer[]; ball: NetBall; flashHome: number; flashAway: number;
  fx: NetParticleEvent[]; toast: string;
}
export interface RoomSummary {
  code: string; status: 'waiting' | 'playing' | 'ended';
  humans: number; capacity: number; scoreHome: number; scoreAway: number; timeLeft: number;
}
export interface InputPayload {
  left: boolean; right: boolean; jump: boolean; grab: boolean; pass: boolean;
  charging: boolean; shootPower: number;
  seq?: number;   // monotonic client input sequence (for server reconciliation)
}
export interface Assigned { code: string; slotId: number; team: Team; }

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || 'http://localhost:3001';

// Render ~70ms in the past so we always have two snapshots to interpolate
// between (server broadcasts at 30Hz = one every ~33ms). Extrapolate up to
// 120ms forward if packets are late so motion never freezes.
const INTERP_DELAY = 70;
const MAX_EXTRAP = 0.12;
const BUFFER_MAX = 40;

interface TimedSnap { t: number; s: RoomState; }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function lerpPlayer(a: NetPlayer, b: NetPlayer, k: number): NetPlayer {
  return {
    ...b, // discrete fields (team, name, isBot, faceDir, onGround, hasBall, socketId) snap to newer
    x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k),
    vx: lerp(a.vx, b.vx, k), vy: lerp(a.vy, b.vy, k),
    armT: lerp(a.armT, b.armT, k), reachT: lerp(a.reachT, b.reachT, k),
    stunT: lerp(a.stunT, b.stunT, k), pumpT: lerp(a.pumpT, b.pumpT, k),
    dunkT: lerp(a.dunkT, b.dunkT, k), runPhase: lerp(a.runPhase, b.runPhase, k),
  };
}

function lerpState(a: RoomState, b: RoomState, k: number): RoomState {
  const aById = new Map(a.players.map(p => [p.id, p]));
  const players = b.players.map(pb => {
    const pa = aById.get(pb.id);
    return pa ? lerpPlayer(pa, pb, k) : pb;
  });
  const ba = a.ball, bb = b.ball;
  const ball: NetBall = {
    ...bb,
    x: lerp(ba.x, bb.x, k), y: lerp(ba.y, bb.y, k),
    vx: lerp(ba.vx, bb.vx, k), vy: lerp(ba.vy, bb.vy, k),
    spin: lerp(ba.spin, bb.spin, k),
  };
  return { ...b, players, ball, fx: [] };
}

function extrapState(s: RoomState, dt: number): RoomState {
  if (dt <= 0) return { ...s, fx: [] };
  const players = s.players.map(p => ({ ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt }));
  const ball: NetBall = { ...s.ball, x: s.ball.x + s.ball.vx * dt, y: s.ball.y + s.ball.vy * dt };
  return { ...s, players, ball, fx: [] };
}

export class Net {
  socket: Socket;
  rooms: RoomSummary[] = [];
  state: RoomState | null = null;      // newest raw snapshot (for discrete UI: score/timer)
  assigned: Assigned | null = null;
  connected = false;

  private buffer: TimedSnap[] = [];     // timestamped snapshots for interpolation

  onRooms?: (r: RoomSummary[]) => void;
  onAssigned?: (a: Assigned) => void;
  onState?: (s: RoomState) => void;     // fires once per received snapshot (fx/toast/sound)
  onJoinError?: (m: string) => void;
  onStatus?: (connected: boolean) => void;

  constructor() {
    this.socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: true });
    this.socket.on('connect', () => { this.connected = true; this.onStatus?.(true); this.socket.emit('listRooms'); });
    this.socket.on('disconnect', () => { this.connected = false; this.onStatus?.(false); });
    this.socket.on('connect_error', () => { this.connected = false; this.onStatus?.(false); });
    this.socket.on('rooms', (r: RoomSummary[]) => { this.rooms = r; this.onRooms?.(r); });
    this.socket.on('assigned', (a: Assigned) => { this.assigned = a; this.onAssigned?.(a); });
    this.socket.on('state', (s: RoomState) => {
      this.state = s;
      this.buffer.push({ t: performance.now(), s });
      if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
      this.onState?.(s); // discrete events fire exactly once per snapshot
    });
    this.socket.on('joinError', (m: string) => this.onJoinError?.(m));
  }

  /** Interpolated render state ~INTERP_DELAY ms in the past. Falls back to
   *  velocity extrapolation when ahead of the buffer, or raw state if empty. */
  sample(): RoomState | null {
    const buf = this.buffer;
    if (buf.length === 0) return this.state;
    if (buf.length === 1) return buf[0].s;
    const renderClock = performance.now() - INTERP_DELAY;
    const first = buf[0], last = buf[buf.length - 1];
    if (renderClock <= first.t) return first.s;                 // behind buffer → clamp to oldest
    if (renderClock >= last.t) {                                 // ahead → extrapolate from newest
      return extrapState(last.s, Math.min(MAX_EXTRAP, (renderClock - last.t) / 1000));
    }
    for (let i = 0; i < buf.length - 1; i++) {                   // bracket search
      const lo = buf[i], hi = buf[i + 1];
      if (lo.t <= renderClock && renderClock <= hi.t) {
        const span = hi.t - lo.t;
        const k = span > 0 ? (renderClock - lo.t) / span : 0;
        return lerpState(lo.s, hi.s, k);
      }
    }
    return last.s;
  }

  listRooms() { this.socket.emit('listRooms'); }
  joinRoom(code: string, name: string) { this.socket.emit('joinRoom', { code, name }); }
  quickPlay(name: string) { this.socket.emit('quickPlay', { name }); }
  leaveRoom() { this.socket.emit('leaveRoom'); this.assigned = null; this.state = null; this.buffer.length = 0; }
  sendInput(p: InputPayload) { this.socket.emit('input', p); }
  dispose() { try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch {} }
}
