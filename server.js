// server.js
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Increased for audio data

// Validate critical environment variables
console.log('🔧 Initializing Walkie-Talkie Server...');
console.log('📊 Sheet ID:', process.env.GOOGLE_SHEET_ID);

if (!process.env.GOOGLE_SHEET_ID) {
  console.error('❌ CRITICAL: GOOGLE_SHEET_ID is missing from environment variables');
  process.exit(1);
}

// Google Sheets Configuration using Environment Variables
const configureSheets = () => {
  console.log('🔧 Configuring Google Sheets with environment variables...');
  
  // Check if we're using environment variables or service account file
  if (process.env.GOOGLE_PRIVATE_KEY) {
    console.log('📝 Using environment variable credentials');
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
  } else {
    console.log('📁 Using file-based credentials');
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SHEETS_KEY_FILE || './credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  }
};

const sheets = configureSheets();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

console.log('👤 Service Account:', process.env.GOOGLE_CLIENT_EMAIL);

// Helper functions for Google Sheets operations
const sheetHelper = {
  // Get all rows from a sheet
  getAll: async (sheetName) => {
    try {
      if (!SPREADSHEET_ID) {
        throw new Error('SPREADSHEET_ID is not defined');
      }
      
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
      console.error(`❌ Error reading from ${sheetName}:`, error.message);
      return [];
    }
  },

  // Append row to sheet
  append: async (sheetName, rowData) => {
    try {
      if (!SPREADSHEET_ID) {
        throw new Error('SPREADSHEET_ID is not defined');
      }
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });
      console.log(`✅ Data appended to ${sheetName}`);
      return true;
    } catch (error) {
      console.error(`❌ Error writing to ${sheetName}:`, error.message);
      return false;
    }
  },

  // Find row by criteria
  find: async (sheetName, criteria) => {
    try {
      const allData = await sheetHelper.getAll(sheetName);
      return allData.find(item => {
        for (let key in criteria) {
          if (item[key] !== criteria[key]) return false;
        }
        return true;
      });
    } catch (error) {
      console.error(`❌ Error finding in ${sheetName}:`, error.message);
      return null;
    }
  },

  // Find all rows matching criteria
  findAll: async (sheetName, criteria) => {
    try {
      const allData = await sheetHelper.getAll(sheetName);
      return allData.filter(item => {
        for (let key in criteria) {
          if (item[key] !== criteria[key]) return false;
        }
        return true;
      });
    } catch (error) {
      console.error(`❌ Error finding all in ${sheetName}:`, error.message);
      return [];
    }
  },

  // Update existing row
  update: async (sheetName, criteria, updates) => {
    try {
      const allData = await sheetHelper.getAll(sheetName);
      const headers = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:Z1`,
      });
      
      const headerRow = headers.data.values[0];
      const rowIndex = allData.findIndex(item => {
        for (let key in criteria) {
          if (item[key] !== criteria[key]) return false;
        }
        return true;
      });
      
      if (rowIndex !== -1) {
        const updatedRow = headerRow.map(header => updates[header] !== undefined ? updates[header] : allData[rowIndex][header]);
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A${rowIndex + 2}:Z${rowIndex + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [updatedRow]
          }
        });
        
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Error updating ${sheetName}:`, error.message);
      return false;
    }
  }
};

// Initialize Sheets Structure
const initializeSheets = async () => {
  try {
    console.log('🔄 Testing Google Sheets connection...');
    
    // First, test if we can access the sheet
    const sheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    console.log('✅ Connected to:', sheetInfo.data.properties.title);
    
    // Check if our sheets exist, create them if they don't
    const existingSheets = sheetInfo.data.sheets.map(sheet => sheet.properties.title);
    console.log('📋 Existing sheets:', existingSheets);
    
    // Initialize Users sheet if it doesn't exist
    if (!existingSheets.includes('Users')) {
      console.log('Creating Users sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Users'
              }
            }
          }]
        }
      });
    }
    
    // Ensure Users sheet has headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A1:E1',
      valueInputOption: 'RAW',
      resource: {
        values: [['googleId', 'name', 'email', 'imageUrl', 'createdAt']]
      }
    });

    // Initialize Contacts sheet if it doesn't exist
    if (!existingSheets.includes('Contacts')) {
      console.log('Creating Contacts sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Contacts'
              }
            }
          }]
        }
      });
    }
    
    // Ensure Contacts sheet has headers
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

// WebSocket connection handling for real-time audio
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('🔌 Client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        // Store client connection with user ID
        clients.set(data.userId, ws);
        console.log(`✅ User ${data.userId} authenticated`);
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
          console.log(`🎤 Audio forwarded from ${data.from} to ${data.to}`);
        } else {
          console.log(`❌ Recipient ${data.to} not connected`);
        }
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    // Remove client from map when disconnected
    for (const [userId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(userId);
        console.log(`❌ User ${userId} disconnected`);
        break;
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// API Routes

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Simple test - try to read from Users sheet
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A1:A1',
    });
    
    res.json({ 
      status: 'healthy',
      database: 'google-sheets',
      timestamp: new Date().toISOString(),
      connectedUsers: clients.size
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get user contacts
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const userContacts = await sheetHelper.findAll('Contacts', { userId: req.params.userId });
    
    // Transform contact data
    const contacts = userContacts.map(contact => ({
      googleId: contact.contactId,
      name: contact.contactName,
      email: contact.email || '', // Add email if available
      imageUrl: contact.contactImageUrl
    }));
    
    console.log(`📞 Fetched ${contacts.length} contacts for user ${req.params.userId}`);
    
    res.json(contacts);
  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({ message: error.message });
  }
});

// Add contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { userId, contact } = req.body;
    
    if (!userId || !contact) {
      return res.status(400).json({ message: 'Missing userId or contact data' });
    }
    
    console.log(`➕ Adding contact for user ${userId}:`, contact.name || contact.email);
    
    // Check if user exists, if not create
    let user = await sheetHelper.find('Users', { googleId: userId });
    if (!user) {
      // If user doesn't exist, we need to create them first
      // This should ideally come from the frontend during login
      return res.status(400).json({ message: 'User not found. Please login first.' });
    }
    
    // Generate a proper contact ID if it's a temporary one
    const contactId = contact.googleId && !contact.googleId.startsWith('temp-') 
      ? contact.googleId 
      : `email-${contact.email}`;
    
    // Check if contact exists, if not create a placeholder
    let contactUser = await sheetHelper.find('Users', { googleId: contactId });
    if (!contactUser) {
      const contactRow = [
        contactId,
        contact.name || contact.email.split('@')[0],
        contact.email,
        contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=667eea&color=fff`,
        new Date().toISOString()
      ];
      await sheetHelper.append('Users', contactRow);
      console.log(`👤 Created contact user: ${contact.name || contact.email}`);
    }
    
    // Check if contact relationship already exists
    const existingContact = await sheetHelper.find('Contacts', { 
      userId: userId, 
      contactId: contactId 
    });
    
    if (!existingContact) {
      // Add to contacts sheet
      const contactRow = [
        userId, 
        contactId, 
        contact.name || contact.email.split('@')[0],
        contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=667eea&color=fff`,
        new Date().toISOString()
      ];
      await sheetHelper.append('Contacts', contactRow);
      console.log(`✅ Added contact relationship: ${userId} -> ${contact.name || contact.email}`);
    } else {
      console.log(`ℹ️ Contact relationship already exists: ${userId} -> ${contact.name || contact.email}`);
    }
    
    res.json({
      googleId: contactId,
      name: contact.name || contact.email.split('@')[0],
      email: contact.email,
      imageUrl: contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=667eea&color=fff`
    });
  } catch (error) {
    console.error('❌ Error adding contact:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create or update user (called when user logs in)
app.post('/api/users', async (req, res) => {
  try {
    const { googleId, name, email, imageUrl } = req.body;
    
    if (!googleId) {
      return res.status(400).json({ message: 'googleId is required' });
    }
    
    console.log(`👤 Creating/updating user: ${name} (${googleId})`);
    
    let user = await sheetHelper.find('Users', { googleId });
    
    if (!user) {
      // Create new user
      const userRow = [googleId, name, email, imageUrl, new Date().toISOString()];
      await sheetHelper.append('Users', userRow);
      console.log(`✅ Created new user: ${name}`);
    } else {
      // Update existing user if needed
      if (user.name !== name || user.email !== email || user.imageUrl !== imageUrl) {
        await sheetHelper.update('Users', { googleId }, {
          googleId: googleId,
          name: name,
          email: email,
          imageUrl: imageUrl,
          createdAt: user.createdAt || new Date().toISOString()
        });
        console.log(`✅ Updated user: ${name}`);
      }
    }
    
    res.json({
      googleId,
      name,
      email,
      imageUrl
    });
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Search users by email
app.get('/api/users/search', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email parameter required' });
    }
    
    const users = await sheetHelper.getAll('Users');
    const foundUser = users.find(user => 
      user.email && user.email.toLowerCase() === email.toLowerCase()
    );
    
    if (foundUser) {
      res.json({
        exists: true,
        user: {
          googleId: foundUser.googleId,
          name: foundUser.name,
          email: foundUser.email,
          imageUrl: foundUser.imageUrl
        }
      });
    } else {
      res.json({
        exists: false,
        message: 'User not found. They need to sign up first.'
      });
    }
  } catch (error) {
    console.error('❌ Error searching user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get user info
app.get('/api/users/:userId', async (req, res) => {
  try {
    const user = await sheetHelper.find('Users', { googleId: req.params.userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      googleId: user.googleId,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl
    });
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all users (for debugging)
app.get('/api/users', async (req, res) => {
  try {
    const users = await sheetHelper.getAll('Users');
    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all contacts (for debugging)
app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await sheetHelper.getAll('Contacts');
    res.json(contacts);
  } catch (error) {
    console.error('❌ Error fetching all contacts:', error);
    res.status(500).json({ message: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🎤 Walkie-Talkie Server is running!',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      userContacts: '/api/contacts/:userId',
      addContact: '/api/contacts (POST)',
      createUser: '/api/users (POST)',
      searchUser: '/api/users/search?email=...'
    },
    websocket: 'Connect via WebSocket for real-time audio',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    message: 'Endpoint not found',
    availableEndpoints: [
      'GET  /',
      'GET  /api/health',
      'GET  /api/contacts/:userId',
      'POST /api/contacts',
      'POST /api/users',
      'GET  /api/users/search?email=...',
      'GET  /api/users/:userId'
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// Initialize and start server
const startServer = async () => {
  await initializeSheets();
  
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Walkie-Talkie Server running on port ${PORT}`);
    console.log(`📊 Database: Google Sheets`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🎤 WebSocket: ws://localhost:${PORT}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log(`=========================================\n`);
  });
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start the server
startServer().catch(console.error);
