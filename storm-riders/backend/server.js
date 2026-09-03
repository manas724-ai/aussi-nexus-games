/**
 * STORM RIDERS: Build & Conquer — Backend Server
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

// ── State ────────────────────────────────────────────────────────────────────
const matches = new Map();
const leaderboard = [];
const players = new Map();

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'STORM RIDERS: Build & Conquer', version: '1.0.0', publisher: 'Aussi-Nexus Group' });
});

app.get('/api/leaderboard', (req, res) => {
  const sorted = [...leaderboard].sort((a, b) => b.wins - a.wins || b.kills - a.kills).slice(0, 20);
  res.json({ success: true, data: sorted });
});

app.post('/api/leaderboard', (req, res) => {
  const { playerName, kills, placement, builds, damage } = req.body;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  leaderboard.push({ id: uuidv4(), playerName, kills: kills||0, wins: placement===1?1:0, builds: builds||0, damage: damage||0, placement: placement||100, timestamp: Date.now() });
  res.json({ success: true });
});

app.get('/api/matches', (req, res) => {
  const list = Array.from(matches.values()).map(m => ({ id:m.id, players:m.players.length, maxPlayers:100, phase:m.phase, stormRadius:m.stormRadius }));
  res.json({ success: true, data: list });
});

app.post('/api/matches/create', (req, res) => {
  const id = uuidv4().slice(0,8).toUpperCase();
  const m = { id, players:[], phase:'lobby', stormRadius:3000, stormCenterX:0, stormCenterY:0, lootItems:generateLoot(), structures:[], createdAt:Date.now() };
  matches.set(id, m);
  res.json({ success: true, matchId: id, match: m });
});

app.get('/api/loot-categories', (req, res) => {
  res.json({ success: true, data: [
    { id:'assault', name:'Storm Cannon', rarity:'Epic', damage:75, type:'Assault Rifle' },
    { id:'smg', name:'Vortex SMG', rarity:'Rare', damage:40, type:'SMG' },
    { id:'shotgun', name:'Gale Pump', rarity:'Common', damage:90, type:'Shotgun' },
    { id:'sniper', name:'Tempest Rifle', rarity:'Legendary', damage:130, type:'Sniper' },
    { id:'pistol', name:'Breeze Pistol', rarity:'Common', damage:28, type:'Pistol' },
    { id:'rocket', name:'Cyclone Launcher', rarity:'Epic', damage:200, type:'Explosive' }
  ]});
});

function generateLoot() {
  const items = [];
  for (let i=0; i<200; i++) {
    items.push({ id:uuidv4(), x:Math.random()*5000-2500, y:Math.random()*5000-2500, type:['ammo','shield','health','weapon','material'][Math.floor(Math.random()*5)], picked:false });
  }
  return items;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = uuidv4();
  players.set(playerId, { id:playerId, ws, match:null, name:'Rider', hp:100, shield:0, materials:{wood:0,brick:0,metal:0}, kills:0, position:{x:0,y:0}, alive:true });
  ws.send(JSON.stringify({ type:'CONNECTED', playerId }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const player = players.get(playerId);
      if (!player) return;

      switch (msg.type) {
        case 'JOIN_MATCH': {
          let match = msg.matchId ? matches.get(msg.matchId) : null;
          if (!match) {
            const id = uuidv4().slice(0,8).toUpperCase();
            match = { id, players:[], phase:'lobby', stormRadius:3000, stormCenterX:0, stormCenterY:0, lootItems:generateLoot(), structures:[], createdAt:Date.now() };
            matches.set(id, match);
          }
          player.match = match.id;
          player.name = msg.playerName || 'Rider';
          player.position = { x: (Math.random()-0.5)*4000, y: (Math.random()-0.5)*4000 };
          match.players.push(playerId);
          ws.send(JSON.stringify({ type:'MATCH_JOINED', matchId:match.id, playerCount:match.players.length, lootItems:match.lootItems.slice(0,50), spawnPos:player.position }));
          broadcast(match, { type:'PLAYER_COUNT', count:match.players.length });
          if (match.players.length >= 2 && match.phase==='lobby') startMatch(match);
          break;
        }
        case 'PLAYER_MOVE': {
          const player2 = players.get(playerId);
          if (player2) { player2.position = msg.position; }
          const match = player.match ? matches.get(player.match) : null;
          if (match) broadcast(match, { type:'PLAYER_MOVED', playerId, position:msg.position, angle:msg.angle }, playerId);
          break;
        }
        case 'BUILD': {
          const match = player.match ? matches.get(player.match) : null;
          if (!match) return;
          const cost = { wood:10, brick:15, metal:20 }[msg.material] || 10;
          if (player.materials[msg.material] < cost) { ws.send(JSON.stringify({type:'BUILD_FAILED',reason:'Not enough material'})); return; }
          player.materials[msg.material] -= cost;
          const structure = { id:uuidv4(), type:msg.buildType, x:msg.x, y:msg.y, rotation:msg.rotation||0, material:msg.material, hp:{ wood:90, brick:200, metal:350 }[msg.material], ownerId:playerId };
          match.structures.push(structure);
          broadcast(match, { type:'STRUCTURE_BUILT', structure, builderMaterials:player.materials });
          break;
        }
        case 'KILL_EVENT': {
          player.kills++;
          const victim = players.get(msg.victimId);
          if (victim) {
            victim.alive = false;
            // Drop loot on death
            const match = player.match ? matches.get(player.match) : null;
            if (match) broadcast(match, { type:'PLAYER_ELIMINATED', victimId:msg.victimId, victimName:victim.name, killerId:playerId, killerName:player.name, weapon:msg.weapon, remaining:match.players.filter(pid=>players.get(pid)?.alive).length });
          }
          break;
        }
        case 'HARVEST': {
          const mats = { wood:Math.floor(Math.random()*30)+10, brick:Math.floor(Math.random()*20)+5, metal:Math.floor(Math.random()*15)+5 };
          const mat = msg.material || 'wood';
          player.materials[mat] = (player.materials[mat]||0) + mats[mat];
          ws.send(JSON.stringify({ type:'HARVEST_RESULT', material:mat, gained:mats[mat], total:player.materials }));
          break;
        }
        case 'LOOT_PICKUP': {
          const match = player.match ? matches.get(player.match) : null;
          if (!match) return;
          const item = match.lootItems.find(i=>i.id===msg.itemId&&!i.picked);
          if (!item) return;
          item.picked=true;
          if (item.type==='health') { player.hp=Math.min(100,player.hp+50); ws.send(JSON.stringify({type:'STAT_UPDATE',hp:player.hp,shield:player.shield})); }
          if (item.type==='shield') { player.shield=Math.min(100,player.shield+50); ws.send(JSON.stringify({type:'STAT_UPDATE',hp:player.hp,shield:player.shield})); }
          if (item.type==='material') {
            const mat=['wood','brick','metal'][Math.floor(Math.random()*3)];
            player.materials[mat]=(player.materials[mat]||0)+50;
            ws.send(JSON.stringify({type:'MATERIAL_UPDATE',materials:player.materials}));
          }
          broadcast(match, { type:'ITEM_PICKED', itemId:msg.itemId, pickerId:playerId });
          break;
        }
        case 'CHAT': {
          const match = player.match ? matches.get(player.match) : null;
          if (match) broadcast(match, { type:'CHAT_MSG', from:player.name, message:msg.message.slice(0,120), timestamp:Date.now() });
          break;
        }
      }
    } catch(e){}
  });

  ws.on('close', () => {
    const player = players.get(playerId);
    if (player?.match) {
      const match = matches.get(player.match);
      if (match) { match.players=match.players.filter(id=>id!==playerId); broadcast(match,{type:'PLAYER_LEFT',playerId,playerName:player.name}); }
    }
    players.delete(playerId);
  });
});

function broadcast(match, msg, excludeId=null) {
  const json = JSON.stringify(msg);
  match.players.forEach(pid => {
    if (pid===excludeId) return;
    const p=players.get(pid); if(p?.ws?.readyState===WebSocket.OPEN) p.ws.send(json);
  });
}

function startMatch(match) {
  match.phase='dropship';
  broadcast(match, { type:'MATCH_START', playerCount:match.players.length, phase:'dropship' });
  setTimeout(()=>{ match.phase='play'; broadcast(match, { type:'DROPSHIP_DONE', phase:'play' }); }, 10000);
  startStorm(match);
}

function startStorm(match) {
  let radius = 3000;
  const shrink = () => {
    if (!matches.has(match.id)) return;
    radius = Math.max(100, radius * 0.75);
    match.stormRadius = radius;
    const cx=(Math.random()-0.5)*800, cy=(Math.random()-0.5)*800;
    match.stormCenterX=cx; match.stormCenterY=cy;
    broadcast(match, { type:'STORM_SHRINK', radius, centerX:cx, centerY:cy, timeToNextShrink:60000 });
    if (radius > 100) setTimeout(shrink, 60000);
  };
  setTimeout(shrink, 90000);
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`\u{1F329}  STORM RIDERS server running on port ${PORT}`));
