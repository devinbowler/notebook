const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Token Schema for persistent storage
const tokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // Auto-delete after 24 hours (TTL index)
  }
});

let Token; // Will be initialized after mongoose connects

// Generate a random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Async function to check if token is valid
async function isValidToken(token) {
  if (!Token) return false;
  try {
    const found = await Token.findOne({ token });
    return !!found;
  } catch (err) {
    console.error('Token validation error:', err);
    return false;
  }
}

// Async function to add token
async function addToken(token) {
  if (!Token) return false;
  try {
    await Token.create({ token });
    return true;
  } catch (err) {
    console.error('Token creation error:', err);
    return false;
  }
}

// Async function to remove token
async function removeToken(token) {
  if (!Token) return;
  try {
    await Token.deleteOne({ token });
  } catch (err) {
    console.error('Token removal error:', err);
  }
}

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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
  
  const valid = await isValidToken(token);
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized - Invalid or expired token' });
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
  .then(() => {
    console.log('Connected to MongoDB');
    // Initialize Token model after connection
    Token = mongoose.model('Token', tokenSchema);
  })
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

// Helper function to ensure all folders in a path exist
async function ensureFoldersExist(path) {
  if (!path || path === '/') return;
  
  const normalizedPath = normalizePath(path);
  const parts = normalizedPath.split('/').filter(p => p); // Remove empty strings
  
  let currentPath = '';
  let parentPath = '/';
  
  for (const part of parts) {
    currentPath = currentPath + '/' + part;
    
    // Check if folder exists
    const existingFolder = await Folder.findOne({ path: currentPath });
    
    if (!existingFolder) {
      // Create the folder
      const folder = new Folder({
        name: part,
        path: currentPath,
        parentPath: parentPath
      });
      
      try {
        await folder.save();
        console.log(`Auto-created folder: ${currentPath}`);
      } catch (err) {
        // Ignore duplicate key errors (folder might have been created by another request)
        if (err.code !== 11000) {
          console.error(`Error creating folder ${currentPath}:`, err);
        }
      }
    }
    
    parentPath = currentPath;
  }
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
    // Find all notes that are in subfolders of currentPath
    let folderQuery;
    if (currentPath === '/') {
      // Find notes with paths like "/something" or "/something/deeper"
      folderQuery = { 
        path: { $regex: '^/[^/]+', $ne: '/' },
        $and: [
          { path: { $exists: true } },
          { path: { $ne: null } },
          { path: { $ne: '' } }
        ]
      };
    } else {
      // Find notes with paths that start with currentPath + "/"
      folderQuery = { path: { $regex: `^${currentPath}/[^/]+` } };
    }
    
    const notesInSubfolders = await Note.find(folderQuery).select('path');
    
    // Extract unique immediate child folder names
    const folderSet = new Set();
    for (const note of notesInSubfolders) {
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
    
    // Also check for folders from the Folder collection (if any exist)
    const dbFolders = await Folder.find({ parentPath: currentPath }).select('name');
    for (const folder of dbFolders) {
      folderSet.add(folder.name);
    }
    
    // Build folder objects with counts
    const folders = [];
    for (const folderName of folderSet) {
      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Count notes in this folder and subfolders
      const noteCount = await Note.countDocuments({ 
        path: { $regex: `^${folderPath}($|/)` } 
      });
      
      // Count immediate subfolders by looking at note paths
      const subfolderNotes = await Note.find({ 
        path: { $regex: `^${folderPath}/[^/]+` } 
      }).select('path');
      
      const subfolderSet = new Set();
      for (const note of subfolderNotes) {
        const rel = note.path.substring(folderPath.length + 1);
        const seg = rel.split('/')[0];
        if (seg) subfolderSet.add(seg);
      }
      
      folders.push({
        _id: folderName, // Use name as ID since we're deriving folders
        name: folderName,
        path: folderPath,
        parentPath: currentPath,
        noteCount,
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

    // Auto-create any missing folders in the path
    await ensureFoldersExist(path);

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

    // Auto-create any missing folders in the path
    await ensureFoldersExist(path);

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

// Sync folders - creates missing folders for all existing notes
app.post('/api/sync-folders', async (req, res) => {
  try {
    // Get all unique paths from notes
    const notes = await Note.find({ path: { $exists: true, $ne: '/', $ne: null, $ne: '' } });
    const paths = [...new Set(notes.map(n => n.path))];
    
    let created = 0;
    for (const path of paths) {
      const normalizedPath = normalizePath(path);
      if (normalizedPath !== '/') {
        const parts = normalizedPath.split('/').filter(p => p);
        let currentPath = '';
        let parentPath = '/';
        
        for (const part of parts) {
          currentPath = currentPath + '/' + part;
          
          const existingFolder = await Folder.findOne({ path: currentPath });
          if (!existingFolder) {
            const folder = new Folder({
              name: part,
              path: currentPath,
              parentPath: parentPath
            });
            try {
              await folder.save();
              created++;
              console.log(`Created missing folder: ${currentPath}`);
            } catch (err) {
              if (err.code !== 11000) {
                console.error(`Error creating folder ${currentPath}:`, err);
              }
            }
          }
          parentPath = currentPath;
        }
      }
    }
    
    res.json({ message: `Sync complete. Created ${created} folders.`, created });
  } catch (error) {
    console.error('Sync folders error:', error);
    res.status(500).json({ error: 'Failed to sync folders' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
