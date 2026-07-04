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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors({ origin: "*", credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

console.log('🚀 Starting Walkie-Talkie Server...');

// Google Sheets Configuration
const configureSheets = () => {
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    console.log('❌ No Google Sheets credentials found');
    return null;
  }
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
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
};

const sheets = configureSheets();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets helpers
const sheetHelper = {
  getAll: async (sheetName) => {
    try {
      if (!sheets || !SPREADSHEET_ID) throw new Error('Sheets not configured');
      const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
      const rows = response.data.values;
      if (!rows || rows.length === 0) return [];
      const headers = rows[0];
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
    } catch (e) { console.error(`Error reading ${sheetName}:`, e.message); return []; }
  },

  append: async (sheetName, rowData) => {
    try {
      if (!sheets || !SPREADSHEET_ID) throw new Error('Sheets not configured');
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, range: sheetName, valueInputOption: 'RAW',
        resource: { values: [rowData] }
      });
      return true;
    } catch (e) { console.error(`Error writing to ${sheetName}:`, e.message); return false; }
  },

  find: async (sheetName, criteria) => {
    const all = await sheetHelper.getAll(sheetName);
    return all.find(item => Object.keys(criteria).every(k => item[k] === criteria[k])) || null;
  },

  findAll: async (sheetName, criteria) => {
    const all = await sheetHelper.getAll(sheetName);
    return all.filter(item => Object.keys(criteria).every(k => item[k] === criteria[k]));
  },

  // Update a row by matching criteria, setting fields from updateData
  updateRow: async (sheetName, criteria, updateData) => {
    try {
      if (!sheets || !SPREADSHEET_ID) throw new Error('Sheets not configured');
      const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
      const rows = response.data.values;
      if (!rows || rows.length < 2) return false;
      const headers = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const matches = Object.keys(criteria).every(k => {
          const idx = headers.indexOf(k);
          return idx !== -1 && row[idx] === criteria[k];
        });
        if (matches) {
          Object.keys(updateData).forEach(k => {
            const idx = headers.indexOf(k);
            if (idx !== -1) row[idx] = updateData[k];
          });
          const range = `${sheetName}!A${i + 1}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW',
            resource: { values: [row] }
          });
          return true;
        }
      }
      return false;
    } catch (e) { console.error(`Error updating ${sheetName}:`, e.message); return false; }
  }
};

// In-memory connected clients: googleId -> { socketId, email }
const clients = new Map();
// Email lookup: email -> googleId (populated on /api/users)
const emailToGoogleId = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('auth', async (data) => {
    // Accept both old format (just userId string) and new format ({ userId, email })
    const userId = typeof data === 'string' ? data : data.userId;
    const email  = typeof data === 'string' ? null  : data.email;

    console.log(`✅ User authenticated: ${userId} (${email || 'no email'})`);
    clients.set(userId, { socketId: socket.id, email });
    if (email) emailToGoogleId.set(email, userId);
    socket.userId = userId;

    // Deliver any queued (missed) messages
    try {
      const pending = await sheetHelper.findAll('Messages', { toId: userId, delivered: 'false' });
      if (pending.length > 0) {
        console.log(`📬 Delivering ${pending.length} queued messages to ${userId}`);
        for (const msg of pending) {
          socket.emit('audio', {
            from: msg.fromId,
            fromName: msg.fromName,
            data: msg.audioData,
            timestamp: msg.timestamp,
            messageId: msg.id
          });
          await sheetHelper.updateRow('Messages', { id: msg.id }, { delivered: 'true' });
        }
      }
    } catch (e) {
      console.error('Error delivering queued messages:', e.message);
    }
  });

  socket.on('audio', async (data) => {
    console.log(`🎤 Audio from ${data.from} to ${data.to}, size: ${data.data.length}`);

    // Resolve recipient: might be a real googleId or a temp email-based ID
    let resolvedTo = data.to;
    if (!clients.has(resolvedTo)) {
      // Try to find the real googleId by email (temp ID format: email-TIMESTAMP-email@domain)
      const emailMatch = resolvedTo.match(/email-\d+-(.+)$/);
      if (emailMatch) {
        const realId = emailToGoogleId.get(emailMatch[1]);
        if (realId) resolvedTo = realId;
      }
    }

    // Save to message history regardless of recipient online status
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const recipientOnline = clients.has(resolvedTo);
    const msgRow = [
      messageId, data.from, data.fromName || '', resolvedTo,
      data.data,  // base64 string - store directly, no JSON.stringify needed
      new Date().toISOString(),
      recipientOnline ? 'true' : 'false'
    ];
    await sheetHelper.append('Messages', msgRow);

    // Forward immediately if recipient is online
    const recipientEntry = clients.get(resolvedTo);
    if (recipientEntry) {
      io.to(recipientEntry.socketId).emit('audio', {
        from: data.from,
        fromName: data.fromName || '',
        data: data.data,
        timestamp: new Date().toISOString(),
        messageId
      });
      console.log(`✅ Audio forwarded to ${resolvedTo}`);
    } else {
      console.log(`📭 ${resolvedTo} offline — message queued`);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);
    if (socket.userId) {
      const entry = clients.get(socket.userId);
      if (entry?.email) emailToGoogleId.delete(entry.email);
      clients.delete(socket.userId);
    }
  });
});

// ── API Routes ──────────────────────────────────────────────────────────────

// Create or update user — also resolves temp contact IDs to real googleId
app.post('/api/users', async (req, res) => {
  try {
    const { googleId, name, email, imageUrl } = req.body;
    if (!googleId) return res.status(400).json({ message: 'googleId is required' });

    let user = await sheetHelper.find('Users', { googleId });
    if (!user) {
      await sheetHelper.append('Users', [googleId, name, email, imageUrl, new Date().toISOString()]);
      console.log(`✅ New user: ${name}`);

      // Fix any contacts that were added by email before this user registered.
      // They got a temp contactId like "email-TIMESTAMP-their@email.com".
      // Now we know the real googleId, update all those contact records.
      try {
        const allContacts = await sheetHelper.getAll('Contacts');
        const tempRows = allContacts.filter(c => c.email === email && c.contactId !== googleId);
        for (const c of tempRows) {
          await sheetHelper.updateRow('Contacts',
            { userId: c.userId, contactId: c.contactId },
            { contactId: googleId }
          );
          console.log(`🔗 Resolved temp contact ${c.contactId} -> ${googleId} for user ${c.userId}`);
        }
      } catch (e) {
        console.error('Error resolving temp contacts:', e.message);
      }
    }

    res.json({ googleId, name: user?.name || name, email: user?.email || email, imageUrl: user?.imageUrl || imageUrl });
  } catch (e) {
    console.error('Error creating user:', e);
    res.status(500).json({ message: e.message });
  }
});

// Add contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { userId, contact } = req.body;
    if (!userId || !contact) return res.status(400).json({ message: 'Missing userId or contact data' });

    // Try to find the real googleId by email if we have one
    let resolvedId = contact.googleId;
    if (!resolvedId || resolvedId.startsWith('temp-') || resolvedId.startsWith('email-')) {
      const registeredUser = await sheetHelper.find('Users', { email: contact.email });
      resolvedId = registeredUser ? registeredUser.googleId : `email-${Date.now()}-${contact.email}`;
    }

    const existing = await sheetHelper.find('Contacts', { userId, contactId: resolvedId });
    if (!existing) {
      await sheetHelper.append('Contacts', [
        userId, resolvedId,
        contact.name || contact.email.split('@')[0],
        contact.email,
        contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=1a1d23&color=f59e0b`,
        new Date().toISOString()
      ]);
    }

    res.json({
      googleId: resolvedId,
      name: contact.name || contact.email.split('@')[0],
      email: contact.email,
      imageUrl: contact.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name || contact.email.split('@')[0])}&background=1a1d23&color=f59e0b`
    });
  } catch (e) {
    console.error('Error adding contact:', e);
    res.status(500).json({ message: e.message });
  }
});

// Delete a contact
app.delete('/api/contacts/:userId/:contactId', async (req, res) => {
  try {
    const { userId, contactId } = req.params;
    if (!sheets || !SPREADSHEET_ID) throw new Error('Sheets not configured');

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Contacts'
    });
    const rows = response.data.values;
    if (!rows || rows.length < 2) return res.json({ success: true });

    const headers = rows[0];
    const userIdIdx = headers.indexOf('userId');
    const contactIdIdx = headers.indexOf('contactId');

    // Find the row index to delete
    let rowToDelete = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][userIdIdx] === userId && rows[i][contactIdIdx] === contactId) {
        rowToDelete = i + 1; // 1-indexed for Sheets API
        break;
      }
    }

    if (rowToDelete === -1) return res.json({ success: true }); // already gone

    // Delete the row using batchUpdate
    const sheetId = await getSheetId('Contacts');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowToDelete - 1,
              endIndex: rowToDelete
            }
          }
        }]
      }
    });

    console.log(`✅ Deleted contact ${contactId} for user ${userId}`);
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting contact:', e);
    res.status(500).json({ message: e.message });
  }
});

// Helper: get the numeric sheetId for a named sheet
async function getSheetId(sheetName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  return sheet.properties.sheetId;
}

// Get contacts
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const rows = await sheetHelper.findAll('Contacts', { userId: req.params.userId });
    res.json(rows.map(c => ({
      googleId: c.contactId,
      name: c.contactName,
      email: c.email || '',
      imageUrl: c.contactImageUrl
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Get message history between two users
app.get('/api/messages/:userId/:contactId', async (req, res) => {
  try {
    const { userId, contactId } = req.params;
    const all = await sheetHelper.getAll('Messages');
    const history = all
      .filter(m => (m.fromId === userId && m.toId === contactId) || (m.fromId === contactId && m.toId === userId))
      .slice(-50) // last 50 messages
      .map(m => ({
        id: m.id,
        from: m.fromId,
        fromName: m.fromName,
        to: m.toId,
        data: m.audioData,
        timestamp: m.timestamp
      }));
    res.json(history);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Initialize Google Sheets (create headers if sheets are empty)
// Call once: POST /api/init
app.post('/api/init', async (req, res) => {
  try {
    if (!sheets || !SPREADSHEET_ID) throw new Error('Sheets not configured');

    const initSheet = async (name, headers) => {
      const existing = await sheetHelper.getAll(name);
      if (existing.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${name}!A1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
        console.log(`✅ Initialized sheet: ${name}`);
      }
    };

    await initSheet('Users',    ['googleId','name','email','imageUrl','createdAt']);
    await initSheet('Contacts', ['userId','contactId','contactName','email','contactImageUrl','createdAt']);
    await initSheet('Messages', ['id','fromId','fromName','toId','audioData','timestamp','delivered']);

    res.json({ success: true, message: 'Sheets initialized' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Who's online — returns googleIds AND emails so frontend can match temp-ID contacts
app.get('/api/online', (req, res) => {
  const onlineUsers = Array.from(clients.keys());
  const onlineEmails = Array.from(clients.values())
    .map(e => e.email)
    .filter(Boolean);
  res.json({ onlineUsers, onlineEmails });
});

// Health check
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ message: '🎤 Walkie-Talkie Server running' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server on port ${PORT}`);
});
