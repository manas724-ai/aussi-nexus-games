/**
 * INFERNO RUN: Last Squad — Backend Server
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

const matches = new Map();
const leaderboard = [];
const players = new Map();

// ── Characters (original) ────────────────────────────────────────────────────
const CHARACTERS = [
  { id:'blaze',    name:'Blaze',    ability:'Inferno Wall',   desc:'Deploy a fire wall blocking enemy vision',  hp:100, speed:1.2, cooldown:35 },
  { id:'phantom',  name:'Phantom',  ability:'Ghost Step',     desc:'Become invisible for 5 seconds',             hp:90,  speed:1.5, cooldown:45 },
  { id:'ironclad', name:'Ironclad', ability:'Shield Surge',   desc:'Instant armor recharge for the squad',       hp:120, speed:0.9, cooldown:50 },
  { id:'nova',     name:'Nova',     ability:'Vortex Dash',    desc:'Dash 15m in any direction instantly',        hp:95,  speed:1.4, cooldown:30 },
  { id:'vex',      name:'Vex',      ability:'Pulse Grenade',  desc:'EMP burst disables enemy abilities for 8s',  hp:100, speed:1.1, cooldown:40 },
  { id:'surge',    name:'Surge',    ability:'Medic Aura',     desc:'Heal all nearby squad members +20HP',        hp:100, speed:1.0, cooldown:38 },
];

const WEAPONS = [
  { id:'razorfire', name:'RazorFire M4', type:'Assault', damage:70, fireRate:650, ammo:30, price:2200 },
  { id:'venom9', name:'Venom 9', type:'SMG', damage:38, fireRate:900, ammo:45, price:1000 },
  { id:'thunderbore', name:'Thunderbore', type:'Sniper', damage:120, fireRate:40, ammo:5, price:4200 },
  { id:'blastpump', name:'BlastPump', type:'Shotgun', damage:95, fireRate:75, ammo:6, price:1600 },
  { id:'ironmark', name:'IronMark', type:'Pistol', damage:32, fireRate:350, ammo:15, price:0 },
  { id:'heatseeker', name:'HeatSeeker', type:'Launcher', damage:180, fireRate:20, ammo:3, price:5000 },
];

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status:'ok', game:'INFERNO RUN: Last Squad', version:'1.0.0', publisher:'Aussi-Nexus Group' }));
app.get('/api/characters', (req, res) => res.json({ success:true, data:CHARACTERS }));
app.get('/api/weapons', (req, res) => res.json({ success:true, data:WEAPONS }));

app.get('/api/leaderboard', (req, res) => {
  const sorted = [...leaderboard].sort((a,b)=>b.wins-a.wins||b.kills-a.kills).slice(0,20);
  res.json({ success:true, data:sorted });
});

app.post('/api/leaderboard', (req, res) => {
  const { playerName, kills, wins, character, damage, squadRevives } = req.body;
  if(!playerName) return res.status(400).json({ error:'playerName required' });
  leaderboard.push({ id:uuidv4(), playerName, kills:kills||0, wins:wins||0, character:character||'blaze', damage:damage||0, squadRevives:squadRevives||0, timestamp:Date.now() });
  res.json({ success:true });
});

app.get('/api/matches', (req, res) => {
  const list = Array.from(matches.values()).map(m=>({ id:m.id, squads:m.squads.length, maxSquads:12, phase:m.phase, zoneRadius:m.zoneRadius }));
  res.json({ success:true, data:list });
});

app.post('/api/matches/create', (req, res) => {
  const id = uuidv4().slice(0,8).toUpperCase();
  const m = { id, squads:[], players:[], phase:'lobby', zoneRadius:2500, zoneCenterX:0, zoneCenterY:0, createdAt:Date.now() };
  matches.set(id, m);
  res.json({ success:true, matchId:id });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = uuidv4();
  players.set(playerId, { id:playerId, ws, match:null, name:'Operator', character:'blaze', hp:100, armor:0, kills:0, revives:0, alive:true, position:{x:0,y:0}, squad:null, abilityCD:0, damage:0 });
  ws.send(JSON.stringify({ type:'CONNECTED', playerId, characters:CHARACTERS, weapons:WEAPONS }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const player = players.get(playerId);
      if(!player) return;
      switch(msg.type) {
        case 'JOIN_MATCH': {
          let match = msg.matchId ? matches.get(msg.matchId) : null;
          if(!match){ const id=uuidv4().slice(0,8).toUpperCase(); match={id,squads:[],players:[],phase:'lobby',zoneRadius:2500,zoneCenterX:0,zoneCenterY:0,createdAt:Date.now()}; matches.set(id,match); }
          player.match=match.id; player.name=msg.playerName||'Operator'; player.character=msg.character||'blaze';
          const charData=CHARACTERS.find(c=>c.id===player.character)||CHARACTERS[0];
          player.hp=charData.hp;
          match.players.push(playerId);
          ws.send(JSON.stringify({ type:'MATCH_JOINED', matchId:match.id, playerCount:match.players.length, character:charData }));
          broadcast(match, { type:'PLAYER_JOINED', playerId, playerName:player.name, character:player.character, playerCount:match.players.length });
          if(match.players.length>=2&&match.phase==='lobby') startMatch(match);
          break;
        }
        case 'PLAYER_MOVE': { player.position=msg.position; const m=player.match?matches.get(player.match):null; if(m)broadcast(m,{type:'PLAYER_MOVED',playerId,position:msg.position,angle:msg.angle},playerId); break; }
        case 'USE_ABILITY': {
          const now=Date.now();
          if(now<(player.abilityCD||0)){ws.send(JSON.stringify({type:'ABILITY_COOLDOWN',remaining:Math.ceil(((player.abilityCD||0)-now)/1000)}));return;}
          const char=CHARACTERS.find(c=>c.id===player.character)||CHARACTERS[0];
          player.abilityCD=now+char.cooldown*1000;
          const m=player.match?matches.get(player.match):null;
          if(m) broadcast(m,{type:'ABILITY_USED',playerId,playerName:player.name,ability:char.ability,character:char.id,position:player.position});
          ws.send(JSON.stringify({type:'ABILITY_OK',ability:char.ability,cooldown:char.cooldown}));
          break;
        }
        case 'KILL_EVENT': { player.kills++; player.damage+=(msg.damage||0); const victim=players.get(msg.victimId); if(victim){victim.alive=false;} const m=player.match?matches.get(player.match):null; if(m)broadcast(m,{type:'PLAYER_ELIMINATED',victimId:msg.victimId,victimName:victim?.name||'Operator',killerId:playerId,killerName:player.name,weapon:msg.weapon}); break; }
        case 'REVIVE': { const target=players.get(msg.targetId); if(target&&!target.alive){target.alive=true;target.hp=30;player.revives++;} ws.send(JSON.stringify({type:'REVIVE_OK',targetId:msg.targetId})); break; }
        case 'CHAT': { const m=player.match?matches.get(player.match):null; if(m)broadcast(m,{type:'CHAT_MSG',from:player.name,character:player.character,message:msg.message.slice(0,120),timestamp:Date.now()}); break; }
      }
    } catch(e){}
  });

  ws.on('close', () => {
    const p=players.get(playerId);
    if(p?.match){ const m=matches.get(p.match); if(m){ m.players=m.players.filter(id=>id!==playerId); broadcast(m,{type:'PLAYER_LEFT',playerId,playerName:p.name}); } }
    players.delete(playerId);
  });
});

function broadcast(match, msg, excludeId=null) {
  const json=JSON.stringify(msg);
  match.players.forEach(pid=>{ if(pid===excludeId)return; const p=players.get(pid); if(p?.ws?.readyState===WebSocket.OPEN)p.ws.send(json); });
}

function startMatch(match) {
  match.phase='play';
  broadcast(match,{type:'MATCH_START',playerCount:match.players.length,phase:'play',zoneRadius:match.zoneRadius});
  // Zone shrink cycle
  let shrinks=0;
  const shrink=()=>{
    if(!matches.has(match.id))return;
    shrinks++;match.zoneRadius=Math.max(150,match.zoneRadius*0.7);
    match.zoneCenterX=(Math.random()-0.5)*600;match.zoneCenterY=(Math.random()-0.5)*600;
    broadcast(match,{type:'ZONE_SHRINK',zoneRadius:match.zoneRadius,centerX:match.zoneCenterX,centerY:match.zoneCenterY,nextShrink:shrinks<6?75000:null});
    if(shrinks<6)setTimeout(shrink,75000);
  };
  setTimeout(shrink,90000);
}

const PORT = process.env.PORT || 3003;
server.listen(PORT, ()=>console.log(`\u{1F525} INFERNO RUN: Last Squad server on port ${PORT}`));
