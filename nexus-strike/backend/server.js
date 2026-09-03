/**
 * NEXUS STRIKE: Zone Ops — Backend Server
 * Aussi-Nexus Group (ABN 76 947 108 181)
 * © 2026 All Rights Reserved
 * nexusonlinegames.com
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── In-Memory State ──────────────────────────────────────────────────────────
const rooms = new Map();
const leaderboard = [];
const players = new Map();

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'NEXUS STRIKE: Zone Ops', version: '1.0.0', publisher: 'Aussi-Nexus Group' });
});

app.get('/api/leaderboard', (req, res) => {
  const sorted = [...leaderboard].sort((a, b) => b.kills - a.kills).slice(0, 20);
  res.json({ success: true, data: sorted });
});

app.post('/api/leaderboard', (req, res) => {
  const { playerName, kills, deaths, wins, roundsPlayed } = req.body;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  leaderboard.push({ id: uuidv4(), playerName, kills: kills || 0, deaths: deaths || 0, wins: wins || 0, roundsPlayed: roundsPlayed || 0, timestamp: Date.now() });
  res.json({ success: true, message: 'Score submitted' });
});

app.get('/api/rooms', (req, res) => {
  const list = Array.from(rooms.values()).map(r => ({
    id: r.id, name: r.name, players: r.players.length, maxPlayers: 10, map: r.map, status: r.status
  }));
  res.json({ success: true, data: list });
});

app.post('/api/rooms/create', (req, res) => {
  const { name, map } = req.body;
  const id = uuidv4().slice(0, 8).toUpperCase();
  const room = { id, name: name || `Zone-${id}`, map: map || 'Ash Compound', players: [], status: 'waiting', createdAt: Date.now() };
  rooms.set(id, room);
  res.json({ success: true, roomId: id, room });
});

app.get('/api/maps', (req, res) => {
  res.json({ success: true, data: [
    { id: 'ash_compound', name: 'Ash Compound', type: 'Tactical', players: '5v5', description: 'Urban warfare in a bombed industrial zone' },
    { id: 'nexus_port', name: 'Nexus Port', type: 'Long Range', players: '5v5', description: 'Container yard with long sightlines' },
    { id: 'vault_district', name: 'Vault District', type: 'Close Quarters', players: '5v5', description: 'Dense financial district streets' },
    { id: 'iron_peak', name: 'Iron Peak', type: 'Mixed', players: '5v5', description: 'Mountain base with variable elevation' },
    { id: 'delta_basin', name: 'Delta Basin', type: 'Sniper', players: '5v5', description: 'River delta with hidden flanks' }
  ]});
});

app.get('/api/weapons', (req, res) => {
  res.json({ success: true, data: [
    { id: 'viper_r7', name: 'Viper R7', type: 'Rifle', damage: 85, fireRate: 600, range: 'Long', price: 2700 },
    { id: 'phantom_x', name: 'Phantom X', type: 'Rifle', damage: 78, fireRate: 650, range: 'Long', price: 2900 },
    { id: 'razorshot', name: 'RazorShot', type: 'Sniper', damage: 115, fireRate: 45, range: 'Extreme', price: 4750 },
    { id: 'strikemac', name: 'StrikeMAC', type: 'SMG', damage: 45, fireRate: 800, range: 'Short', price: 1200 },
    { id: 'blastwall', name: 'BlastWall', type: 'Shotgun', damage: 100, fireRate: 80, range: 'Close', price: 1800 },
    { id: 'ironveil', name: 'IronVeil', type: 'Pistol', damage: 35, fireRate: 400, range: 'Medium', price: 300 }
  ]});
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = uuidv4();
  players.set(playerId, { id: playerId, ws, room: null, name: 'Agent', kills: 0, deaths: 0, team: null, credits: 800 });

  ws.send(JSON.stringify({ type: 'CONNECTED', playerId, message: 'Welcome to NEXUS STRIKE: Zone Ops', credits: 800 }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const player = players.get(playerId);
      if (!player) return;

      switch (msg.type) {
        case 'JOIN_ROOM': {
          const room = rooms.get(msg.roomId);
          if (!room) { ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' })); return; }
          player.room = msg.roomId;
          player.name = msg.playerName || 'Agent';
          player.team = room.players.length % 2 === 0 ? 'NEXUS' : 'SHADOW';
          room.players.push(playerId);
          broadcast(room, { type: 'PLAYER_JOINED', playerId, playerName: player.name, team: player.team, playerCount: room.players.length });
          if (room.players.length >= 2) startMatch(room);
          break;
        }
        case 'PLAYER_ACTION': {
          const room = player.room ? rooms.get(player.room) : null;
          if (room) broadcast(room, { type: 'ACTION_UPDATE', playerId, action: msg.action, position: msg.position, data: msg.data });
          break;
        }
        case 'KILL_EVENT': {
          player.kills++;
          player.credits += 300;
          const room = player.room ? rooms.get(player.room) : null;
          const victim = players.get(msg.victimId);
          if (victim) { victim.deaths++; victim.credits += 150; }
          if (room) broadcast(room, { type: 'KILL_FEED', killer: player.name, victim: victim?.name || 'Agent', weapon: msg.weapon, killerId: playerId, killerCredits: player.credits });
          break;
        }
        case 'BOMB_PLANT': {
          const room = player.room ? rooms.get(player.room) : null;
          if (room) {
            broadcast(room, { type: 'BOMB_PLANTED', planterId: playerId, planterName: player.name, site: msg.site, defuseTime: 40 });
            setTimeout(() => broadcast(room, { type: 'BOMB_EXPLODED', site: msg.site }), 40000);
          }
          break;
        }
        case 'CHAT': {
          const room = player.room ? rooms.get(player.room) : null;
          if (room) broadcast(room, { type: 'CHAT_MSG', from: player.name, team: player.team, message: msg.message.slice(0, 120), timestamp: Date.now() });
          break;
        }
      }
    } catch (e) { /* ignore malformed */ }
  });

  ws.on('close', () => {
    const player = players.get(playerId);
    if (player?.room) {
      const room = rooms.get(player.room);
      if (room) { room.players = room.players.filter(id => id !== playerId); broadcast(room, { type: 'PLAYER_LEFT', playerId, playerName: player.name }); }
    }
    players.delete(playerId);
  });
});

function broadcast(room, msg) {
  const json = JSON.stringify(msg);
  room.players.forEach(pid => { const p = players.get(pid); if (p?.ws?.readyState === WebSocket.OPEN) p.ws.send(json); });
}

function startMatch(room) {
  room.status = 'active';
  room.round = 1;
  broadcast(room, { type: 'MATCH_START', map: room.map, timeLimit: 120, roundsToWin: 16, buyPhase: true });
  setTimeout(() => endBuyPhase(room), 15000);
}

function endBuyPhase(room) {
  broadcast(room, { type: 'BUY_PHASE_END', message: 'GO! GO! GO!' });
  setTimeout(() => endRound(room), 105000);
}

function endRound(room) {
  if (!rooms.has(room.id)) return;
  room.round = (room.round || 1) + 1;
  if (room.round > 30) { endMatch(room); return; }
  broadcast(room, { type: 'ROUND_END', round: room.round, message: `Round ${room.round - 1} over — next round starting`, buyPhase: true });
  setTimeout(() => endBuyPhase(room), 15000);
}

function endMatch(room) {
  room.status = 'ended';
  broadcast(room, { type: 'MATCH_END', message: 'Match Over', final: true });
  setTimeout(() => rooms.delete(room.id), 10000);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`\u{1F3AF} NEXUS STRIKE: Zone Ops server running on port ${PORT}`));
