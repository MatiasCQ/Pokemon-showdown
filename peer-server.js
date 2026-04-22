const express = require("express");
const { ExpressPeerServer } = require("peer");
const http = require("http");

const PORT = Number(process.env.PORT || 9000);
const PEER_PATH = process.env.PEER_PATH || "/showlite";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 45000);

const app = express();
const server = http.createServer(app);
const presence = new Map();
const peerToNickname = new Map();
const queuedByFormat = new Map();
const sessionsByNickname = new Map();

app.use(express.json());

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  return ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
}

function now() {
  return Date.now();
}

function cleanupStalePresence() {
  const threshold = now() - PRESENCE_TTL_MS;
  for (const [nickname, entry] of presence.entries()) {
    if (entry.updatedAt < threshold) {
      presence.delete(nickname);
      peerToNickname.delete(entry.peerId);
      dropFromQueues(nickname);
      clearSessionForNickname(nickname);
    }
  }
}

function dropFromQueues(nickname) {
  for (const queue of queuedByFormat.values()) {
    const index = queue.findIndex((entry) => entry.nickname === nickname);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }
}

function getQueue(format) {
  if (!queuedByFormat.has(format)) {
    queuedByFormat.set(format, []);
  }
  return queuedByFormat.get(format);
}

function matchmake(entry) {
  const queue = getQueue(entry.format);
  const opponentIndex = queue.findIndex(
    (candidate) => candidate.nickname !== entry.nickname
  );
  if (opponentIndex === -1) {
    queue.push(entry);
    return null;
  }
  const opponent = queue.splice(opponentIndex, 1)[0];
  const session = {
    sessionId: `session-${Math.random().toString(36).slice(2, 10)}`,
    format: entry.format,
    createdAt: new Date().toISOString(),
    host: opponent,
    guest: entry,
  };
  sessionsByNickname.set(opponent.nickname, session);
  sessionsByNickname.set(entry.nickname, session);
  return session;
}

function clearSessionForNickname(nickname) {
  const session = sessionsByNickname.get(nickname);
  if (!session) {
    return;
  }
  sessionsByNickname.delete(session.host.nickname);
  sessionsByNickname.delete(session.guest.nickname);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
