'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const EMOJI_DATA = {
  smileys: ['😀','😂','🥲','😍','🤩','😎','🥳','😭','😱','🤔','😏','🤯','😴','🥺','😈','💀','👻','🤡','💩','🎭'],
  gestures: ['👍','👎','👏','🙌','🤝','🙏','💪','🫶','❤️','🔥','⭐','✨','💯','🎉','🥂','🍿','👀','💬','📌','🎬'],
  objects: ['🍕','🎮','🎵','🎥','📺','🕹️','🍺','🍷','🍑','🍒','⚡','💎','🚀','🌈','🌙','☀️','💫','🎭','🏆','🎁'],
};

const QUICK_REACTIONS = ['❤️', '😂', '😱', '🔥', '👏', '💀', '🍿', '🥳'];

export default function ChatPanel({
  messages,
  onSendMessage,
  onSendReaction,
  username,
}) {
  const [inputValue, setInputValue] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiMode, setEmojiMode] = useState('insert'); // 'insert' or 'react'
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const emojiWrapRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handleClick(e) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  function sendChat() {
    const msg = inputValue.trim();
    if (!msg) return;
    onSendMessage(msg);
    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  function insertEmoji(em) {
    const inp = inputRef.current;
    if (!inp) return;
    const pos = inp.selectionStart || inputValue.length;
    const newVal = inputValue.slice(0, pos) + em + inputValue.slice(inp.selectionEnd || pos);
    setInputValue(newVal);
    setTimeout(() => {
      inp.selectionStart = inp.selectionEnd = pos + em.length;
      inp.focus();
    }, 0);
  }

  function handleEmojiClick(em) {
    if (emojiMode === 'react') {
      onSendReaction(em);
    } else {
      insertEmoji(em);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return (
    <>
      {/* Messages */}
      <div className="chat-messages" ref={messagesRef}>
        {messages.map((msg, i) => {
          if (msg.isSystem) {
            return (
              <div key={i} className="chat-msg system">
                {msg.message}
              </div>
            );
          }
          const isSelf = msg.sender === username;
          return (
            <div key={i} className={`chat-msg ${isSelf ? 'self' : 'other'}`}>
              <span className="chat-sender">{msg.sender}</span>
              {msg.message}
            </div>
          );
        })}
      </div>

      {/* Chat footer */}
      <div className="chat-footer">
        {/* Quick reactions */}
        <div className="reaction-bar">
          {QUICK_REACTIONS.map((em) => (
            <span
              key={em}
              className="reaction-btn"
              onClick={() => onSendReaction(em)}
            >
              {em}
            </span>
          ))}

          <div className="emoji-picker-wrap" ref={emojiWrapRef}>
            <button
              className="emoji-toggle-btn"
              onClick={(e) => {
                e.stopPropagation();
                setEmojiOpen(!emojiOpen);
              }}
            >
              😊 ＋
            </button>
            <div className={`emoji-panel ${emojiOpen ? 'open' : ''}`}>
              {/* Mode tabs */}
              <div className="emoji-mode-tabs">
                <button
                  className={`emoji-mode-tab ${emojiMode === 'insert' ? 'active' : ''}`}
                  onClick={() => setEmojiMode('insert')}
                >
                  💬 Insert in Chat
                </button>
                <button
                  className={`emoji-mode-tab ${emojiMode === 'react' ? 'active' : ''}`}
                  onClick={() => setEmojiMode('react')}
                >
                  🎉 Send as Reaction
                </button>
              </div>
              {Object.entries(EMOJI_DATA).map(([category, emojis]) => (
                <div key={category}>
                  <div className="emoji-cat-label">{category}</div>
                  <div className="emoji-grid">
                    {emojis.map((em) => (
                      <span
                        key={em}
                        className="emoji-item"
                        onClick={() => handleEmojiClick(em)}
                      >
                        {em}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Input row */}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-textarea"
            placeholder="Say something…"
            maxLength={500}
            rows={1}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
          />
          <button className="chat-send-btn" onClick={sendChat}>
            ➤
          </button>
        </div>
      </div>
    </>
  );
}
