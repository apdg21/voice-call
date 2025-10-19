// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/walkie-talkie', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const UserSchema = new mongoose.Schema({
  googleId: String,
  name: String,
  email: String,
  imageUrl: String,
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

const User = mongoose.model('User', UserSchema);

// WebSocket connection handling
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'auth') {
      // Store client connection with user ID
      clients.set(data.userId, ws);
      console.log(`User ${data.userId} authenticated`);
    } 
    else if (data.type === 'audio') {
      // Forward audio to the recipient
      const recipientWs = clients.get(data.to);
      if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
        recipientWs.send(JSON.stringify({
          type: 'audio',
          from: data.from,
          data: data.data
        }));
      }
    }
  });
  
  ws.on('close', () => {
    // Remove client from map when disconnected
    for (const [userId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(userId);
        break;
      }
    }
    console.log('Client disconnected');
  });
});

// API Routes
// Get user contacts
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ googleId: req.params.userId }).populate('contacts');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user.contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { userId, contact } = req.body;
    
    // Find or create the contact user
    let contactUser = await User.findOne({ googleId: contact.googleId });
    if (!contactUser) {
      contactUser = new User({
        googleId: contact.googleId,
        name: contact.name,
        email: contact.email,
        imageUrl: contact.imageUrl,
        contacts: []
      });
      await contactUser.save();
    }
    
    // Add contact to user's contact list
    const user = await User.findOne({ googleId: userId });
    if (!user.contacts.includes(contactUser._id)) {
      user.contacts.push(contactUser._id);
      await user.save();
    }
    
    res.json(contactUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
