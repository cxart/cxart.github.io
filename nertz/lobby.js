import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const configured = firebaseConfig.databaseURL && firebaseConfig.apiKey;
let db = null;

if (configured) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} else {
  document.getElementById("config-banner").classList.remove("hidden");
}

// ── Identity (persisted across sessions) ─────────────────────────────────────

function getPlayerId() {
  let id = localStorage.getItem("nertz_player_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nertz_player_id", id);
  }
  return id;
}

function getPlayerName() {
  return localStorage.getItem("nertz_player_name") || "";
}

function savePlayerName(name) {
  localStorage.setItem("nertz_player_name", name.trim() || "Player");
}

function getCardBack() {
  try {
    const saved = localStorage.getItem("nertz_cardback");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return { pattern: "weave", color1: "#6e1520", color2: "#b03040" };
}

const MY_ID = getPlayerId();

// ── Room code generation ──────────────────────────────────────────────────────

const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

function randomCode() {
  return Array.from({ length: 4 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join("");
}

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  screen: "home",
  roomCode: null,
  isHost: false,
  roomData: null,
  unsubRoom: null,   // call to detach room listener
  unsubRooms: null   // call to detach room-list listener
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const el = {
  screens: {
    home: document.getElementById("screen-home"),
    join: document.getElementById("screen-join"),
    room: document.getElementById("screen-room")
  },
  playerName: document.getElementById("player-name"),
  createBtn: document.getElementById("create-btn"),
  joinBtn: document.getElementById("join-btn"),
  roomList: document.getElementById("room-list"),
  joinCodeInput: document.getElementById("join-code-input"),
  joinCodeBtn: document.getElementById("join-code-btn"),
  joinError: document.getElementById("join-error"),
  joinCancelBtn: document.getElementById("join-cancel-btn"),
  roomCodeValue: document.getElementById("room-code-value"),
  copyCodeBtn: document.getElementById("copy-code-btn"),
  copyHint: document.getElementById("copy-hint"),
  playerSlots: document.getElementById("player-slots"),
  hostSettings: document.getElementById("host-settings"),
  maxPlayersSelect: document.getElementById("max-players-select"),
  botDifficultySelect: document.getElementById("bot-difficulty-select"),
  readyBtn: document.getElementById("ready-btn"),
  startGameBtn: document.getElementById("start-game-btn"),
  leaveRoomBtn: document.getElementById("leave-room-btn")
};

// ── Screen routing ────────────────────────────────────────────────────────────

function setScreen(name) {
  state.screen = name;
  Object.entries(el.screens).forEach(([key, div]) => {
    div.classList.toggle("active", key === name);
  });
}

// ── Room list (home screen) ───────────────────────────────────────────────────

function watchRooms() {
  if (!db) return;
  if (state.unsubRooms) state.unsubRooms();

  const roomsRef = query(ref(db, "nertz_rooms"), orderByChild("status"), equalTo("waiting"));
  const unsub = onValue(roomsRef, snapshot => {
    const rooms = [];
    snapshot.forEach(child => rooms.push(child.val()));
    // Exclude stale rooms (> 2h old)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const fresh = rooms.filter(r => r.createdAt > cutoff);
    renderRoomList(fresh);
  });
  state.unsubRooms = unsub;
}

function renderRoomList(rooms) {
  if (!rooms.length) {
    el.roomList.innerHTML = `<p class="room-list-empty">No open rooms right now — create one!</p>`;
    return;
  }
  el.roomList.innerHTML = rooms.map(room => {
    const players = Object.values(room.players || {});
    const count = players.length;
    const max = room.maxPlayers || 4;
    const hostPlayer = players.find(p => p.id === room.hostId);
    const hostName = hostPlayer ? hostPlayer.name : "Unknown";
    const full = count >= max;
    return `
      <div class="room-item">
        <span class="room-code-badge">${room.code}</span>
        <span class="room-meta">
          ${count}/${max} players
          <span class="room-host"> · hosted by ${escapeHtml(hostName)}</span>
        </span>
        <button
          class="btn-secondary"
          style="padding:6px 12px;font-size:0.8rem"
          ${full ? "disabled" : ""}
          onclick="window._lobbyJoin('${room.code}')"
        >${full ? "Full" : "Join →"}</button>
      </div>`;
  }).join("");
}

// Expose join handler for inline onclick (avoids complex event delegation)
window._lobbyJoin = code => joinRoom(code);

// ── Create room ───────────────────────────────────────────────────────────────

async function createRoom() {
  if (!db) return;
  const name = myName();
  let code = randomCode();

  // Avoid collisions (retry up to 5 times)
  for (let i = 0; i < 5; i++) {
    const snap = await get(ref(db, `nertz_rooms/${code}`));
    if (!snap.exists()) break;
    code = randomCode();
  }

  const maxPlayers = 4;
  const roomData = {
    code,
    hostId: MY_ID,
    status: "waiting",
    maxPlayers,
    difficulty: "medium",
    createdAt: Date.now(),
    players: {
      [MY_ID]: { id: MY_ID, name, ready: false, joinedAt: Date.now(), cardBack: getCardBack() }
    }
  };

  await set(ref(db, `nertz_rooms/${code}`), roomData);

  // Auto-delete my player slot on disconnect
  onDisconnect(ref(db, `nertz_rooms/${code}/players/${MY_ID}`)).remove();
  // If I'm the host and I disconnect, delete the whole room
  onDisconnect(ref(db, `nertz_rooms/${code}`)).remove();

  enterRoom(code, true);
}

// ── Join room ─────────────────────────────────────────────────────────────────

async function joinRoom(code) {
  if (!db) return;
  code = code.toUpperCase().trim();
  const name = myName();

  showJoinError("");

  const snap = await get(ref(db, `nertz_rooms/${code}`));
  if (!snap.exists()) { showJoinError("Room not found."); return; }

  const room = snap.val();
  if (room.status !== "waiting") { showJoinError("That game has already started."); return; }

  const players = Object.values(room.players || {});
  if (players.length >= room.maxPlayers) { showJoinError("Room is full."); return; }

  await update(ref(db, `nertz_rooms/${code}/players/${MY_ID}`), {
    id: MY_ID, name, ready: false, joinedAt: Date.now(), cardBack: getCardBack()
  });

  // Auto-remove on disconnect
  onDisconnect(ref(db, `nertz_rooms/${code}/players/${MY_ID}`)).remove();

  enterRoom(code, false);
}

function showJoinError(msg) {
  el.joinError.textContent = msg;
  el.joinError.classList.toggle("hidden", !msg);
}

// ── Enter waiting room ────────────────────────────────────────────────────────

function enterRoom(code, isHost) {
  state.roomCode = code;
  state.isHost = isHost;

  el.roomCodeValue.textContent = code;
  el.hostSettings.classList.toggle("hidden", !isHost);
  el.startGameBtn.classList.add("hidden");

  if (state.unsubRooms) { state.unsubRooms(); state.unsubRooms = null; }

  setScreen("room");
  watchRoom(code);
}

// ── Watch current room ────────────────────────────────────────────────────────

function watchRoom(code) {
  if (state.unsubRoom) state.unsubRoom();

  const unsub = onValue(ref(db, `nertz_rooms/${code}`), snapshot => {
    if (!snapshot.exists()) {
      // Room was deleted (host left)
      leaveRoom(false);
      return;
    }
    const data = snapshot.val();
    state.roomData = data;
    renderWaitingRoom(data);

    // If host changed status to "starting", navigate everyone into the game
    if (data.status === "starting") {
      navigateToGame(data);
    }
  });

  state.unsubRoom = unsub;
}

// ── Render waiting room ───────────────────────────────────────────────────────

function renderWaitingRoom(data) {
  const players = Object.values(data.players || {});
  const maxPlayers = data.maxPlayers || 4;
  const me = data.players?.[MY_ID];
  const allReady = players.length > 1 && players.every(p => p.ready);

  // Sync host settings dropdowns to room data
  if (state.isHost) {
    el.maxPlayersSelect.value = String(maxPlayers);
    el.botDifficultySelect.value = data.difficulty || "medium";
  }

  // Player slots (filled + empty)
  const slots = [];
  for (let i = 0; i < maxPlayers; i++) {
    const p = players[i];
    if (p) {
      slots.push(`
        <div class="player-slot">
          <span class="slot-dot"></span>
          <span class="slot-name">${escapeHtml(p.name)}${p.id === MY_ID ? " (you)" : ""}</span>
          ${p.id === data.hostId ? `<span class="slot-badge host">Host</span>` : ""}
          ${p.ready ? `<span class="slot-ready-icon">✓</span>` : `<span class="slot-badge">Not ready</span>`}
        </div>`);
    } else {
      slots.push(`
        <div class="player-slot empty">
          <span class="slot-dot"></span>
          <span class="slot-name">Waiting for player…</span>
        </div>`);
    }
  }
  el.playerSlots.innerHTML = slots.join("");

  // Ready button
  const amReady = me?.ready ?? false;
  el.readyBtn.textContent = amReady ? "Not Ready" : "I'm Ready";
  el.readyBtn.className = amReady ? "btn-primary" : "btn-secondary";

  // Start button (host only, all players ready, at least 2 players)
  const canStart = state.isHost && allReady;
  el.startGameBtn.classList.toggle("hidden", !canStart);
}

// ── Ready toggle ──────────────────────────────────────────────────────────────

async function toggleReady() {
  if (!db || !state.roomCode) return;
  const me = state.roomData?.players?.[MY_ID];
  const nowReady = !(me?.ready ?? false);
  await update(ref(db, `nertz_rooms/${state.roomCode}/players/${MY_ID}`), { ready: nowReady });
}

// ── Host: update settings ─────────────────────────────────────────────────────

async function updateRoomSettings() {
  if (!db || !state.roomCode || !state.isHost) return;
  const maxPlayers = Number(el.maxPlayersSelect.value);
  const difficulty = el.botDifficultySelect.value;
  await update(ref(db, `nertz_rooms/${state.roomCode}`), { maxPlayers, difficulty });
}

// ── Start game ────────────────────────────────────────────────────────────────

async function startGame() {
  if (!db || !state.roomCode || !state.isHost) return;
  await update(ref(db, `nertz_rooms/${state.roomCode}`), { status: "starting" });
}

function navigateToGame(roomData) {
  if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
  const players = Object.values(roomData.players || {});
  const params = new URLSearchParams({
    room: roomData.code,
    pid: MY_ID,
    difficulty: roomData.difficulty || "medium",
    playerCount: String(players.length)
  });
  window.location.href = `index.html?${params.toString()}`;
}

// ── Leave room ────────────────────────────────────────────────────────────────

async function leaveRoom(doUpdate = true) {
  if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }

  if (doUpdate && db && state.roomCode) {
    if (state.isHost) {
      // Host leaving kills the room
      await remove(ref(db, `nertz_rooms/${state.roomCode}`));
    } else {
      await remove(ref(db, `nertz_rooms/${state.roomCode}/players/${MY_ID}`));
    }
  }

  state.roomCode = null;
  state.isHost = false;
  state.roomData = null;

  showJoinError("");
  setScreen("home");
  watchRooms();
}

// ── Copy room code ────────────────────────────────────────────────────────────

function copyRoomCode() {
  if (!state.roomCode) return;
  navigator.clipboard.writeText(state.roomCode).then(() => {
    el.copyHint.classList.remove("hidden");
    setTimeout(() => el.copyHint.classList.add("hidden"), 1800);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function myName() {
  const name = el.playerName.value.trim() || "Player";
  savePlayerName(name);
  return name;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  // Restore saved name
  el.playerName.value = getPlayerName();

  // Home screen
  el.createBtn.addEventListener("click", createRoom);
  el.joinBtn.addEventListener("click", () => setScreen("join"));

  el.playerName.addEventListener("change", () => savePlayerName(el.playerName.value));

  // Join-by-code screen
  el.joinCodeBtn.addEventListener("click", () => joinRoom(el.joinCodeInput.value));
  el.joinCodeInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinRoom(el.joinCodeInput.value);
    // Auto-uppercase
    setTimeout(() => { el.joinCodeInput.value = el.joinCodeInput.value.toUpperCase(); }, 0);
  });
  el.joinCancelBtn.addEventListener("click", () => {
    showJoinError("");
    setScreen("home");
  });

  // Waiting room
  el.copyCodeBtn.addEventListener("click", copyRoomCode);
  el.readyBtn.addEventListener("click", toggleReady);
  el.startGameBtn.addEventListener("click", startGame);
  el.leaveRoomBtn.addEventListener("click", () => leaveRoom(true));
  el.maxPlayersSelect.addEventListener("change", updateRoomSettings);
  el.botDifficultySelect.addEventListener("change", updateRoomSettings);

  // Start watching rooms if Firebase is ready
  if (db) watchRooms();
}

init();
