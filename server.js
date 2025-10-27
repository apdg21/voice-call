require('dotenv').config();
const express = require('express');
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

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

console.log('🚀 Starting Walkie-Talkie Server with Socket.io...');

// Simple in-memory storage (replace with your Google Sheets logic)
const users = new Map();
const clients = new Map();

// Socket.io connection handling
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
});

// API Routes (simplified for testing)
app.post('/api/users', (req, res) => {
  try {
    const userData = req.body;
    console.log('📝 Creating user:', userData.email);
    
    // Store user in memory
    users.set(userData.googleId, userData);
    
    res.json({
      success: true,
      user: userData,
      message: 'User created successfully'
    });
    
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

app.post('/api/contacts', (req, res) => {
  try {
    const { userId, contact } = req.body;
    console.log(`📞 Adding contact for user ${userId}:`, contact.email);
    
    // Simple in-memory storage
    const userContacts = users.get(userId)?.contacts || [];
    userContacts.push(contact);
    
    if (users.has(userId)) {
      users.get(userId).contacts = userContacts;
    }
    
    res.json(contact);
    
  } catch (error) {
    console.error('❌ Error adding contact:', error);
    res.status(500).json({
      error: 'Failed to add contact'
    });
  }
});

app.get('/api/contacts/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const userContacts = users.get(userId)?.contacts || [];
    res.json(userContacts);
    
  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({
      error: 'Failed to fetch contacts'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    connectedClients: clients.size,
    message: 'Backend is running with Socket.io'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🎤 Walkie-Talkie Server is running!',
    technology: 'Socket.io for real-time audio'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`🔗 HTTP: http://localhost:${PORT}`);
  console.log(`🎤 Socket.io: Connected via socket.io client`);
});
