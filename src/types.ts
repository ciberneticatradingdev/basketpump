export type Team = 'home' | 'away';

export interface Stats {
  speed: number; jump: number; shooting: number;
  defense: number; stamina: number; handling: number;
}

export type Emote = '🔥' | '😤' | '😎' | '🤙' | '👑' | '💀' | '🥶' | '⚡';

export interface Player {
  id: number;
  team: Team;
  name: string;
  emoji: string;            // face on the head
  x: number; y: number;     // feet anchor (bottom-center) in world space
  vx: number; vy: number;
  onGround: boolean;
  faceDir: 1 | -1;          // facing right / left
  isUser: boolean;
  role: 'guard' | 'big';
  stats: Stats;
  stamina: number;          // 0..100
  // animation / state
  armT: number;             // 0..1 shooting arm raise
  reachT: number;           // grab/steal reach animation
  stunT: number;            // knocked/stunned timer
  pumpT: number;            // squash for jump anticipation
  runPhase: number;         // leg cycle
  dunkT: number;            // 0..1 dunk slam animation
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
  grav: number; kind: 'spark' | 'ring' | 'star' | 'dust';
}

export interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  owner: number | null;     // player id when held
  inFlight: boolean;        // true when shot/passed/loose
  spin: number;             // visual rotation
  lastShooter: number | null;
  lastShotTeam: Team | null;
  scoreLock: number;        // cooldown so one shot scores once
  grabLock: number;         // brief no-grab window after release
}

export interface MatchConfig {
  mode: 'quick' | 'practice';
  minutes: number;
}
