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

// Middleware with proper CORS
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));

app.use(bodyParser.json({ limit: '10mb' }));

// Security headers to fix COOP error
app.use((req, res, next) => {
  res.header('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

console.log('🚀 Starting Walkie-Talkie Server with Socket.io + Google Sheets...');

// Google Sheets Configuration
const configureSheets = () => {
  console.log('🔧 Configuring Google Sheets...');
  
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
    console.log('❌ No Google Sheets credentials found');
    return null;
  }
};

const sheets = configureSheets();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets Helper Functions
const sheetHelper = {
  getAll: async (sheetName) => {
    try {
      if (!sheets || !SPREADSHEET_ID) {
        throw new Error('Sheets not configured');
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

  append: async (sheetName, rowData) => {
    try {
      if (!sheets || !SPREADSHEET_ID) {
        throw new Error('Sheets not configured');
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
  }
};

// Socket.io connection handling
const clients = new Map();

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  socket.on('auth', (userId) => {
    console.log(`✅ User authenticated: ${userId}`);
    clients.set(userId, socket.id);
    socket.userId = userId;
  });
  
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
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket.userId) {
      clients.delete(socket.userId);
      console.log(`❌ User ${socket.userId} removed`);
    }
  });
});

// API Routes with Google Sheets Integration

// Create or update user
app.post('/api/users', async (req, res) => {
  try {
    const { googleId, name, email, imageUrl } = req.body;
    
    if (!googleId) {
      return res.status(400).json({ message: 'googleId is required' });
    }
    
    console.log(`👤 Creating/updating user: ${name} (${googleId})`);
    
    // Check if user exists in Google Sheets
    let user = await sheetHelper.find('Users', { googleId });
    
    if (!user) {
      // Create new user in Google Sheets
      const userRow = [googleId, name, email, imageUrl, new Date().toISOString()];
      const success = await sheetHelper.append('Users', userRow);
      
      if (success) {
        console.log(`✅ Created new user in Sheets: ${name}`);
        res.json({
          googleId,
          name,
          email,
          imageUrl,
          message: 'User created successfully'
        });
      } else {
        throw new Error('Failed to save user to Google Sheets');
      }
    } else {
      // User already exists
      console.log(`✅ User already exists: ${name}`);
      res.json({
        googleId,
        name: user.name,
        email: user.email,
        imageUrl: user.imageUrl,
        message: 'User already exists'
      });
    }
    
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
});

// Add contact (SAVES TO GOOGLE SHEETS)
app.post('/api/contacts', async (req, res) => {
  try {
    const { userId, contact } = req.body;
    
    if (!userId || !contact) {
      return res.status(400).json({ message: 'Missing userId or contact data' });
    }
    
    console.log(`➕ Adding contact for user ${userId}:`, contact.name || contact.email);
    
    // Generate a proper contact ID
    const contactId = contact.googleId && !contact.googleId.startsWith('temp-') 
      ? contact.googleId 
      : `email-${Date.now()}-${contact.email}`;
    
    // Check if contact relationship already exists
    const existingContact = await sheetHelper.find('Contacts', { 
      userId: userId, 
      contactId: contactId 
    });
    
    if (!existingContact) {
      // Add to contacts sheet - THIS SAVES TO GOOGLE SHEETS
      const contactRow = [
        userId, 
        contactId, 
        contact.name || contact.email.split('@')[0],
        contact.email,
        contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=667eea&color=fff`,
        new Date().toISOString()
      ];
      
      const success = await sheetHelper.append('Contacts', contactRow);
      
      if (success) {
        console.log(`✅ Contact saved to Google Sheets: ${userId} -> ${contact.name || contact.email}`);
        
        res.json({
          googleId: contactId,
          name: contact.name || contact.email.split('@')[0],
          email: contact.email,
          imageUrl: contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=667eea&color=fff`
        });
      } else {
        throw new Error('Failed to save contact to Google Sheets');
      }
    } else {
      console.log(`ℹ️ Contact relationship already exists`);
      res.json({
        googleId: contactId,
        name: contact.name || contact.email.split('@')[0],
        email: contact.email,
        imageUrl: contact.imageUrl
      });
    }
    
  } catch (error) {
    console.error('❌ Error adding contact:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get user contacts (READS FROM GOOGLE SHEETS)
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const userContacts = await sheetHelper.findAll('Contacts', { userId: req.params.userId });
    
    // Transform contact data
    const contacts = userContacts.map(contact => ({
      googleId: contact.contactId,
      name: contact.contactName,
      email: contact.email || '',
      imageUrl: contact.contactImageUrl
    }));
    
    console.log(`📞 Fetched ${contacts.length} contacts from Sheets for user ${req.params.userId}`);
    
    res.json(contacts);
  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({ message: error.message });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // Test Google Sheets connection
    if (sheets && SPREADSHEET_ID) {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Users!A1:A1',
      });
    }
    
    res.json({ 
      status: 'healthy',
      database: 'google-sheets',
      timestamp: new Date().toISOString(),
      connectedClients: clients.size
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🎤 Walkie-Talkie Server is running!',
    technology: 'Socket.io + Google Sheets',
    database: 'Contacts and Users saved to Google Sheets'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`💾 Database: Google Sheets`);
  console.log(`🎤 Real-time: Socket.io`);
  console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
});
