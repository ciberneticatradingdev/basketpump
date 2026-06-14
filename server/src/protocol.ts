// Shared protocol types between client and server.
export type Team = 'home' | 'away';

export interface NetPlayer {
  id: number;            // slot id within the room (1..6)
  team: Team;
  name: string;
  isBot: boolean;
  socketId: string | null;
  x: number; y: number;
  vx: number; vy: number;
  faceDir: 1 | -1;
  onGround: boolean;
  armT: number; reachT: number; stunT: number; pumpT: number; runPhase: number; dunkT: number;
  hasBall: boolean;
}

export interface NetBall {
  x: number; y: number; vx: number; vy: number;
  owner: number | null; inFlight: boolean; spin: number;
}

export interface NetParticleEvent {
  kind: 'score' | 'dunk';
  team: Team;
  x: number; y: number;
}

export interface RoomState {
  code: string;
  status: 'waiting' | 'playing' | 'ended';
  scoreHome: number; scoreAway: number;
  timeLeft: number;
  players: NetPlayer[];
  ball: NetBall;
  flashHome: number; flashAway: number;
  fx: NetParticleEvent[];          // transient events since last tick
  toast: string;
}

export interface RoomSummary {
  code: string;
  status: 'waiting' | 'playing' | 'ended';
  humans: number;
  capacity: number;
  scoreHome: number; scoreAway: number;
  timeLeft: number;
}

// client -> server
export interface JoinPayload { code: string; name: string; }
export interface InputPayload {
  left: boolean; right: boolean;
  jump: boolean;             // edge: set true for one tick to jump
  grab: boolean; pass: boolean;
  charging: boolean; shootPower: number; // release: shootPower>0 means shoot this tick
}

// server -> client assigned identity
export interface AssignedPayload { code: string; slotId: number; team: Team; }
