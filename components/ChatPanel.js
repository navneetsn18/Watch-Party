'use client';

import { useState, useRef, useEffect } from 'react';
import { Smile, Send, Zap, ShieldCheck } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';

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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950">
      {/* Scrollable messages area */}
      <div 
        ref={messagesRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 scrollbar"
      >
        {messages.length === 0 && (
          <div className="text-center my-auto py-8 text-zinc-600 text-xs select-none">
            No messages yet. Send a message to start chatting!
          </div>
        )}
        
        {messages.map((msg, i) => {
          if (msg.isSystem) {
            const cleanMessage = msg.message && typeof msg.message === 'string'
              ? msg.message.replace(/ \[VERIFIED\]/g, '')
              : msg.message;
            return (
              <div 
                key={i} 
                className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-center py-1 select-none leading-relaxed"
              >
                {cleanMessage}
              </div>
            );
          }
          const senderStr = typeof msg.sender === 'string' ? msg.sender : '';
          const hasVerified = senderStr.includes(' [VERIFIED]');
          const cleanSender = hasVerified ? senderStr.replace(' [VERIFIED]', '') : senderStr;
          const isSelf = msg.sender === username;

          return (
            <div 
              key={i} 
              className={`flex flex-col gap-1 w-full max-w-[85%] ${
                isSelf ? 'self-end items-end' : 'self-start items-start'
              }`}
            >
              {/* Sender Name */}
              {!isSelf && (
                <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1 ml-1">
                  {cleanSender}
                  {hasVerified && <VerifiedBadge size={10} />}
                </span>
              )}
              
              {/* Message Bubble */}
              <div 
                className={`px-3.5 py-2 text-xs leading-relaxed ${
                  isSelf 
                    ? 'bg-violet-600 text-white rounded-2xl rounded-tr-none shadow shadow-violet-950/20' 
                    : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-2xl rounded-tl-none shadow shadow-black/20'
                }`}
              >
                {msg.message}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input panel & reaction bar footer */}
      <div className="p-3 bg-zinc-950 border-t border-zinc-900 flex flex-col gap-2 flex-shrink-0 relative">
        {/* Floating Emoji Selector */}
        <div ref={emojiWrapRef} className="relative">
          {/* Quick reactions bar */}
          <div className="flex items-center justify-between gap-1 select-none">
            <div className="flex items-center gap-1">
              {QUICK_REACTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => onSendReaction(em)}
                  className="w-7 h-7 text-sm rounded-lg hover:bg-zinc-900 flex items-center justify-center transition-colors cursor-pointer active:scale-90"
                >
                  {em}
                </button>
              ))}
            </div>

            {/* Custom Emoji grid trigger */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEmojiOpen(!emojiOpen);
              }}
              className="w-7 h-7 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-all"
              title="Emoji Picker"
            >
              <Smile className="w-4 h-4" />
            </button>
          </div>

          {/* Emoji panel body */}
          {emojiOpen && (
            <div className="absolute bottom-full right-0 mb-3 w-72 p-3 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl z-50 flex flex-col gap-3">
              {/* Toggles */}
              <div className="grid grid-cols-2 p-0.5 bg-zinc-900 rounded-lg border border-zinc-800">
                <button
                  onClick={() => setEmojiMode('insert')}
                  className={`py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                    emojiMode === 'insert' ? 'bg-zinc-800 text-white' : 'text-zinc-500'
                  }`}
                >
                  💬 In Chat
                </button>
                <button
                  onClick={() => setEmojiMode('react')}
                  className={`py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                    emojiMode === 'react' ? 'bg-zinc-800 text-white' : 'text-zinc-500'
                  }`}
                >
                  🎉 Reaction
                </button>
              </div>

              {/* Emoji lists */}
              <div className="max-h-48 overflow-y-auto flex flex-col gap-3 scrollbar pr-1">
                {Object.entries(EMOJI_DATA).map(([category, emojis]) => (
                  <div key={category} className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-black text-zinc-500 tracking-wider ml-1 select-none">
                      {category}
                    </span>
                    <div className="grid grid-cols-8 gap-1">
                      {emojis.map((em) => (
                        <span
                          key={em}
                          onClick={() => handleEmojiClick(em)}
                          className="text-lg hover:bg-zinc-900 rounded-lg flex items-center justify-center p-1 cursor-pointer transition-colors active:scale-90"
                        >
                          {em}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chat Text Input field */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={500}
            value={inputValue}
            onKeyDown={handleKeyDown}
            onChange={(e) => {
              setInputValue(e.target.value);
              autoResize(e.target);
            }}
            placeholder="Say something..."
            className="flex-1 px-3 py-2.5 bg-zinc-950 border border-zinc-900 focus:outline-none focus:border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 rounded-xl resize-none max-h-20 scrollbar transition-colors"
          />
          <button 
            onClick={sendChat}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shadow-lg shadow-violet-900/10 active:scale-95 transition-all cursor-pointer flex-shrink-0"
            title="Send Message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
