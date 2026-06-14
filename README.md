# BASKETPUMP

**PLAY HARD. PUMP HIGH.**

A fast, fun, arcade-style 2D basketball game. Street basketball aesthetic with a modern esports look — green, white & black.

![BasketPump](public/brand/banner.jpg)

## Features

- **Top-down angled half-court** with smooth rendering
- **3v3 basketball** vs AI opponents and AI teammates
- **Controls**
  - `WASD` — move
  - `Shift` — sprint
  - `Left Click` (hold) — charge & throw pass
  - `Right Click` (hold) — charge & shoot, with a shot meter (green = perfect)
  - `Space` — quick crossover
- **Shooting system** — success depends on distance, timing, and defensive pressure
- **HUD** — scoreboard, match timer, shot meter, stamina bar, team indicators
- **Match modes** — Quick Match, Ranked, Practice — 3 / 5 / 7 minute lengths

## Tech

- Vite + TypeScript
- HTML5 Canvas 2D renderer
- Web Audio API for SFX
- Zero backend — runs fully client-side, deployed as a static site on Vercel

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # outputs to dist/
pnpm preview
```

## Roadmap

- Online multiplayer (Socket.io server) — architecture is network-ready
- Progression: coins, XP, trophies; cosmetic unlocks (jerseys, courts, emotes, ball skins)
- Tournaments & leagues
