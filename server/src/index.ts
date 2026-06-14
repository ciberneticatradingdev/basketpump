import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { Room } from './room';
import type { InputPayload, RoomSummary } from './protocol';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const TICK_HZ = 30;
const SNAP_HZ = 20;

const app = express();
app.use(cors());
app.get('/', (_req, res) => res.json({ ok: true, game: 'BasketPump', rooms: ROOM_CODES }));
app.get('/health', (_req, res) => res.send('ok'));
app.get('/rooms', (_req, res) => res.json(rooms.map(r => r.summary())));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ===== fixed set of 3 real-time rooms =====
const ROOM_CODES = ['ARENA-1', 'ARENA-2', 'ARENA-3'];
const rooms: Room[] = ROOM_CODES.map(c => new Room(c));
const roomByCode = new Map(rooms.map(r => [r.code, r]));
// track which room each socket is in
const socketRoom = new Map<string, string>();

function summaries(): RoomSummary[] { return rooms.map(r => r.summary()); }
function pickQuickRoom(): Room {
  // first room with an open human slot; else least populated
  const open = rooms.find(r => r.humanCount() < r.capacity());
  if (open) return open;
  return rooms.slice().sort((a, b) => a.humanCount() - b.humanCount())[0];
}

io.on('connection', (socket) => {
  socket.emit('rooms', summaries());

  socket.on('listRooms', () => socket.emit('rooms', summaries()));

  const joinRoom = (code: string, name: string) => {
    // leave previous
    const prev = socketRoom.get(socket.id);
    if (prev && prev !== code) { roomByCode.get(prev)?.removeHuman(socket.id); socket.leave(prev); }
    const room = roomByCode.get(code);
    if (!room) { socket.emit('joinError', 'Room not found'); return; }
    if (room.humanCount() >= room.capacity()) { socket.emit('joinError', 'Room full'); return; }
    const slot = room.addHuman(socket.id, name);
    if (!slot) { socket.emit('joinError', 'Room full'); return; }
    socketRoom.set(socket.id, code);
    socket.join(code);
    socket.emit('assigned', { code, slotId: slot.id, team: slot.team });
    io.emit('rooms', summaries());
  };

  socket.on('joinRoom', (p: { code: string; name: string }) => joinRoom(p.code, p.name));
  socket.on('quickPlay', (p: { name: string }) => joinRoom(pickQuickRoom().code, p?.name || 'Baller'));

  socket.on('input', (p: InputPayload) => {
    const code = socketRoom.get(socket.id); if (!code) return;
    const room = roomByCode.get(code); if (!room) return;
    const slot = room.players.find(q => q.socketId === socket.id); if (!slot) return;
    room.setInput(slot.id, p);
  });

  socket.on('leaveRoom', () => {
    const code = socketRoom.get(socket.id);
    if (code) { roomByCode.get(code)?.removeHuman(socket.id); socket.leave(code); socketRoom.delete(socket.id); io.emit('rooms', summaries()); }
  });

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    if (code) { roomByCode.get(code)?.removeHuman(socket.id); socketRoom.delete(socket.id); io.emit('rooms', summaries()); }
  });
});

// ===== simulation loop =====
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const r of rooms) r.tick(dt);
}, 1000 / TICK_HZ);

// ===== snapshot broadcast (only to rooms with humans) =====
setInterval(() => {
  for (const r of rooms) {
    if (!r.hasHumans()) continue;
    const snap = r.snapshot();
    snap.fx = r.consumeFx();
    io.to(r.code).emit('state', snap);
  }
}, 1000 / SNAP_HZ);

// lobby summaries heartbeat (cheap, keeps counts fresh)
setInterval(() => io.emit('rooms', summaries()), 3000);

server.listen(PORT, () => console.log(`BasketPump server on :${PORT} — rooms ${ROOM_CODES.join(', ')}`));
