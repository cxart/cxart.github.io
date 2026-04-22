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
const MIN_ROOM_PLAYERS = 2;
const MAX_ROOM_PLAYERS = 4;
const MP_DEBUG_PREFIX = "[NERTZ-MP-DEBUG][lobby]";

function randomCode() {
  return Array.from({ length: 4 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join("");
}

function clampRoomSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MAX_ROOM_PLAYERS;
  return Math.max(MIN_ROOM_PLAYERS, Math.min(MAX_ROOM_PLAYERS, Math.floor(n)));
}

function logLobby(event, details) {
  if (details === undefined) {
    console.log(`${MP_DEBUG_PREFIX} ${event}`);
    return;
  }
  console.log(`${MP_DEBUG_PREFIX} ${event}`, details);
}

function summarizeRoom(room) {
  const source = room || {};
  const seatedPlayers = normalizeRoomPlayers(source);
  const botSlots = getSanitizedBotSlots(source);
  const maxPlayers = clampRoomSize(source.maxPlayers || MAX_ROOM_PLAYERS);
  return {
    code: source.code || null,
    status: source.status || null,
    hostId: source.hostId || null,
    maxPlayers,
    difficulty: source.difficulty || null,
    seatedPlayers: seatedPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      ready: Boolean(player.ready)
    })),
    botSlots: Object.keys(botSlots).map((slot) => Number(slot)).sort((a, b) => a - b)
  };
}

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  screen: "home",
  roomCode: null,
  isHost: false,
  navigatingToGame: false,
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
    logLobby("watchRooms snapshot", {
      totalWaitingRooms: rooms.length,
      freshWaitingRooms: fresh.length,
      rooms: fresh.map((room) => summarizeRoom(room))
    });
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
    const seatedPlayers = normalizeRoomPlayers(room);
    const humanCount = seatedPlayers.length;
    const botCount = countActiveBotSlots(room, seatedPlayers);
    const count = humanCount + botCount;
    const max = clampRoomSize(room.maxPlayers || MAX_ROOM_PLAYERS);
    const hostPlayer = seatedPlayers.find(p => p.id === room.hostId);
    const hostName = hostPlayer ? hostPlayer.name : "Unknown";
    const full = count >= max;
    const botLabel = botCount > 0 ? ` (${botCount} bot${botCount > 1 ? "s" : ""})` : "";
    return `
      <div class="room-item">
        <span class="room-code-badge">${room.code}</span>
        <span class="room-meta">
          ${count}/${max} seats used${botLabel}
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

  const maxPlayers = MAX_ROOM_PLAYERS;
  const roomData = {
    code,
    hostId: MY_ID,
    status: "waiting",
    maxPlayers,
    difficulty: "medium",
    botSlots: {},
    createdAt: Date.now(),
    players: {
      [MY_ID]: { id: MY_ID, seat: 0, name, ready: false, joinedAt: Date.now(), cardBack: getCardBack() }
    }
  };

  logLobby("createRoom write", {
    requestedBy: MY_ID,
    hostName: name,
    room: summarizeRoom(roomData)
  });

  await set(ref(db, `nertz_rooms/${code}`), roomData);
  logLobby("createRoom success", { code, hostId: MY_ID });

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
  logLobby("joinRoom attempt", { code, playerId: MY_ID, name });

  showJoinError("");

  const snap = await get(ref(db, `nertz_rooms/${code}`));
  if (!snap.exists()) { showJoinError("Room not found."); return; }

  const room = snap.val();
  logLobby("joinRoom room snapshot", summarizeRoom(room));
  if (room.status !== "waiting") { showJoinError("That game has already started."); return; }

  const seatedPlayers = normalizeRoomPlayers(room);
  const seat = firstOpenHumanSeat(room, seatedPlayers);
  if (seat < 0) {
    logLobby("joinRoom blocked full", {
      code,
      playerId: MY_ID,
      seatedPlayers: seatedPlayers.map((player) => ({ id: player.id, seat: player.seat })),
      botSlots: Object.keys(getSanitizedBotSlots(room)).map((slot) => Number(slot)).sort((a, b) => a - b)
    });
    showJoinError("Room is full.");
    return;
  }

  await update(ref(db, `nertz_rooms/${code}/players/${MY_ID}`), {
    id: MY_ID, seat, name, ready: false, joinedAt: Date.now(), cardBack: getCardBack()
  });
  logLobby("joinRoom success", { code, playerId: MY_ID, seat, name });

  // Auto-remove on disconnect
  onDisconnect(ref(db, `nertz_rooms/${code}/players/${MY_ID}`)).remove();

  enterRoom(code, false);
}

function showJoinError(msg) {
  el.joinError.textContent = msg;
  el.joinError.classList.toggle("hidden", !msg);
  if (msg) {
    logLobby("join error", { message: msg });
  }
}

function sortPlayersByJoin(players) {
  return players.slice().sort((a, b) => {
    const left = Number(a?.joinedAt) || 0;
    const right = Number(b?.joinedAt) || 0;
    if (left !== right) return left - right;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function getSanitizedBotSlots(room) {
  const maxPlayers = clampRoomSize(room?.maxPlayers || MAX_ROOM_PLAYERS);
  const raw = room?.botSlots || {};
  const out = {};
  Object.entries(raw).forEach(([slotKey, enabled]) => {
    if (!enabled) return;
    const slot = Number(slotKey);
    if (!Number.isInteger(slot) || slot < 0 || slot >= maxPlayers) return;
    out[slot] = true;
  });
  return out;
}

function normalizeRoomPlayers(room) {
  const maxPlayers = clampRoomSize(room?.maxPlayers || MAX_ROOM_PLAYERS);
  const sorted = sortPlayersByJoin(Object.values(room?.players || {}));
  const usedSeats = new Set();
  const unresolved = [];
  const withSeats = [];

  for (const player of sorted) {
    const seat = Number(player?.seat);
    if (Number.isInteger(seat) && seat >= 0 && seat < maxPlayers && !usedSeats.has(seat)) {
      withSeats.push({ ...player, seat });
      usedSeats.add(seat);
    } else {
      unresolved.push(player);
    }
  }

  for (const player of unresolved) {
    let seat = 0;
    while (usedSeats.has(seat) && seat < maxPlayers) seat += 1;
    if (seat >= maxPlayers) continue;
    withSeats.push({ ...player, seat });
    usedSeats.add(seat);
  }

  return withSeats.sort((a, b) => a.seat - b.seat);
}

function firstOpenHumanSeat(room, seatedPlayers) {
  const maxPlayers = clampRoomSize(room?.maxPlayers || MAX_ROOM_PLAYERS);
  const occupiedSeats = new Set(seatedPlayers.map((player) => player.seat));
  const botSlots = getSanitizedBotSlots(room);
  for (let slot = 0; slot < maxPlayers; slot += 1) {
    if (occupiedSeats.has(slot)) continue;
    if (botSlots[slot]) continue;
    return slot;
  }
  return -1;
}

function countActiveBotSlots(room, seatedPlayers) {
  const maxPlayers = clampRoomSize(room?.maxPlayers || MAX_ROOM_PLAYERS);
  const occupiedSeats = new Set(seatedPlayers.map((player) => player.seat));
  const botSlots = getSanitizedBotSlots(room);
  let count = 0;
  for (let slot = 0; slot < maxPlayers; slot += 1) {
    if (occupiedSeats.has(slot)) continue;
    if (botSlots[slot]) count += 1;
  }
  return count;
}

async function cancelDisconnectCleanup(code, includeRoomCleanup = false) {
  if (!db || !code) return;
  const tasks = [
    onDisconnect(ref(db, `nertz_rooms/${code}/players/${MY_ID}`)).cancel()
  ];
  if (includeRoomCleanup) {
    tasks.push(onDisconnect(ref(db, `nertz_rooms/${code}`)).cancel());
  }
  await Promise.allSettled(tasks);
  logLobby("cancelDisconnectCleanup", { code, playerId: MY_ID, includeRoomCleanup });
}

// ── Enter waiting room ────────────────────────────────────────────────────────

function enterRoom(code, isHost) {
  state.roomCode = code;
  state.isHost = isHost;
  state.navigatingToGame = false;
  logLobby("enterRoom", { code, isHost, playerId: MY_ID });

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
      logLobby("watchRoom removed", { code });
      leaveRoom(false);
      return;
    }
    const data = snapshot.val();
    logLobby("watchRoom snapshot", summarizeRoom(data));
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
  const seatedPlayers = normalizeRoomPlayers(data);
  const playersBySeat = new Map(seatedPlayers.map((player) => [player.seat, player]));
  const maxPlayers = clampRoomSize(data.maxPlayers || MAX_ROOM_PLAYERS);
  const botSlots = getSanitizedBotSlots(data);
  const me = seatedPlayers.find((player) => player.id === MY_ID);
  const allHumansReady = seatedPlayers.length > 0 && seatedPlayers.every((player) => Boolean(player.ready));
  const activeBotCount = countActiveBotSlots(data, seatedPlayers);
  const activeSeatCount = seatedPlayers.length + activeBotCount;

  // Sync host settings dropdowns to room data
  if (state.isHost) {
    el.maxPlayersSelect.value = String(maxPlayers);
    el.botDifficultySelect.value = data.difficulty || "medium";
  }

  // Player slots (filled + bot + empty)
  const slots = [];
  for (let i = 0; i < maxPlayers; i++) {
    const p = playersBySeat.get(i);
    if (p) {
      slots.push(`
        <div class="player-slot">
          <span class="slot-dot"></span>
          <span class="slot-name">${escapeHtml(p.name)}${p.id === MY_ID ? " (you)" : ""}</span>
          ${p.id === data.hostId ? `<span class="slot-badge host">Host</span>` : ""}
          ${p.ready ? `<span class="slot-ready-icon">✓</span>` : `<span class="slot-badge">Not ready</span>`}
        </div>`);
      continue;
    }

    if (botSlots[i]) {
      slots.push(`
        <div class="player-slot bot-slot">
          <span class="slot-dot"></span>
          <span class="slot-name">Bot Seat</span>
          <span class="slot-badge">Bot</span>
          ${state.isHost ? `<button class="btn-inline slot-toggle-btn" type="button" data-slot-action="toggle-bot" data-slot="${i}">Remove Bot</button>` : ""}
        </div>`);
      continue;
    }

    const hostToggle = state.isHost
      ? `<button class="btn-inline slot-toggle-btn" type="button" data-slot-action="toggle-bot" data-slot="${i}">Add Bot</button>`
      : "";
    slots.push(`
      <div class="player-slot empty">
        <span class="slot-dot"></span>
        <span class="slot-name">Waiting for player…</span>
        ${hostToggle}
      </div>`);
  }
  el.playerSlots.innerHTML = slots.join("");

  // Ready button
  const amReady = me?.ready ?? false;
  el.readyBtn.textContent = amReady ? "Not Ready" : "I'm Ready";
  el.readyBtn.className = amReady ? "btn-primary" : "btn-secondary";

  // Start button (host only, all humans ready, at least 2 active seats including bots)
  const canStart = state.isHost && allHumansReady && activeSeatCount >= 2;
  logLobby("renderWaitingRoom", {
    roomCode: data?.code || state.roomCode,
    viewerId: MY_ID,
    isHost: state.isHost,
    seatedPlayers: seatedPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      ready: Boolean(player.ready)
    })),
    botSlots: Object.keys(botSlots).map((slot) => Number(slot)).sort((a, b) => a - b),
    maxPlayers,
    activeBotCount,
    activeSeatCount,
    allHumansReady,
    canStart
  });
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
  const seatedPlayers = normalizeRoomPlayers(state.roomData || {});
  const requestedMaxPlayers = clampRoomSize(el.maxPlayersSelect.value);
  const maxPlayers = Math.max(requestedMaxPlayers, seatedPlayers.length, MIN_ROOM_PLAYERS);
  if (String(maxPlayers) !== String(el.maxPlayersSelect.value)) {
    el.maxPlayersSelect.value = String(maxPlayers);
  }
  const difficulty = el.botDifficultySelect.value;
  const occupiedSeats = new Set(seatedPlayers.map((player) => player.seat));
  const currentBotSlots = getSanitizedBotSlots(state.roomData || {});
  const botSlots = {};
  Object.entries(currentBotSlots).forEach(([slotKey, enabled]) => {
    if (!enabled) return;
    const slot = Number(slotKey);
    if (slot >= maxPlayers) return;
    if (occupiedSeats.has(slot)) return;
    botSlots[slot] = true;
  });
  logLobby("updateRoomSettings", {
    roomCode: state.roomCode,
    requestedMaxPlayers: requestedMaxPlayers,
    appliedMaxPlayers: maxPlayers,
    difficulty,
    occupiedSeats: Array.from(occupiedSeats).sort((a, b) => a - b),
    botSlots: Object.keys(botSlots).map((slot) => Number(slot)).sort((a, b) => a - b)
  });
  await update(ref(db, `nertz_rooms/${state.roomCode}`), { maxPlayers, difficulty, botSlots });
}

async function toggleBotSlot(slot) {
  if (!db || !state.roomCode || !state.isHost) return;
  const maxPlayers = clampRoomSize(state.roomData?.maxPlayers || MAX_ROOM_PLAYERS);
  if (!Number.isInteger(slot) || slot < 0 || slot >= maxPlayers) return;

  const seatedPlayers = normalizeRoomPlayers(state.roomData || {});
  const occupiedSeats = new Set(seatedPlayers.map((player) => player.seat));
  if (occupiedSeats.has(slot)) {
    logLobby("toggleBotSlot blocked occupied seat", {
      roomCode: state.roomCode,
      slot,
      occupiedSeats: Array.from(occupiedSeats).sort((a, b) => a - b)
    });
    return;
  }

  const botSlots = getSanitizedBotSlots(state.roomData || {});
  if (botSlots[slot]) {
    delete botSlots[slot];
  } else {
    botSlots[slot] = true;
  }
  logLobby("toggleBotSlot", {
    roomCode: state.roomCode,
    slot,
    botSlots: Object.keys(botSlots).map((value) => Number(value)).sort((a, b) => a - b)
  });

  await update(ref(db, `nertz_rooms/${state.roomCode}`), { botSlots });
}

async function onPlayerSlotAction(event) {
  const actionBtn = event.target.closest("[data-slot-action]");
  if (!actionBtn || !state.isHost) return;
  const action = actionBtn.dataset.slotAction;
  if (action === "toggle-bot") {
    const slot = Number(actionBtn.dataset.slot);
    if (Number.isInteger(slot)) {
      await toggleBotSlot(slot);
    }
  }
}

// ── Start game ────────────────────────────────────────────────────────────────

async function startGame() {
  if (!db || !state.roomCode || !state.isHost) return;
  const data = state.roomData || {};
  const seatedPlayers = normalizeRoomPlayers(data);
  const activeSeatCount = seatedPlayers.length + countActiveBotSlots(data, seatedPlayers);
  const allHumansReady = seatedPlayers.length > 0 && seatedPlayers.every((player) => Boolean(player.ready));
  logLobby("startGame attempt", {
    roomCode: state.roomCode,
    hostId: MY_ID,
    seatedPlayers: seatedPlayers.map((player) => ({ id: player.id, seat: player.seat, ready: Boolean(player.ready) })),
    activeSeatCount,
    allHumansReady
  });
  if (!allHumansReady || activeSeatCount < 2) {
    logLobby("startGame blocked", {
      reason: !allHumansReady ? "not_all_humans_ready" : "not_enough_active_seats"
    });
    return;
  }
  await cancelDisconnectCleanup(state.roomCode, true);
  await update(ref(db, `nertz_rooms/${state.roomCode}`), {
    status: "starting",
    startedAt: Date.now()
  });
  logLobby("startGame set starting", { roomCode: state.roomCode });
}

async function navigateToGame(roomData) {
  if (state.navigatingToGame) return;
  state.navigatingToGame = true;
  if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
  const seatedPlayers = normalizeRoomPlayers(roomData || {});
  const activeSeatCount = seatedPlayers.length + countActiveBotSlots(roomData || {}, seatedPlayers);
  const playerCount = Math.max(MIN_ROOM_PLAYERS, Math.min(MAX_ROOM_PLAYERS, activeSeatCount));
  const params = new URLSearchParams({
    room: roomData.code,
    pid: MY_ID,
    host: state.isHost ? "1" : "0",
    difficulty: roomData.difficulty || "medium",
    playerCount: String(playerCount)
  });
  logLobby("navigateToGame", {
    room: summarizeRoom(roomData),
    playerId: MY_ID,
    playerCount,
    query: Object.fromEntries(params.entries())
  });
  await cancelDisconnectCleanup(roomData.code || state.roomCode, state.isHost);
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
  el.playerSlots.addEventListener("click", onPlayerSlotAction);
  el.maxPlayersSelect.addEventListener("change", updateRoomSettings);
  el.botDifficultySelect.addEventListener("change", updateRoomSettings);

  // Start watching rooms if Firebase is ready
  if (db) watchRooms();
}

init();
