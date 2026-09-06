const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Hard payload ceiling: 25MB (25 * 1024 * 1024 bytes)
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

const io = new Server(server, {
  maxHttpBufferSize: MAX_PAYLOAD_BYTES,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware & Static files
app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));

// Rate limiting for HTTP endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', apiLimiter);

// ----------------------------------------------------
// Room Manager (In-Memory Ephemeral Storage)
// ----------------------------------------------------
const rooms = new Map();
const failedJoinTracker = new Map();

// Helper to generate cryptographically strong 6-char shortcode
function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32, no confusing 0/O/1/I
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// IP-based Brute Force Protection for Room Joining
function isIpBlockedFromJoining(ip) {
  const now = Date.now();
  const record = failedJoinTracker.get(ip);
  if (!record) return false;
  if (now > record.resetAt) {
    failedJoinTracker.delete(ip);
    return false;
  }
  return record.attempts >= 5; // Max 5 failed join attempts per minute
}

function recordFailedJoinAttempt(ip) {
  const now = Date.now();
  const record = failedJoinTracker.get(ip) || { attempts: 0, resetAt: now + 60 * 1000 };
  record.attempts += 1;
  failedJoinTracker.set(ip, record);
}

function resetFailedJoinAttempts(ip) {
  failedJoinTracker.delete(ip);
}

// Room Purge Function
function destroyRoom(roomCode, reason = 'expired') {
  const room = rooms.get(roomCode);
  if (!room) return;

  if (room.graceTimer) clearTimeout(room.graceTimer);
  if (room.ttlTimer) clearTimeout(room.ttlTimer);

  // Notify connected sockets if any
  io.to(roomCode).emit('room_destroyed', { reason });
  
  // Wipe room data from RAM
  room.items = [];
  room.peers.clear();
  rooms.delete(roomCode);
  console.log(`[DropBridge] Room ${roomCode} destroyed (${reason}). Active rooms: ${rooms.size}`);
}

// API Route: Get Server Info (Local IP address for mobile QR codes)
app.get('/api/server-info', (req, res) => {
  res.json({ localIp: getLocalNetworkIp(), port: process.env.PORT || 3000 });
});

// API Route: Create Room
app.post('/api/create-room', (req, res) => {
  let roomCode = generateRoomCode();
  let attempts = 0;
  while (rooms.has(roomCode) && attempts < 10) {
    roomCode = generateRoomCode();
    attempts++;
  }

  const roomData = {
    code: roomCode,
    created: Date.now(),
    items: [], // Array of encrypted payload objects
    peers: new Set(),
    graceTimer: null,
    ttlTimer: setTimeout(() => destroyRoom(roomCode, 'TTL 30min timeout'), 30 * 60 * 1000)
  };

  rooms.set(roomCode, roomData);
  console.log(`[DropBridge] Room ${roomCode} created. Total active: ${rooms.size}`);

  res.json({ roomCode });
});

// Socket.io Real-Time Connection Handling
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address || socket.request.connection.remoteAddress;
  let currentRoomCode = null;

  // Event: Join Room
  socket.on('join_room', ({ roomCode }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const normalizedCode = (roomCode || '').trim().toUpperCase();

    if (isIpBlockedFromJoining(clientIp)) {
      cb({ success: false, error: 'Too many invalid code attempts. Please wait 1 minute.' });
      return;
    }

    const room = rooms.get(normalizedCode);
    if (!room) {
      recordFailedJoinAttempt(clientIp);
      cb({ success: false, error: 'Invalid or expired room code.' });
      return;
    }

    // Reset failed join attempts on valid join
    resetFailedJoinAttempts(clientIp);

    // Cancel pending disconnect grace timer if active
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
      console.log(`[DropBridge] Cancelled grace period disconnect timer for room ${normalizedCode}`);
    }

    socket.join(normalizedCode);
    room.peers.add(socket.id);
    currentRoomCode = normalizedCode;

    // Send existing encrypted items to newly joined client
    cb({
      success: true,
      roomCode: normalizedCode,
      peerCount: room.peers.size,
      items: room.items
    });

    // Notify room of updated peer count
    io.to(normalizedCode).emit('peer_update', { peerCount: room.peers.size });
  });

  // Event: Drop Encrypted Item
  socket.on('drop_item', ({ roomCode, encryptedPayload }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const normalizedCode = (roomCode || '').trim().toUpperCase();

    const room = rooms.get(normalizedCode);
    if (!room) {
      return cb({ success: false, error: 'Room expired or destroyed.' });
    }

    // Ensure socket is registered in the room
    if (!socket.rooms.has(normalizedCode)) {
      socket.join(normalizedCode);
      room.peers.add(socket.id);
    }
    currentRoomCode = normalizedCode;

    if (!encryptedPayload || typeof encryptedPayload !== 'object') {
      return cb({ success: false, error: 'Invalid payload format.' });
    }

    // Cap total stored items in memory per room (max 50 items)
    if (room.items.length >= 50) {
      room.items.shift(); // Remove oldest item to bound memory
    }

    // Add metadata timestamp & item ID (server cannot decrypt ciphertext content)
    const item = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ciphertext: encryptedPayload.ciphertext,
      iv: encryptedPayload.iv,
      salt: encryptedPayload.salt,
      mimeType: encryptedPayload.mimeType || 'application/octet-stream',
      itemType: encryptedPayload.itemType || 'file',
      size: encryptedPayload.size || 0
    };

    room.items.push(item);

    // Broadcast encrypted item to all clients in room
    io.to(roomCode).emit('item_dropped', item);
    cb({ success: true, itemId: item.id });
  });

  // Event: Clear Room History
  socket.on('clear_items', ({ roomCode }) => {
    if (!currentRoomCode || currentRoomCode !== roomCode) return;
    const room = rooms.get(roomCode);
    if (room) {
      room.items = [];
      io.to(roomCode).emit('items_cleared');
    }
  });

  // Event: Disconnect (with 10-second grace period timer)
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    room.peers.delete(socket.id);
    io.to(currentRoomCode).emit('peer_update', { peerCount: room.peers.size });

    // If 0 peers remaining, start 10-second grace period before destroying room memory
    if (room.peers.size === 0) {
      console.log(`[DropBridge] Room ${currentRoomCode} peer count reached 0. Starting 10s disconnect grace timer.`);
      room.graceTimer = setTimeout(() => {
        destroyRoom(currentRoomCode, '0 peers remaining (10s grace timeout)');
      }, 10000);
    }
  });
});

// Export server and rooms map for testing
module.exports = { app, server, io, rooms, failedJoinTracker, destroyRoom };

// Helper to get local network IP address
function getLocalNetworkIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Start listening if run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const localIp = getLocalNetworkIp();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🚀 DropBridge Server running!`);
    console.log(`💻 Desktop Access:   http://localhost:${PORT}`);
    console.log(`📱 Mobile/Local IP:  http://${localIp}:${PORT}`);
    console.log(`💡 TIP: Open http://${localIp}:${PORT} on your desktop`);
    console.log(`   so QR codes will use your Wi-Fi IP address!`);
    console.log(`🔒 E2E Encryption Active (Zero-Knowledge Memory Relay)`);
    console.log(`==================================================\n`);
  });
}

