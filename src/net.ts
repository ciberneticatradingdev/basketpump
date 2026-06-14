import { io, Socket } from 'socket.io-client';

// ===== wire types (mirror server/src/protocol.ts) =====
export type Team = 'home' | 'away';

export interface NetPlayer {
  id: number; team: Team; name: string; isBot: boolean; socketId: string | null;
  x: number; y: number; vx: number; vy: number; faceDir: 1 | -1; onGround: boolean;
  armT: number; reachT: number; stunT: number; pumpT: number; runPhase: number; dunkT: number; hasBall: boolean;
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
}
export interface Assigned { code: string; slotId: number; team: Team; }

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || 'http://localhost:3001';

export class Net {
  socket: Socket;
  rooms: RoomSummary[] = [];
  state: RoomState | null = null;
  assigned: Assigned | null = null;
  connected = false;

  onRooms?: (r: RoomSummary[]) => void;
  onAssigned?: (a: Assigned) => void;
  onState?: (s: RoomState) => void;
  onJoinError?: (m: string) => void;
  onStatus?: (connected: boolean) => void;

  constructor() {
    this.socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: true });
    this.socket.on('connect', () => { this.connected = true; this.onStatus?.(true); this.socket.emit('listRooms'); });
    this.socket.on('disconnect', () => { this.connected = false; this.onStatus?.(false); });
    this.socket.on('connect_error', () => { this.connected = false; this.onStatus?.(false); });
    this.socket.on('rooms', (r: RoomSummary[]) => { this.rooms = r; this.onRooms?.(r); });
    this.socket.on('assigned', (a: Assigned) => { this.assigned = a; this.onAssigned?.(a); });
    this.socket.on('state', (s: RoomState) => { this.state = s; this.onState?.(s); });
    this.socket.on('joinError', (m: string) => this.onJoinError?.(m));
  }

  listRooms() { this.socket.emit('listRooms'); }
  joinRoom(code: string, name: string) { this.socket.emit('joinRoom', { code, name }); }
  quickPlay(name: string) { this.socket.emit('quickPlay', { name }); }
  leaveRoom() { this.socket.emit('leaveRoom'); this.assigned = null; this.state = null; }
  sendInput(p: InputPayload) { this.socket.emit('input', p); }
  dispose() { try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch {} }
}
