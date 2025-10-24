// server.js
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

// Google Sheets Configuration
const configureSheets = () => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SHEETS_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('❌ Failed to configure Google Sheets:', error.message);
    process.exit(1);
  }
};

const sheets = configureSheets();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Initialize Sheets Structure
const initializeSheets = async () => {
  try {
    // Create Users sheet headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A1:E1',
      valueInputOption: 'RAW',
      resource: {
        values: [['googleId', 'name', 'email', 'imageUrl', 'createdAt']]
      }
    });

    // Create Contacts sheet headers
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
    console.log('ℹ️ Sheets already initialized or minor error:', error.message);
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
      console.error(`Error reading from ${sheetName}:`, error);
      throw error;
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
    } catch (error) {
      console.error(`Error writing to ${sheetName}:`, error);
      throw error;
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

// Initialize on startup
initializeSheets().catch(console.error);

// ... rest of your WebSocket and API routes remain the same
// (WebSocket code, /api/contacts, /api/contacts POST, etc.)
