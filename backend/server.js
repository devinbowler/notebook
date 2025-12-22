const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simple token storage (in production, use Redis or similar)
const validTokens = new Set();

// Generate a random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Auth middleware - protects all /api routes except /api/login
function authMiddleware(req, res, next) {
  // Skip auth for login endpoint
  if (req.path === '/api/login') {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  if (!validTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
  
  next();
}

// Apply auth middleware to all /api routes
app.use('/api', authMiddleware);

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Note Schema
const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
});

const Note = mongoose.model('Note', noteSchema);

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Notes API is running' });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD;
  
  // Add this debug line temporarily
  console.log('Login attempt. Password received:', password ? 'yes' : 'no', 'APP_PASSWORD set:', correctPassword ? 'yes' : 'no');
  
  if (!correctPassword) {
    console.error('APP_PASSWORD environment variable not set!');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (password === correctPassword) {
    const token = generateToken();
    validTokens.add(token);
    
    setTimeout(() => {
      validTokens.delete(token);
    }, 24 * 60 * 60 * 1000);
    
    res.json({ success: true, token });
  } else {
    console.log('Password mismatch'); // Add this
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    validTokens.delete(token);
  }
  res.json({ success: true });
});

// Get all notes (without full content for grid view)
app.get('/api/notes', async (req, res) => {
  try {
    const notes = await Note.find()
      .select('title content lastModified')
      .sort({ lastModified: -1 });
    
    // Create preview of content (first 200 chars)
    const notesWithPreview = notes.map(note => ({
      _id: note._id,
      title: note.title,
      preview: note.content.substring(0, 200) + (note.content.length > 200 ? '...' : ''),
      lastModified: note.lastModified
    }));
    
    res.json(notesWithPreview);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Get single note with full content
app.get('/api/notes/:id', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// Upload new note
app.post('/api/notes', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const content = req.file.buffer.toString('utf-8');
    const title = req.file.originalname.replace('.txt', '');

    const note = new Note({
      title: title,
      content: content,
      lastModified: new Date()
    });

    await note.save();
    res.status(201).json({ 
      message: 'Note created successfully',
      note: {
        _id: note._id,
        title: note.title,
        preview: note.content.substring(0, 200),
        lastModified: note.lastModified
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// Delete note
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const note = await Note.findByIdAndDelete(req.params.id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});