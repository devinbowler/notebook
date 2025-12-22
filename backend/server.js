const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

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
