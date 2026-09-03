# 🎯 NEXUS STRIKE: Zone Ops

**Publisher:** Aussi-Nexus Group (ABN 76 947 108 181)  
**Genre:** Tactical Team Strategy Shooter  
**Platform:** PWA (Web + Installable)

---

## About
NEXUS STRIKE: Zone Ops is an original tactical team strategy game with 5v5 bomb-defusal mechanics, economy system, weapon buying, and real-time multiplayer.

## Features
- 🗺 5 original maps (Ash Compound, Nexus Port, Vault District, Iron Peak, Delta Basin)
- 🔫 6 original weapons (Viper R7, Phantom X, RazorShot, StrikeMAC, BlastWall, IronVeil)
- 💰 Full economy / credit system with buy phase
- 🤖 AI enemy bots for solo training
- 🌐 WebSocket real-time multiplayer
- 📱 PWA installable (mobile + desktop)
- 💬 Team chat
- 🏆 Leaderboard system

## Controls
| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Aim & Shoot |
| B | Buy Menu |
| R | Reload |
| Enter | Send Chat |

## Setup
```bash
npm install
npm start      # production
npm run dev    # development (nodemon)
```
Server runs on **port 3001** by default.

## API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Server status |
| GET | `/api/leaderboard` | Top 20 players |
| POST | `/api/leaderboard` | Submit score |
| GET | `/api/rooms` | Active rooms |
| POST | `/api/rooms/create` | Create room |
| GET | `/api/maps` | Available maps |
| GET | `/api/weapons` | Weapon catalog |

---
© 2026 Aussi-Nexus Group — nexusonlinegames.com
