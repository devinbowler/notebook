// Notes App - Main Application Logic

class NotesApp {
  constructor() {
    this.notes = [];
    this.currentNote = null;
    
    // DOM Elements
    this.appView = document.getElementById('app');
    this.noteView = document.getElementById('note-view');
    this.notesGrid = document.getElementById('notes-grid');
    this.emptyState = document.getElementById('empty-state');
    this.loadingState = document.getElementById('loading-state');
    this.addBtn = document.getElementById('add-btn');
    this.fileInput = document.getElementById('file-input');
    this.backBtn = document.getElementById('back-btn');
    this.deleteBtn = document.getElementById('delete-btn');
    this.noteTitle = document.getElementById('note-title');
    this.noteDate = document.getElementById('note-date');
    this.noteText = document.getElementById('note-text');
    this.uploadModal = document.getElementById('upload-modal');
    this.progressFill = document.getElementById('progress-fill');
    this.uploadStatus = document.getElementById('upload-status');
    this.toastContainer = document.getElementById('toast-container');

    this.init();
  }

  init() {
    this.bindEvents();
    this.fetchNotes();
  }

  bindEvents() {
    // Add button click
    this.addBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File selection
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.uploadFile(e.target.files[0]);
      }
    });

    // Back button
    this.backBtn.addEventListener('click', () => {
      this.hideNoteView();
    });

    // Delete button
    this.deleteBtn.addEventListener('click', () => {
      if (this.currentNote) {
        this.deleteNote(this.currentNote._id);
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.noteView.classList.contains('hidden')) {
        this.hideNoteView();
      }
    });
  }

  async fetchNotes() {
    this.showLoading();
    
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/notes`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch notes');
      }

      this.notes = await response.json();
      this.renderNotes();
    } catch (error) {
      console.error('Error fetching notes:', error);
      this.showToast('Failed to load notes. Please check your connection.', 'error');
      this.hideLoading();
      this.showEmptyState();
    }
  }

  renderNotes() {
    this.hideLoading();
    this.notesGrid.innerHTML = '';

    if (this.notes.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    this.notes.forEach((note, index) => {
      const card = this.createNoteCard(note, index);
      this.notesGrid.appendChild(card);
    });
  }

  createNoteCard(note, index) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.style.animationDelay = `${index * 0.05}s`;

    const formattedDate = this.formatDate(note.lastModified);
    const wordCount = note.preview.split(/\s+/).filter(w => w).length;

    card.innerHTML = `
      <div class="note-card-header">
        <h3 class="note-card-title">${this.escapeHtml(note.title)}</h3>
        <p class="note-card-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          ${formattedDate}
        </p>
      </div>
      <div class="note-card-preview">
        <p>${this.escapeHtml(note.preview)}</p>
      </div>
      <div class="note-card-footer">
        <span class="read-more">
          Read more
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
          </svg>
        </span>
        <span class="word-count">~${wordCount}+ words</span>
      </div>
    `;

    card.addEventListener('click', () => {
      this.openNote(note._id);
    });

    return card;
  }

  async openNote(noteId) {
    try {
      const response = await fetch(`${CONFIG.API_URL}/api/notes/${noteId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch note');
      }

      this.currentNote = await response.json();
      this.showNoteView();
    } catch (error) {
      console.error('Error fetching note:', error);
      this.showToast('Failed to load note', 'error');
    }
  }

  showNoteView() {
    if (!this.currentNote) return;

    this.noteTitle.textContent = this.currentNote.title;
    this.noteDate.textContent = `Last modified: ${this.formatDate(this.currentNote.lastModified)}`;
    this.noteText.textContent = this.currentNote.content;

    this.appView.classList.add('hidden');
    this.noteView.classList.remove('hidden');
    
    // Scroll to top
    document.querySelector('.note-content').scrollTop = 0;
  }

  hideNoteView() {
    this.noteView.classList.add('hidden');
    this.appView.classList.remove('hidden');
    this.currentNote = null;
  }

  async uploadFile(file) {
    this.showUploadModal();
    this.updateProgress(10, 'Reading file...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      this.updateProgress(30, 'Uploading to server...');

      const response = await fetch(`${CONFIG.API_URL}/api/notes`, {
        method: 'POST',
        body: formData
      });

      this.updateProgress(70, 'Saving to database...');

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      
      this.updateProgress(100, 'Complete!');

      // Add new note to the beginning of the list
      this.notes.unshift(result.note);
      
      setTimeout(() => {
        this.hideUploadModal();
        this.renderNotes();
        this.showToast('Note uploaded successfully!', 'success');
      }, 500);

    } catch (error) {
      console.error('Upload error:', error);
      this.hideUploadModal();
      this.showToast(error.message || 'Failed to upload note', 'error');
    }

    // Reset file input
    this.fileInput.value = '';
  }

  async deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }

    try {
      const response = await fetch(`${CONFIG.API_URL}/api/notes/${noteId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete note');
      }

      // Remove from local array
      this.notes = this.notes.filter(n => n._id !== noteId);
      
      this.hideNoteView();
      this.renderNotes();
      this.showToast('Note deleted successfully', 'success');

    } catch (error) {
      console.error('Delete error:', error);
      this.showToast('Failed to delete note', 'error');
    }
  }

  // UI State Methods
  showLoading() {
    this.loadingState.classList.remove('hidden');
    this.notesGrid.classList.add('hidden');
    this.emptyState.classList.add('hidden');
  }

  hideLoading() {
    this.loadingState.classList.add('hidden');
    this.notesGrid.classList.remove('hidden');
  }

  showEmptyState() {
    this.emptyState.classList.remove('hidden');
    this.notesGrid.classList.add('hidden');
  }

  hideEmptyState() {
    this.emptyState.classList.add('hidden');
    this.notesGrid.classList.remove('hidden');
  }

  showUploadModal() {
    this.uploadModal.classList.remove('hidden');
    this.progressFill.style.width = '0%';
  }

  hideUploadModal() {
    this.uploadModal.classList.add('hidden');
  }

  updateProgress(percent, status) {
    this.progressFill.style.width = `${percent}%`;
    this.uploadStatus.textContent = status;
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      ${type === 'success' ? `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      ` : type === 'error' ? `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
      ` : ''}
      ${message}
    `;

    this.toastContainer.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 4000);
  }

  // Utility Methods
  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NotesApp();
});
