import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface Session {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: number;
}

interface SessionPickerProps {
  sessions: Session[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}

export function SessionPicker({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
  onClose
}: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter sessions by search query
  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(filteredSessions.length - 1, prev + 1));
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredSessions[selectedIndex]) {
          onSelect(filteredSessions[selectedIndex].id);
          onClose();
        }
        return;
      }
      
      // Number keys 1-9 for quick select
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (filteredSessions[index]) {
          onSelect(filteredSessions[index].id);
          onClose();
        }
        return;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, filteredSessions, onSelect, onClose]);
  
  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  return (
    <div className="session-picker" onClick={(e) => e.stopPropagation()}>
      <div className="session-picker-header">
        <span className="session-picker-title">Select Session</span>
        <button className="session-picker-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      
      {searchQuery && (
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="session-picker-search"
          autoFocus
        />
      )}
      
      <div className="session-picker-list">
        {filteredSessions.length === 0 ? (
          <div className="session-picker-empty">
            <p>No sessions found</p>
            <button className="session-picker-new" onClick={onNewSession}>
              <span className="icon">➕</span>
              New Session
            </button>
          </div>
        ) : (
          filteredSessions.map((session, index) => {
            const realIndex = sessions.indexOf(session);
            return (
              <div
                key={session.id}
                className={`session-picker-item ${realIndex === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(session.id)}
              >
                <div className="session-item-info">
                  <span className="session-item-title">{session.title}</span>
                  <span className="session-item-meta">
                    {session.messageCount} messages • {formatDate(session.lastMessageAt)}
                  </span>
                </div>
                {realIndex === selectedIndex && (
                  <span className="session-item-indicator">▸</span>
                )}
              </div>
            );
          })
        )}
      </div>
      
      <div className="session-picker-footer">
        <span className="session-picker-hint">
          ↑/↓ navigate · Enter select · Esc close · 1-9 quick
        </span>
      </div>
    </div>
  );
}

export default SessionPicker;