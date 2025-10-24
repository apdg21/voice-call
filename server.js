// server.js - Optimized for Render with environment variables
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
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

// Google Sheets Configuration using Environment Variables
const configureSheets = () => {
  console.log('🔧 Configuring Google Sheets with environment variables...');
  
  const credentials = {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL
  };

  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
};

const sheets = configureSheets();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

console.log('🚀 Starting Walkie-Talkie Server on Render');
console.log('📊 Using Sheet ID:', SPREADSHEET_ID);
console.log('👤 Service Account:', process.env.GOOGLE_CLIENT_EMAIL);

// Initialize Sheets
const initializeSheets = async () => {
  try {
    console.log('🔄 Testing Google Sheets connection...');
    
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    console.log('✅ Connected to:', response.data.properties.title);
    
    // Initialize headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A1:E1',
      valueInputOption: 'RAW',
      resource: {
        values: [['googleId', 'name', 'email', 'imageUrl', 'createdAt']]
      }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Contacts!A1:E1',
      valueInputOption: 'RAW',
      resource: {
        values: [['userId', 'contactId', 'contactName', 'contactImageUrl', 'createdAt']]
      }
    });

    console.log('✅ Google Sheets initialized successfully');
  } catch (error) {
    console.error('❌ Sheets initialization failed:', error.message);
    if (error.message.includes('PERMISSION_DENIED')) {
      console.log('💡 SOLUTION: Share your sheet with this email:', process.env.GOOGLE_CLIENT_EMAIL);
    }
  }
};

// Helper functions
const sheetHelper = {
  getAll: async (sheetName) => {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
      });
      
      const rows = response.data.values;
      if (!rows || rows.length === 0) return [];
      
      const headers = rows[0];
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });
    } catch (error) {
      console.error(`Error reading from ${sheetName}:`, error.message);
      return [];
    }
  },

  append: async (sheetName, rowData) => {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });
      return true;
    } catch (error) {
      console.error(`Error writing to ${sheetName}:`, error.message);
      return false;
    }
  },

  find: async (sheetName, criteria) => {
    const allData = await sheetHelper.getAll(sheetName);
    return allData.find(item => {
      for (let key in criteria) {
        if (item[key] !== criteria[key]) return false;
      }
      return true;
    });
  },

  findAll: async (sheetName, criteria) => {
    const allData = await sheetHelper.getAll(sheetName);
    return allData.filter(item => {
      for (let key in criteria) {
        if (item[key] !== criteria[key]) return false;
      }
      return true;
    });
  }
};

// WebSocket and API routes (keep your existing code here)
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        clients.set(data.userId, ws);
        console.log(`User ${data.userId} authenticated`);
      } 
      else if (data.type === 'audio') {
        const recipientWs = clients.get(data.to);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({
            type: 'audio',
            from: data.from,
            data: data.data
          }));
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    for (const [userId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(userId);
        console.log(`User ${userId} disconnected`);
        break;
      }
    }
  });
});

// API Routes
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const userContacts = await sheetHelper.findAll('Contacts', { userId: req.params.userId });
    const contacts = userContacts.map(contact => ({
      googleId: contact.contactId,
      name: contact.contactName,
      imageUrl: contact.contactImageUrl
    }));
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const { userId, contact } = req.body;
    
    // Add user if doesn't exist
    let user = await sheetHelper.find('Users', { googleId: userId });
    if (!user) {
      const userRow = [userId, contact.name, contact.email, contact.imageUrl, new Date().toISOString()];
      await sheetHelper.append('Users', userRow);
    }
    
    // Add contact relationship
    const existingContact = await sheetHelper.find('Contacts', { 
      userId: userId, 
      contactId: contact.googleId 
    });
    
    if (!existingContact) {
      const contactRow = [userId, contact.googleId, contact.name, contact.imageUrl, new Date().toISOString()];
      await sheetHelper.append('Contacts', contactRow);
    }
    
    res.json({
      googleId: contact.googleId,
      name: contact.name,
      imageUrl: contact.imageUrl
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A1:A1',
    });
    res.json({ status: 'healthy', database: 'google-sheets' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Walkie-Talkie Server is running!',
    health: '/api/health'
  });
});

// Start server
const startServer = async () => {
  await initializeSheets();
  
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
  });
};

startServer().catch(console.error);
