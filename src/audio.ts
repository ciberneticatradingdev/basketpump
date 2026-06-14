// Tiny WebAudio synth — no asset files, all procedural. Lightweight.
let ctx: AudioContext | null = null;
function ac() { if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); return ctx; }

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.18, slideTo?: number) {
  const a = ac(); const t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur);
}
function noise(dur: number, gain = 0.2, hp = 800) {
  const a = ac(); const t = a.currentTime;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(a.destination); src.start(t);
}

export type Sfx = 'shoot' | 'swish' | 'rim' | 'pass' | 'steal' | 'dribble' | 'whistle' | 'dunk';

let muted = false;
export function setMuted(m: boolean) { muted = m; }
export function resumeAudio() { try { ac().resume(); } catch {} }

export function play(s: Sfx) {
  if (muted) return;
  try {
    switch (s) {
      case 'shoot': tone(420, 0.12, 'triangle', 0.12, 620); break;
      case 'swish': noise(0.22, 0.14, 2200); tone(880, 0.18, 'sine', 0.1, 1200); break;
      case 'rim': tone(180, 0.1, 'square', 0.14, 120); break;
      case 'pass': tone(300, 0.06, 'sine', 0.1, 360); break;
      case 'steal': noise(0.1, 0.16, 1500); tone(520, 0.08, 'sawtooth', 0.1); break;
      case 'dribble': tone(140, 0.07, 'sine', 0.16, 90); break;
      case 'whistle': tone(1800, 0.14, 'sine', 0.12); break;
      case 'dunk': noise(0.3, 0.22, 600); tone(90, 0.28, 'square', 0.2, 50); tone(200, 0.12, 'sawtooth', 0.12); break;
    }
  } catch {}
}

// crowd ambience — soft filtered noise loop hum
let crowdNode: { stop: () => void } | null = null;
export function startCrowd() {
  if (muted || crowdNode) return;
  try {
    const a = ac();
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    const g = a.createGain(); g.gain.value = 0.018;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    crowdNode = { stop: () => { try { src.stop(); } catch {} g.disconnect(); } };
  } catch {}
}
export function stopCrowd() { crowdNode?.stop(); crowdNode = null; }
