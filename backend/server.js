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
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Auth middleware - protects all /api routes except /api/login and /api/logout
function authMiddleware(req, res, next) {
  // Skip auth for login and logout endpoints
  if (req.path === '/login' || req.path === '/logout') {
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

// Folder Schema
const folderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  path: {
    type: String,
    required: true,
    unique: true
  },
  parentPath: {
    type: String,
    default: '/'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Folder = mongoose.model('Folder', folderSchema);

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
  path: {
    type: String,
    default: '/'
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
});

const Note = mongoose.model('Note', noteSchema);

// Helper function to normalize paths
function normalizePath(path) {
  if (!path || path === '') return '/';
  // Ensure path starts with /
  if (!path.startsWith('/')) path = '/' + path;
  // Remove trailing slash (except for root)
  if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Notes API is running' });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD;
  
  if (!correctPassword) {
    console.error('APP_PASSWORD environment variable not set!');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (password === correctPassword) {
    const token = generateToken();
    validTokens.add(token);
    
    // Optional: Clean up old tokens after 24 hours
    setTimeout(() => {
      validTokens.delete(token);
    }, 24 * 60 * 60 * 1000);
    
    res.json({ success: true, token });
  } else {
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

// Get all folders
app.get('/api/folders', async (req, res) => {
  try {
    const parentPath = normalizePath(req.query.path);
    const folders = await Folder.find({ parentPath }).sort({ name: 1 });
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// Create folder
app.post('/api/folders', async (req, res) => {
  try {
    const { name, parentPath = '/' } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const normalizedParent = normalizePath(parentPath);
    const folderPath = normalizedParent === '/' ? `/${name}` : `${normalizedParent}/${name}`;
    
    // Check if folder already exists
    const existingFolder = await Folder.findOne({ path: folderPath });
    if (existingFolder) {
      return res.status(400).json({ error: 'Folder already exists' });
    }
    
    const folder = new Folder({
      name,
      path: folderPath,
      parentPath: normalizedParent
    });
    
    await folder.save();
    res.status(201).json(folder);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Delete folder
app.delete('/api/folders/:id', async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Delete all notes in this folder and subfolders
    await Note.deleteMany({ path: { $regex: `^${folder.path}` } });
    
    // Delete all subfolders
    await Folder.deleteMany({ path: { $regex: `^${folder.path}` } });
    
    // Delete the folder itself
    await Folder.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Folder deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Get all notes (with folder support)
app.get('/api/notes', async (req, res) => {
  try {
    const currentPath = normalizePath(req.query.path);
    
    // Get folders in current path
    const folders = await Folder.find({ parentPath: currentPath }).sort({ name: 1 });
    
    // Get notes in current path
    // For root path, also include notes that don't have a path field (legacy notes)
    let noteQuery;
    if (currentPath === '/') {
      noteQuery = { $or: [{ path: '/' }, { path: { $exists: false } }, { path: null }, { path: '' }] };
    } else {
      noteQuery = { path: currentPath };
    }
    
    const notes = await Note.find(noteQuery)
      .select('title content lastModified path')
      .sort({ lastModified: -1 });
    
    // Create preview of content (first 200 chars)
    const notesWithPreview = notes.map(note => ({
      _id: note._id,
      title: note.title,
      preview: note.content.substring(0, 200) + (note.content.length > 200 ? '...' : ''),
      lastModified: note.lastModified,
      path: note.path
    }));
    
    // For each folder, count items inside
    const foldersWithCounts = await Promise.all(folders.map(async (folder) => {
      const noteCount = await Note.countDocuments({ path: { $regex: `^${folder.path}($|/)` } });
      const folderCount = await Folder.countDocuments({ parentPath: folder.path });
      
      return {
        _id: folder._id,
        name: folder.name,
        path: folder.path,
        parentPath: folder.parentPath,
        noteCount,
        folderCount
      };
    }));
    
    res.json({
      currentPath,
      folders: foldersWithCounts,
      notes: notesWithPreview
    });
  } catch (error) {
    console.error('Fetch notes error:', error);
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
    const path = normalizePath(req.body.path);

    const note = new Note({
      title: title,
      content: content,
      path: path,
      lastModified: new Date()
    });

    await note.save();
    res.status(201).json({ 
      message: 'Note created successfully',
      note: {
        _id: note._id,
        title: note.title,
        preview: note.content.substring(0, 200),
        lastModified: note.lastModified,
        path: note.path
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// Update existing note by title (or create if not exists)
app.patch('/api/notes', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const content = req.file.buffer.toString('utf-8');
    const title = req.file.originalname.replace('.txt', '');
    const path = normalizePath(req.body.path);

    // Try to find existing note by title and path
    let note = await Note.findOne({ title: title, path: path });

    if (note) {
      // Update existing
      note.content = content;
      note.lastModified = new Date();
      await note.save();
      res.json({ 
        message: 'Note updated successfully',
        note: {
          _id: note._id,
          title: note.title,
          preview: note.content.substring(0, 200),
          lastModified: note.lastModified,
          path: note.path
        }
      });
    } else {
      // Create new
      note = new Note({
        title: title,
        content: content,
        path: path,
        lastModified: new Date()
      });
      await note.save();
      res.status(201).json({ 
        message: 'Note created successfully',
        note: {
          _id: note._id,
          title: note.title,
          preview: note.content.substring(0, 200),
          lastModified: note.lastModified,
          path: note.path
        }
      });
    }
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// Move note to different folder
app.patch('/api/notes/:id/move', async (req, res) => {
  try {
    const { newPath } = req.body;
    const normalizedPath = normalizePath(newPath);
    
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      { path: normalizedPath, lastModified: new Date() },
      { new: true }
    );
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    res.json({ 
      message: 'Note moved successfully',
      note: {
        _id: note._id,
        title: note.title,
        path: note.path
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to move note' });
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
