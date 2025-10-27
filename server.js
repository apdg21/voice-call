require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CORS Configuration
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));

console.log('🚀 Starting Walkie-Talkie Server with Socket.io...');

// Socket.io connection handling
const clients = new Map();

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  // Authentication
  socket.on('auth', (userId) => {
    console.log(`✅ User authenticated: ${userId}`);
    clients.set(userId, socket.id);
    socket.userId = userId;
  });
  
  // Audio transmission
  socket.on('audio', (data) => {
    console.log(`🎤 Audio from ${data.from} to ${data.to}, size: ${data.data.length}`);
    
    const recipientSocketId = clients.get(data.to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('audio', {
        from: data.from,
        data: data.data
      });
      console.log(`✅ Audio forwarded to ${data.to}`);
    } else {
      console.log(`❌ Recipient ${data.to} not connected`);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket.userId) {
      clients.delete(socket.userId);
      console.log(`❌ User ${socket.userId} removed`);
    }
  });
  
  // Error handling
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

// Basic API routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    connectedClients: clients.size,
    message: 'Backend is running with Socket.io'
  });
});

app.get('/api/connections', (req, res) => {
  res.json({
    totalConnections: clients.size,
    connectedUsers: Array.from(clients.keys()),
    serverTime: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🎤 Walkie-Talkie Server is running!',
    technology: 'Socket.io for real-time audio',
    endpoints: {
      health: '/api/health',
      connections: '/api/connections'
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`🔗 HTTP: http://localhost:${PORT}`);
  console.log(`🎤 Socket.io: Connected via socket.io client`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log(`=========================================\n`);
});
