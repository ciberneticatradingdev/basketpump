export type Team = 'home' | 'away';

export interface Stats {
  speed: number; passing: number; shooting: number;
  defense: number; stamina: number; dribbling: number;
}

export interface Player {
  id: number;
  team: Team;
  name: string;
  x: number; y: number;       // world position
  vx: number; vy: number;
  facing: number;             // radians
  stats: Stats;
  stamina: number;            // 0..100 current
  isUser: boolean;
  role: 'guard' | 'wing' | 'big';
  cooldown: number;           // generic action cd (steal/cross)
  shakeT: number;             // crossed-over timer (slowed)
}

export type BallState = 'held' | 'loose' | 'flight';

export interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  z: number; vz: number;      // height for arc passes/shots
  state: BallState;
  owner: number | null;       // player id when held
  // flight target
  tx: number; ty: number;
  kind: 'pass' | 'bounce' | 'lob' | 'shot' | 'loose';
  shotTeam: Team | null;      // who shot (for scoring/rebound)
  shotMake: boolean;          // resolved make/miss for a shot in flight
  lastTouch: number | null;   // last player id to touch
}

export interface MatchConfig {
  mode: 'quick' | 'ranked' | 'practice';
  minutes: number;
}
