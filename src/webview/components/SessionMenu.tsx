import React, { useState, useEffect } from 'react';
import { MessageSquare, Plus, Search, X } from 'lucide-react';
import SessionPicker from './SessionPicker';

interface Session {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: number;
}

interface SessionMenuProps {
  sessions: Session[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onNewSession: () => void;
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession
}: SessionMenuProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  return (
    <>
      <button
        className="session-menu-trigger"
        onClick={() => setShowPicker(true)}
        title="Select session"
      >
        <MessageSquare size={16} />
      </button>
      
      <button
        className="session-menu-new"
        onClick={onNewSession}
        title="New session"
      >
        <Plus size={16} />
      </button>
      
      {showPicker && (
        <div className="session-picker-overlay" onClick={() => setShowPicker(false)}>
          <div className="session-picker-container" onClick={(e) => e.stopPropagation()}>
            <SessionPicker
              sessions={filteredSessions}
              activeSessionId={activeSessionId}
              onSelect={onSelect}
              onNewSession={onNewSession}
              onClose={() => setShowPicker(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default SessionMenu;