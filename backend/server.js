const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Token Schema - stores auth tokens persistently
const tokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 30 * 24 * 60 * 60 // Auto-delete after 30 days (TTL index)
  }
});

const Token = mongoose.model('Token', tokenSchema);

// Auth middleware - protects all /api routes except /api/login and /api/logout
async function authMiddleware(req, res, next) {
  // Skip auth for login and logout endpoints
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const validToken = await Token.findOne({ token: token });
    if (!validToken) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized - Token validation failed' });
  }
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
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD;
  
  if (!correctPassword) {
    console.error('APP_PASSWORD environment variable not set!');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (password === correctPassword) {
    const token = generateToken();
    
    try {
      // Save token to database
      await Token.create({ token: token });
      res.json({ success: true, token });
    } catch (error) {
      console.error('Token save error:', error);
      res.status(500).json({ error: 'Failed to create session' });
    }
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      await Token.deleteOne({ token: token });
    } catch (error) {
      // Ignore errors on logout
    }
  }
  res.json({ success: true });
});

// Get all notes (with folders derived from paths)
app.get('/api/notes', async (req, res) => {
  try {
    const currentPath = normalizePath(req.query.path);
    
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
      path: note.path || '/'
    }));
    
    // Derive folders from all notes' paths
    // Get all notes that have a path starting with currentPath
    let allNotesWithPaths;
    if (currentPath === '/') {
      allNotesWithPaths = await Note.find({
        path: { $exists: true, $ne: null, $ne: '', $ne: '/' }
      }).select('path');
    } else {
      allNotesWithPaths = await Note.find({
        path: { $regex: `^${currentPath}/` }
      }).select('path');
    }
    
    // Extract unique immediate child folder names
    const folderSet = new Set();
    for (const note of allNotesWithPaths) {
      if (note.path) {
        let relativePath;
        if (currentPath === '/') {
          relativePath = note.path.substring(1); // Remove leading /
        } else {
          relativePath = note.path.substring(currentPath.length + 1); // Remove currentPath/
        }
        
        // Get the first segment (immediate child folder)
        const firstSegment = relativePath.split('/')[0];
        if (firstSegment) {
          folderSet.add(firstSegment);
        }
      }
    }
    
    // Build folder objects with counts
    const folders = [];
    for (const folderName of folderSet) {
      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Count notes in this folder (exact match)
      const notesInFolder = await Note.countDocuments({ path: folderPath });
      
      // Count notes in subfolders
      const notesInSubfolders = await Note.countDocuments({ 
        path: { $regex: `^${folderPath}/` } 
      });
      
      // Count immediate subfolders
      const subfolderNotes = await Note.find({ 
        path: { $regex: `^${folderPath}/` } 
      }).select('path');
      
      const subfolderSet = new Set();
      for (const note of subfolderNotes) {
        const rel = note.path.substring(folderPath.length + 1);
        const seg = rel.split('/')[0];
        if (seg) subfolderSet.add(seg);
      }
      
      folders.push({
        _id: folderName,
        name: folderName,
        path: folderPath,
        parentPath: currentPath,
        noteCount: notesInFolder + notesInSubfolders,
        folderCount: subfolderSet.size
      });
    }
    
    // Sort folders alphabetically
    folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    
    res.json({
      currentPath,
      folders,
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

// Delete note by title and path (must be before :id route)
app.delete('/api/notes/by-title', async (req, res) => {
  try {
    const title = req.query.title;
    const path = normalizePath(req.query.path);
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const note = await Note.findOneAndDelete({ title: title, path: path });
    if (!note) {
      // Also try without path for legacy notes
      const legacyNote = await Note.findOneAndDelete({ title: title });
      if (!legacyNote) {
        return res.status(404).json({ error: 'Note not found' });
      }
    }
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Delete note by ID
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

// Delete folder and all its contents
app.delete('/api/folders', async (req, res) => {
  try {
    const folderPath = normalizePath(req.query.path);
    
    if (folderPath === '/') {
      return res.status(400).json({ error: 'Cannot delete root folder' });
    }
    
    // Delete all notes in this folder and subfolders
    const result = await Note.deleteMany({
      $or: [
        { path: folderPath },
        { path: { $regex: `^${folderPath}/` } }
      ]
    });
    
    res.json({ 
      message: 'Folder deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
