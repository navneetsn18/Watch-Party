'use client';

import { useCallback, useRef } from 'react';

export default function EmojiReactions({ canvasRef }) {
  return <div className="reaction-canvas" ref={canvasRef} />;
}

export function useEmojiSpawner(canvasRef) {
  const spawn = useCallback((emoji) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const el = document.createElement('div');
    el.className = 'flying-emoji';
    el.textContent = emoji;
    el.style.left = (5 + Math.random() * 82) + '%';
    el.style.setProperty('--spin', (Math.random() * 60 - 30) + 'deg');
    el.style.setProperty('--fly-duration', (3.5 + Math.random() * 1.5) + 's'); // slow float, not a launch
    canvas.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }, [canvasRef]);

  return spawn;
}
