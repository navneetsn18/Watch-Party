// SQLite storage — the whole database is one file in ./data.
// Delete the file to factory-reset the app.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'watchparty.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatarUrl TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'IN',
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
  filename TEXT PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  displayName TEXT NOT NULL,
  uploaderId TEXT NOT NULL,
  uploaderName TEXT NOT NULL,
  isPrivate INTEGER NOT NULL DEFAULT 0,
  thumbnailUrl TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subtitles (
  id TEXT PRIMARY KEY,
  videoId TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

const stmt = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (id, username, avatarUrl, country, createdAt) VALUES (@id, @username, @avatarUrl, @country, @createdAt)'),
  updateUser: db.prepare('UPDATE users SET username = @username, avatarUrl = @avatarUrl, country = @country WHERE id = @id'),
  videoByFilename: db.prepare('SELECT * FROM videos WHERE filename = ?'),
  videoById: db.prepare('SELECT * FROM videos WHERE id = ?'),
  listVideos: db.prepare('SELECT * FROM videos ORDER BY createdAt DESC'),
  insertVideo: db.prepare('INSERT INTO videos (filename, id, displayName, uploaderId, uploaderName, isPrivate, thumbnailUrl, createdAt) VALUES (@filename, @id, @displayName, @uploaderId, @uploaderName, @isPrivate, @thumbnailUrl, @createdAt)'),
  deleteVideo: db.prepare('DELETE FROM videos WHERE filename = ?'),
  setVideoPrivacy: db.prepare('UPDATE videos SET isPrivate = ? WHERE id = ?'),
  subtitlesForVideo: db.prepare('SELECT * FROM subtitles WHERE videoId = ? ORDER BY createdAt ASC'),
  subtitleById: db.prepare('SELECT * FROM subtitles WHERE id = ?'),
  insertSubtitle: db.prepare('INSERT INTO subtitles (id, videoId, language, label, filename, createdAt) VALUES (@id, @videoId, @language, @label, @filename, @createdAt)'),
  deleteSubtitle: db.prepare('DELETE FROM subtitles WHERE id = ?'),
};

module.exports = {
  getUserByUsername: (username) => stmt.userByUsername.get(username),
  getUserById: (id) => stmt.userById.get(id),
  createUser: (user) => stmt.createUser.run(user),
  updateUser: (user) => stmt.updateUser.run(user),
  getVideo: (filename) => stmt.videoByFilename.get(filename),
  getVideoById: (id) => stmt.videoById.get(id),
  listVideos: () => stmt.listVideos.all(),
  insertVideo: (video) => stmt.insertVideo.run(video),
  deleteVideo: (filename) => stmt.deleteVideo.run(filename),
  setVideoPrivacy: (id, isPrivate) => stmt.setVideoPrivacy.run(isPrivate ? 1 : 0, id),
  getSubtitlesForVideo: (videoId) => stmt.subtitlesForVideo.all(videoId),
  getSubtitleById: (id) => stmt.subtitleById.get(id),
  insertSubtitle: (sub) => stmt.insertSubtitle.run(sub),
  deleteSubtitle: (id) => stmt.deleteSubtitle.run(id),
};
