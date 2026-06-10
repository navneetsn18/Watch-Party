'use client';

import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket || socket.disconnected) {
    // If there's a dead socket, clean it up
    if (socket) {
      socket.removeAllListeners();
      socket = null;
    }
    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
