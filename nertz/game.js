(() => {
  const SUITS = ["S", "H", "D", "C"];
  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RANK_LABEL = {
    1: "A",
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
    9: "9",
    10: "10",
    11: "J",
    12: "Q",
    13: "K"
  };
  const BOT_NAMES = ["North Bot", "Ridge Bot", "Copper Bot"];
  const LOG_LIMIT = 24;
  const HUMAN_PILE_STEP = 18;
  const BOT_PILE_STEP = 11;
  const MAX_WASTE_VISIBLE = 3;
  const WASTE_SPREAD_STEP = 14;
  const BASE_CENTER_SLOT_COUNT = 10;
  const CENTER_SLOT_COLUMNS = 10;

  const DIFFICULTY = {
    easy: { minDelay: 1300, maxDelay: 2300, skill: 0.34, idleChance: 0.34 },
    medium: { minDelay: 980, maxDelay: 1700, skill: 0.53, idleChance: 0.24 },
    hard: { minDelay: 760, maxDelay: 1300, skill: 0.7, idleChance: 0.14 }
  };
  const BACK_PATTERNS = ["weave", "dots", "grid", "stars", "hex", "diamond"];
  const BACK_PALETTES = [
    ["#17365f", "#2a5ea6"],
    ["#6d1f3b", "#ab3b66"],
    ["#1f5a44", "#2f8c66"],
    ["#5b2b77", "#8a49ac"],
    ["#4d3a19", "#8a6325"],
    ["#194f5b", "#2b8092"],
    ["#4c2230", "#803851"],
    ["#1f3f63", "#2f6ea8"]
  ];

  let cardUid = 0;

  const state = {
    settings: {
      playerCount: 3,
      difficulty: "medium",
      cardBack: "weave",
      cardBackConfig: { pattern: "weave", color1: "#7a1621", color2: "#b03641" }
    },
    online: {
      enabled: false,
      roomCode: "",
      playerId: "",
      roomData: null,
      syncReady: false
    },
    players: [],
    centerPiles: [],
    centerPileSlots: [],
    completedCenterSlots: new Set(),
    running: false,
    winnerId: null,
    selected: null,
    dragging: null,
    pendingPointer: null,
    dragGhostEl: null,
    selectionGhostEl: null,
    selectionGhostKey: null,
    dragOriginEl: null,
    mouseX: window.innerWidth / 2,
    mouseY: window.innerHeight / 2,
    lastDragEndAt: 0,
    hoveredTargetEl: null,
    logs: [],
    tickHandle: null,
    alert: null,
    dealAnimating: false,
    dealToken: 0,
    awaitingReady: false,
    readyByPlayerId: {}
  };

  const el = {
    hero: document.getElementById("hero"),
    setupCard: document.getElementById("setup-card"),
    playerCount: document.getElementById("player-count"),
    difficulty: document.getElementById("difficulty"),
    backPreviewMini: document.getElementById("back-preview-mini"),
    startBtn: document.getElementById("start-btn"),
    newRoundBtn: document.getElementById("new-round-btn"),
    readyOverlay: document.getElementById("ready-overlay"),
    readyList: document.getElementById("ready-list"),
    statusTitle: document.getElementById("status-title"),
    statusText: document.getElementById("status-text"),
    selectedPill: document.getElementById("selected-pill"),
    tableView: document.getElementById("table-view"),
    botRow: document.getElementById("bot-row"),
    centerPiles: document.getElementById("center-piles"),
    metricCenter: document.getElementById("metric-center"),
    metricNertz: document.getElementById("metric-nertz"),
    nertzSpot: document.getElementById("nertz-spot"),
    drawSpot: document.getElementById("draw-spot"),
    tableau: document.getElementById("tableau"),
    actionLog: document.getElementById("action-log"),
    clearSelectionBtn: document.getElementById("clear-selection-btn"),
    endModal: document.getElementById("end-modal"),
    endTitle: document.getElementById("end-title"),
    endSubtitle: document.getElementById("end-subtitle"),
    scoreboard: document.getElementById("scoreboard"),
    closeModalBtn: document.getElementById("close-modal-btn"),
    forceReshuffleBtn: document.getElementById("force-reshuffle-btn")
  };

  function init() {
    el.startBtn.addEventListener("click", () => startMatch());
    if (el.newRoundBtn) {
      el.newRoundBtn.addEventListener("click", () => startMatch());
    }
    if (el.readyOverlay) {
      el.readyOverlay.addEventListener("click", onReadyPressed);
      el.readyOverlay.addEventListener("keydown", (event) => {
        if (event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          onReadyPressed();
        }
      });
    }
    loadCardBack();

    el.clearSelectionBtn.addEventListener("click", () => {
      state.selected = null;
      announce("Selection cleared", "Choose another card source.", 1300);
      render();
    });

    el.closeModalBtn.addEventListener("click", () => {
      el.endModal.classList.add("hidden");
    });

    if (el.forceReshuffleBtn) {
      el.forceReshuffleBtn.addEventListener("click", () => {
        for (const player of state.players) reshuffleDrawPile(player);
        state.lastNertzPlayAt = Date.now();
        state.lastActivityAt = Date.now();
        state.lastReshuffle = Date.now();
        el.forceReshuffleBtn.style.display = "none";
        announce("Draw piles reshuffled!", "Keep playing.", 2500);
        addLog("<strong>Manual reshuffle.</strong> Draw piles reshuffled.");
        render();
      });
    }

    document.addEventListener("click", handleDelegatedClick);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("mousemove", onMouseMovePassive);
    render();
    void maybeAutoLaunchOnlineMatch();
  }

  function loadCardBack() {
    let back = { pattern: "weave", color1: "#7a1621", color2: "#b03641" };
    try {
      const saved = localStorage.getItem("nertz_cardback");
      if (saved) back = JSON.parse(saved);
    } catch (e) {}
    document.body.setAttribute("data-back-style", back.pattern);
    document.documentElement.style.setProperty("--back-color-1", back.color1);
    document.documentElement.style.setProperty("--back-color-2", back.color2);
    document.body.style.setProperty("--back-bg", `linear-gradient(140deg, ${back.color1} 45%, ${back.color2})`);
    document.body.style.setProperty("--back-pattern", patternToCss(back.pattern, back.color2));
    state.settings.cardBack = back.pattern;
    state.settings.cardBackConfig = back;
    renderBackPreviewMini(back);
  }

  function renderBackPreviewMini(back) {
    if (!el.backPreviewMini) return;
    el.backPreviewMini.style.setProperty("--back-color-1", back.color1);
    el.backPreviewMini.style.setProperty("--back-color-2", back.color2);
    el.backPreviewMini.style.setProperty("--back-bg", `linear-gradient(140deg, ${back.color1} 45%, ${back.color2})`);
    el.backPreviewMini.style.setProperty("--back-pattern", patternToCss(back.pattern, back.color2));
    el.backPreviewMini.style.setProperty("--back-pattern-size", patternSize(back.pattern));
    el.backPreviewMini.setAttribute("data-pattern", back.pattern);
  }

  function parseOnlineLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const roomCode = (params.get("room") || "").trim().toUpperCase();
    const playerId = (params.get("pid") || "").trim();
    if (!roomCode || !playerId) {
      return null;
    }

    const playerCount = clamp(Number(params.get("playerCount")) || state.settings.playerCount, 2, 4);
    const difficulty = normalizeDifficulty(params.get("difficulty") || state.settings.difficulty);
    return { roomCode, playerId, playerCount, difficulty };
  }

  async function maybeAutoLaunchOnlineMatch() {
    const launch = parseOnlineLaunchParams();
    if (!launch) {
      return;
    }

    state.online.enabled = true;
    state.online.roomCode = launch.roomCode;
    state.online.playerId = launch.playerId;
    state.online.syncReady = false;

    let forcedSettings = {
      playerCount: launch.playerCount,
      difficulty: launch.difficulty
    };
    let playerSpecs = buildFallbackOnlinePlayerSpecs(launch);

    const roomData = await tryLoadOnlineRoomData(launch.roomCode);
    if (roomData) {
      state.online.roomData = roomData;
      const onlineConfig = buildOnlinePlayerSpecsFromRoom(roomData, launch);
      forcedSettings = {
        playerCount: onlineConfig.playerCount,
        difficulty: onlineConfig.difficulty
      };
      playerSpecs = onlineConfig.playerSpecs;
      state.online.syncReady = true;
    }

    if (el.playerCount) {
      el.playerCount.value = String(forcedSettings.playerCount);
    }
    if (el.difficulty) {
      el.difficulty.value = forcedSettings.difficulty;
    }

    if (!state.running) {
      startMatch({ forcedSettings, playerSpecs });
    }
  }

  async function tryLoadOnlineRoomData(roomCode) {
    try {
      const configModule = await import("./firebase-config.js");
      const cfg = configModule?.firebaseConfig || {};
      if (!cfg.apiKey || !cfg.databaseURL) {
        return null;
      }

      const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const firebaseDb = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

      const appName = "nertz-game-client";
      const existing = firebaseApp.getApps().find((app) => app.name === appName);
      const app = existing || firebaseApp.initializeApp(cfg, appName);
      const db = firebaseDb.getDatabase(app);
      const snap = await firebaseDb.get(firebaseDb.ref(db, `nertz_rooms/${roomCode}`));

      if (!snap.exists()) {
        return null;
      }

      return snap.val();
    } catch (error) {
      return null;
    }
  }

  function buildOnlinePlayerSpecsFromRoom(roomData, launch) {
    const roomPlayers = Object.values(roomData?.players || {}).sort((a, b) => {
      const left = Number(a?.joinedAt) || 0;
      const right = Number(b?.joinedAt) || 0;
      if (left !== right) {
        return left - right;
      }
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

    let me = roomPlayers.find((player) => String(player?.id) === launch.playerId);
    if (!me) {
      me = {
        id: launch.playerId,
        name: localStorage.getItem("nertz_player_name") || "You",
        cardBack: state.settings.cardBackConfig
      };
    }

    const others = roomPlayers.filter((player) => String(player?.id) !== launch.playerId);
    const targetCount = clamp(Math.max(2, roomPlayers.length, launch.playerCount), 2, 4);
    const playerSpecs = [
      {
        name: me?.name || "You",
        isHuman: true,
        isNetworkPlayer: false,
        networkId: launch.playerId,
        difficulty: roomData?.difficulty || launch.difficulty,
        cardBack: sanitizeCardBack(me?.cardBack, state.settings.cardBackConfig)
      }
    ];

    for (const player of others) {
      if (playerSpecs.length >= targetCount) {
        break;
      }
      playerSpecs.push({
        name: player?.name || `Player ${playerSpecs.length + 1}`,
        isHuman: false,
        isNetworkPlayer: true,
        networkId: player?.id || null,
        difficulty: roomData?.difficulty || launch.difficulty,
        cardBack: sanitizeCardBack(player?.cardBack, null)
      });
    }

    while (playerSpecs.length < targetCount) {
      playerSpecs.push({
        name: BOT_NAMES[playerSpecs.length - 1] || `Bot ${playerSpecs.length}`,
        isHuman: false,
        isNetworkPlayer: false,
        networkId: null,
        difficulty: roomData?.difficulty || launch.difficulty
      });
    }

    return {
      playerCount: targetCount,
      difficulty: normalizeDifficulty(roomData?.difficulty || launch.difficulty),
      playerSpecs
    };
  }

  function buildFallbackOnlinePlayerSpecs(launch) {
    const playerSpecs = [
      {
        name: localStorage.getItem("nertz_player_name") || "You",
        isHuman: true,
        isNetworkPlayer: false,
        networkId: launch.playerId,
        difficulty: launch.difficulty,
        cardBack: state.settings.cardBackConfig
      }
    ];

    while (playerSpecs.length < launch.playerCount) {
      playerSpecs.push({
        name: BOT_NAMES[playerSpecs.length - 1] || `Bot ${playerSpecs.length}`,
        isHuman: false,
        isNetworkPlayer: false,
        networkId: null,
        difficulty: launch.difficulty
      });
    }

    return playerSpecs;
  }

  function sanitizeCardBack(back, fallback = null) {
    if (!back || typeof back !== "object") {
      return fallback;
    }
    if (!back.pattern || !back.color1 || !back.color2) {
      return fallback;
    }
    return {
      pattern: String(back.pattern),
      color1: String(back.color1),
      color2: String(back.color2)
    };
  }

  function startMatch(options = {}) {
    clearDragging();
    clearSelectionGhost();
    clearFlyingGhosts();
    const forcedSettings = options.forcedSettings || null;
    if (forcedSettings) {
      state.settings.playerCount = clamp(Number(forcedSettings.playerCount) || state.settings.playerCount, 2, 4);
      state.settings.difficulty = normalizeDifficulty(forcedSettings.difficulty || state.settings.difficulty);
    } else {
      state.settings.playerCount = Number(el.playerCount.value);
      state.settings.difficulty = el.difficulty.value;
    }

    state.players = createPlayers(state.settings.playerCount, state.settings.difficulty, options.playerSpecs || null);
    state.centerPiles = [];
    state.centerPileSlots = [];
    state.completedCenterSlots = new Set();
    state.running = true;
    state.winnerId = null;
    state.selected = null;
    state.logs = [];
    state.alert = null;
    state.lastStuckCheck = 0;
    state.lastReshuffle = 0;
    state.lastNertzPlayAt = Date.now();
    state.lastActivityAt = Date.now();
    state.dealAnimating = true;
    state.dealToken += 1;
    state.awaitingReady = false;
    state.readyByPlayerId = {};

    addLog("<strong>Round start.</strong> Race to empty your Nertz pile.");
    if (state.online.enabled && state.online.roomCode) {
      if (state.online.syncReady) {
        addLog(`<strong>Online room ${state.online.roomCode} connected.</strong> Multiplayer sync wiring is in progress.`);
      } else {
        addLog(`<strong>Online room ${state.online.roomCode}.</strong> Firebase sync unavailable; running local preview.`);
      }
    }

    el.endModal.classList.add("hidden");
    if (el.newRoundBtn) {
      el.newRoundBtn.disabled = false;
    }
    el.tableView.classList.remove("hidden");
    if (el.setupCard) el.setupCard.classList.add("hidden");
    if (el.hero) el.hero.classList.add("hidden");

    if (state.tickHandle) {
      clearInterval(state.tickHandle);
    }

    state.tickHandle = setInterval(gameTick, 90);
    render();
    runInitialDealAnimation(state.dealToken);
  }

  function createPlayers(playerCount, difficulty, playerSpecs = null) {
    const players = [];
    const specs = Array.isArray(playerSpecs) && playerSpecs.length ? playerSpecs.slice(0, 4) : null;
    const count = specs ? specs.length : playerCount;
    const botBacks = generateBotBacks(Math.max(0, count - 1), state.settings.cardBackConfig);
    let nextBotBack = 0;

    for (let i = 0; i < count; i += 1) {
      const spec = specs ? specs[i] : null;
      const isHuman = spec ? Boolean(spec.isHuman) : i === 0;
      const deck = shuffled(makeDeck(i + 1));

      let cursor = 0;
      const tableau = [];
      for (let pile = 0; pile < 4; pile += 1) {
        const cards = [];
        for (let j = 0; j < pile + 1; j += 1) {
          const card = deck[cursor++];
          card.faceUp = j === pile;
          cards.push(card);
        }
        tableau.push(cards);
      }

      const nertz = deck.slice(cursor, cursor + 13);
      cursor += 13;
      nertz.forEach((card, idx) => {
        card.faceUp = idx === nertz.length - 1;
      });

      const handSlots = deck.slice(cursor);
      handSlots.forEach((card) => {
        card.faceUp = false;
      });

      players.push({
        id: i,
        name: spec?.name || (isHuman ? "You" : BOT_NAMES[i - 1] || `Bot ${i}`),
        isHuman,
        isNetworkPlayer: Boolean(spec?.isNetworkPlayer),
        networkId: spec?.networkId || null,
        difficulty: normalizeDifficulty(spec?.difficulty || difficulty),
        cardBack: spec?.cardBack || (isHuman ? state.settings.cardBackConfig : botBacks[nextBotBack++] || state.settings.cardBackConfig),
        tableau,
        nertz,
        handSlots,
        drawCursor: 0,
        currentChunk: [],
        wasteHistory: [],
        centerPlayed: 0,
        dealVisible: {
          pileCounts: [0, 0, 0, 0],
          nertzVisual: 0
        },
        nextActionAt: performance.now() + randomInt(160, 720)
      });
    }

    return players;
  }

  function makeDeck(seed) {
    const cards = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank += 1) {
        cards.push({
          suit,
          rank,
          id: `${seed}-${suit}${rank}-${cardUid++}`,
          faceUp: false
        });
      }
    }
    return cards;
  }

  function shuffled(cards) {
    const arr = cards.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function hasAnyProgressMove(player) {
    const nertzTop = topNertzCard(player);
    if (nertzTop) {
      if (findCenterTarget(nertzTop) !== null) return true;
      for (const pile of player.tableau) {
        if (pile.length === 0) return true;
        if (canStackOnTableau(nertzTop, pile[pile.length - 1])) return true;
      }
    }

    const wasteTop = getWasteTop(player);
    if (wasteTop) {
      if (findCenterTarget(wasteTop.card) !== null) return true;
      for (const pile of player.tableau) {
        if (pile.length === 0) return true;
        if (canStackOnTableau(wasteTop.card, pile[pile.length - 1])) return true;
      }
    }

    for (const pile of player.tableau) {
      if (!pile.length) continue;
      const top = pile[pile.length - 1];
      if (top.faceUp && findCenterTarget(top) !== null) return true;
    }

    // Scan all remaining hand cards — if any could go to center when drawn, there's still potential
    for (const card of player.handSlots) {
      if (card && findCenterTarget(card) !== null) return true;
    }

    return false;
  }

  function reshuffleDrawPile(player) {
    const remaining = player.handSlots.filter(Boolean);
    if (!remaining.length) return;
    const reordered = shuffled(remaining);
    player.handSlots = Array(player.handSlots.length).fill(null);
    reordered.forEach((card, i) => { player.handSlots[i] = card; });
    player.drawCursor = 0;
    player.currentChunk = [];
    player.wasteHistory = [];
  }

  function checkStuck() {
    if (!state.running || state.dealAnimating || state.awaitingReady) return;
    const now = Date.now();
    if (now - state.lastStuckCheck < 3000) return;
    if (now - state.lastReshuffle < 5000) return;
    state.lastStuckCheck = now;

    if (state.players.some(hasAnyProgressMove)) return;

    state.lastReshuffle = now;
    for (const player of state.players) {
      reshuffleDrawPile(player);
    }
    announce("Stuck — draw piles reshuffled!", "No legal moves for any player.", 3500);
    addLog("<strong>Game stuck.</strong> All draw piles reshuffled.");
    render();
  }

  function gameTick() {
    if (!state.running) {
      return;
    }

    if (state.dealAnimating || state.awaitingReady) {
      return;
    }

    if (state.alert && Date.now() > state.alert.expiresAt) {
      state.alert = null;
      renderStatus();
    }

    const now = performance.now();

    for (const player of state.players) {
      if (player.isHuman || player.isNetworkPlayer) {
        continue;
      }

      if (now >= player.nextActionAt) {
        const acted = botTakeAction(player);
        const cfg = DIFFICULTY[player.difficulty] || DIFFICULTY.medium;
        const delay = randomInt(cfg.minDelay, cfg.maxDelay);
        player.nextActionAt = now + (acted ? delay : Math.floor(delay * 0.78));

        if (!state.running) {
          break;
        }
      }
    }

    checkStuck();
    render();
  }

  function botTakeAction(player) {
    if (!state.running) {
      return false;
    }

    const moveChoices = collectBotMoves(player);
    if (!moveChoices.length) {
      return false;
    }

    const chosen = chooseBotMove(player, moveChoices);
    if (!chosen) {
      return false;
    }

    return performBotMove(player, chosen);
  }

  function performBotMove(player, move) {
    if (move.kind === "draw") {
      return applyMove(player, move, true);
    }

    const requireSingle = move.kind === "toCenter";
    const picked = pickSourceCard(player, move.source, requireSingle);
    const movingCard = picked ? picked.run[0] : null;
    const fromPoint = picked ? locateBotSourcePoint(player, picked) : null;

    const moved = applyMove(player, move, true);
    if (!moved) {
      return false;
    }

    render();

    if (movingCard && fromPoint) {
      const toPoint = locateBotTargetPoint(player, move, movingCard);
      if (toPoint) {
        animateFlyingCard(movingCard, fromPoint, toPoint, {
          duration: 280,
          small: true,
          ghostClass: "bot-move-ghost"
        });
      }
    }

    return true;
  }

  function locateBotSourcePoint(player, picked) {
    const seat = document.querySelector(`.bot-seat[data-player-id="${player.id}"]`);
    if (!seat) {
      return null;
    }

    let sourceEl = null;
    if (picked.source.type === "nertz") {
      sourceEl = seat.querySelector('[data-bot-source="nertz"]');
    } else if (picked.source.type === "waste") {
      sourceEl = seat.querySelector('[data-bot-source="waste"]');
    } else if (picked.source.type === "tableau") {
      const pile = player.tableau[picked.source.pile] || [];
      const idx = picked.source.index ?? Math.max(0, pile.length - 1);
      sourceEl = seat.querySelector(`[data-bot-source="tableau"][data-pile="${picked.source.pile}"][data-index="${idx}"]`);
    }

    return getElementCenterPoint(sourceEl, 0.5);
  }

  function locateBotTargetPoint(player, move, movedCard) {
    if (move.kind === "toTableau") {
      const targetEl = document.querySelector(
        `.bot-seat[data-player-id="${player.id}"] [data-bot-target="tableau"][data-pile="${move.toPile}"]`
      );
      return getElementCenterPoint(targetEl, 0.64);
    }

    if (move.kind === "toCenter") {
      let centerIdx = -1;
      for (let i = 0; i < state.centerPiles.length; i += 1) {
        if (state.centerPiles[i].some((card) => card.id === movedCard.id)) {
          centerIdx = i;
          break;
        }
      }

      const targetEl =
        centerIdx >= 0
          ? document.querySelector(`[data-target="center"][data-mode="existing"][data-index="${centerIdx}"]`)
          : document.querySelector('[data-target="center"][data-mode="new"]');

      return getElementCenterPoint(targetEl, 0.56);
    }

    return null;
  }

  function getElementCenterPoint(node, yBias = 0.5) {
    if (!node) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height * yBias
    };
  }

  function animateFlyingCard(card, fromPoint, toPoint, options = {}) {
    if (!fromPoint || !toPoint) {
      return Promise.resolve();
    }

    const duration = options.duration ?? 260;
    const delay = options.delay ?? 0;
    const small = Boolean(options.small);

    const ghost = document.createElement("div");
    ghost.className = "flying-card-ghost";
    if (options.ghostClass) {
      ghost.classList.add(options.ghostClass);
    }
    ghost.style.setProperty("--ghost-rot", `${randomInt(-8, 8)}deg`);
    ghost.style.left = `${fromPoint.x}px`;
    ghost.style.top = `${fromPoint.y}px`;
    ghost.style.opacity = "0";

    const useFaceUp = Boolean(card);
    const renderCardSource = card || { suit: "S", rank: 1, faceUp: false };
    ghost.innerHTML = renderCard(renderCardSource, {
      faceUp: useFaceUp,
      small,
      backStyle: options.backStyle || ""
    });

    document.body.appendChild(ghost);

    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (!ghost.isConnected) {
          resolve();
          return;
        }

        ghost.style.transition = `left ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1), top ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 140ms linear`;
        ghost.style.opacity = "0.96";

        requestAnimationFrame(() => {
          ghost.style.left = `${toPoint.x}px`;
          ghost.style.top = `${toPoint.y}px`;
        });

        window.setTimeout(() => {
          if (ghost.isConnected) {
            ghost.remove();
          }
          resolve();
        }, duration + 150);
      }, delay);
    });
  }

  function clearFlyingGhosts() {
    document.querySelectorAll(".flying-card-ghost").forEach((node) => node.remove());
  }

  function getDealOriginPoint() {
    const originNode = el.centerPiles || el.tableView;
    return getElementCenterPoint(originNode, 0.42);
  }

  function getDealLaneElement(playerId, zone, pileIndex = null) {
    let selector = `[data-player-id="${playerId}"][data-zone="${zone}"]`;
    if (zone === "pile") {
      selector += `[data-pile="${pileIndex}"]`;
    }
    return document.querySelector(selector);
  }

  function runInitialDealAnimation(token) {
    const origin = getDealOriginPoint();
    if (!origin) {
      finalizeDealVisibility();
      state.dealAnimating = false;
      state.awaitingReady = true;
      seedReadyStatus();
      render();
      return;
    }

    const schedule = [];

    for (let pass = 0; pass < 4; pass += 1) {
      for (const player of state.players) {
        const backStyle = cardBackStyle(player.cardBack);
        for (let pile = pass; pile < 4; pile += 1) {
          const topCard = pass === pile ? player.tableau[pile][pile] : null;
          schedule.push({
            playerId: player.id,
            zone: "pile",
            pile,
            card: topCard,
            small: !player.isHuman,
            backStyle
          });
        }
      }
    }

    for (const player of state.players) {
      const backStyle = cardBackStyle(player.cardBack);
      const nertzTop = topNertzCard(player);
      for (let i = 0; i < 4; i += 1) {
        schedule.push({
          playerId: player.id,
          zone: "nertz",
          pile: null,
          card: i === 3 ? nertzTop : null,
          small: !player.isHuman,
          backStyle
        });
      }
    }

    const flights = schedule.map((step, idx) => {
      const delay = idx * 34;
      window.setTimeout(() => {
        if (!state.running || token !== state.dealToken) {
          return;
        }
        incrementDealVisibility(step);
        render();
      }, delay);

      const laneEl = getDealLaneElement(step.playerId, step.zone, step.pile);
      const lanePoint = getElementCenterPoint(laneEl, 0.66);
      if (!lanePoint) {
        return Promise.resolve();
      }
      return animateFlyingCard(step.card, origin, lanePoint, {
        duration: 250,
        delay,
        small: step.small,
        backStyle: step.backStyle || "",
        ghostClass: "deal-card-ghost"
      });
    });

    Promise.all(flights).then(() => {
      if (!state.running || token !== state.dealToken) {
        return;
      }

      finalizeDealVisibility();
      state.dealAnimating = false;
      state.awaitingReady = true;
      seedReadyStatus();
      render();
    });
  }

  function onReadyPressed() {
    if (!state.running || state.dealAnimating || !state.awaitingReady) {
      return;
    }

    markHumansReady();
    if (!areAllPlayersReady()) {
      render();
      return;
    }

    state.awaitingReady = false;
    const now = performance.now();
    for (const player of state.players) {
      if (!player.isHuman) {
        player.nextActionAt = now + randomInt(180, 640);
      }
    }
    render();
  }

  function generateBotBacks(count, humanBack) {
    const patternPool = shuffled(BACK_PATTERNS.filter((pattern) => pattern !== humanBack?.pattern));
    const backs = [];
    for (let i = 0; i < count; i += 1) {
      const pattern = patternPool[i] || sample(BACK_PATTERNS);
      const palette = sample(BACK_PALETTES);
      backs.push({
        pattern,
        color1: palette[0],
        color2: palette[1]
      });
    }
    return backs;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function patternToCss(pattern, color2) {
    const c = color2 || "#ffffff";
    switch (pattern) {
      case "dots":
        return `radial-gradient(circle at center, ${hexToRgba(c,.75)} 0 3px, transparent 3px 12px), radial-gradient(circle at top left, ${hexToRgba(c,.45)} 0 3px, transparent 4px 10px)`;
      case "grid":
        return `repeating-linear-gradient(90deg, ${hexToRgba(c,.55)} 0 1px, transparent 1px 10px), repeating-linear-gradient(0deg, ${hexToRgba(c,.55)} 0 1px, transparent 1px 10px)`;
      case "stars":
        return `radial-gradient(circle at center, ${hexToRgba(c,.70)} 0 2px, transparent 2px 12px), conic-gradient(from 20deg, ${hexToRgba(c,.45)}, transparent 40%, ${hexToRgba(c,.45)})`;
      case "hex":
        return `repeating-linear-gradient(60deg, ${hexToRgba(c,.55)} 0 1px, transparent 1px 8px), repeating-linear-gradient(-60deg, ${hexToRgba(c,.50)} 0 1px, transparent 1px 8px)`;
      case "diamond":
        return `repeating-linear-gradient(45deg, ${hexToRgba(c,.60)} 0 1px, transparent 1px 14px), repeating-linear-gradient(-45deg, ${hexToRgba(c,.60)} 0 1px, transparent 1px 14px)`;
      case "weave":
      default:
        return `repeating-linear-gradient(45deg, ${hexToRgba(c,.70)} 0 8px, ${hexToRgba(c,.12)} 8px 16px)`;
    }
  }

  function patternSize(pattern) {
    return pattern === "dots" || pattern === "stars" ? "20px 20px" : "auto";
  }

  function cardBackStyle(back) {
    if (!back) {
      return "";
    }
    const bg = `linear-gradient(140deg, ${back.color1} 45%, ${back.color2})`;
    const pattern = patternToCss(back.pattern, back.color2);
    const size = patternSize(back.pattern);
    return `--card-back-bg:${bg};--card-back-pattern:${pattern};--card-back-size:${size};`;
  }

  function getVisiblePileCount(player, pileIdx) {
    if (!state.dealAnimating && !state.awaitingReady) {
      return player.tableau[pileIdx].length;
    }
    return Math.min(player.tableau[pileIdx].length, player.dealVisible?.pileCounts?.[pileIdx] ?? 0);
  }

  function getVisibleNertzVisual(player) {
    if (!state.dealAnimating && !state.awaitingReady) {
      return Math.min(4, player.nertz.length);
    }
    return Math.max(0, Math.min(4, player.dealVisible?.nertzVisual ?? 0));
  }

  function incrementDealVisibility(step) {
    const player = state.players.find((p) => p.id === step.playerId);
    if (!player || !player.dealVisible) {
      return;
    }

    if (step.zone === "pile" && typeof step.pile === "number") {
      const current = player.dealVisible.pileCounts[step.pile] ?? 0;
      player.dealVisible.pileCounts[step.pile] = Math.min(player.tableau[step.pile].length, current + 1);
      return;
    }

    if (step.zone === "nertz") {
      player.dealVisible.nertzVisual = Math.min(4, (player.dealVisible.nertzVisual ?? 0) + 1);
    }
  }

  function finalizeDealVisibility() {
    for (const player of state.players) {
      if (!player.dealVisible) {
        continue;
      }
      player.dealVisible.pileCounts = player.tableau.map((pile) => pile.length);
      player.dealVisible.nertzVisual = Math.min(4, player.nertz.length);
    }
  }

  function seedReadyStatus() {
    const next = {};
    for (const player of state.players) {
      next[player.id] = !player.isHuman;
    }
    state.readyByPlayerId = next;
  }

  function markHumansReady() {
    for (const player of state.players) {
      if (player.isHuman) {
        state.readyByPlayerId[player.id] = true;
      }
    }
  }

  function areAllPlayersReady() {
    for (const player of state.players) {
      if (!state.readyByPlayerId[player.id]) {
        return false;
      }
    }
    return true;
  }

  function renderReadyOverlay() {
    if (!el.readyOverlay) {
      return;
    }

    if (state.running && !state.dealAnimating && state.awaitingReady) {
      el.readyOverlay.classList.remove("hidden");
      if (el.readyList) {
        el.readyList.innerHTML = state.players
          .map((player) => {
            const isReady = Boolean(state.readyByPlayerId[player.id]);
            return `
              <div class="ready-item ${isReady ? "is-ready" : ""}">
                <span class="ready-player">${player.name}</span>
                <span class="ready-check">${isReady ? "✓" : "○"}</span>
              </div>
            `;
          })
          .join("");
      }
    } else {
      el.readyOverlay.classList.add("hidden");
    }
  }

  function collectBotMoves(player) {
    const moves = [];

    const nertzTop = topNertzCard(player);
    if (nertzTop) {
      const centerTarget = findCenterTarget(nertzTop);
      if (centerTarget !== null) {
        moves.push({ kind: "toCenter", source: { type: "nertz" }, centerTarget, priority: 100 + nertzTop.rank });
      }

      for (let i = 0; i < player.tableau.length; i += 1) {
        const destPile = player.tableau[i];
        if (destPile.length === 0) {
          moves.push({ kind: "toTableau", source: { type: "nertz" }, toPile: i, priority: 66 });
          continue;
        }

        const destTop = destPile[destPile.length - 1];
        if (destTop && canStackOnTableau(nertzTop, destTop)) {
          moves.push({ kind: "toTableau", source: { type: "nertz" }, toPile: i, priority: 68 });
        }
      }
    }

    const wasteTop = getWasteTop(player);
    if (wasteTop) {
      const centerTarget = findCenterTarget(wasteTop.card);
      if (centerTarget !== null) {
        moves.push({ kind: "toCenter", source: { type: "waste" }, centerTarget, priority: 75 });
      }

      for (let i = 0; i < player.tableau.length; i += 1) {
        const destPile = player.tableau[i];
        const destTop = destPile[destPile.length - 1];
        if (destTop && canStackOnTableau(wasteTop.card, destTop)) {
          moves.push({ kind: "toTableau", source: { type: "waste" }, toPile: i, priority: 58 });
        }
      }
    }

    for (let src = 0; src < player.tableau.length; src += 1) {
      const pile = player.tableau[src];
      if (!pile.length) {
        continue;
      }

      const top = pile[pile.length - 1];
      if (top.faceUp) {
        const centerTarget = findCenterTarget(top);
        if (centerTarget !== null) {
          let priority = 84;
          if (pile.length > 1 && !pile[pile.length - 2].faceUp) {
            priority += 12;
          }
          moves.push({ kind: "toCenter", source: { type: "tableau", pile: src }, centerTarget, priority });
        }
      }

      for (let idx = 0; idx < pile.length; idx += 1) {
        if (!pile[idx].faceUp || !isValidFaceUpRun(pile, idx)) {
          continue;
        }

        for (let dest = 0; dest < player.tableau.length; dest += 1) {
          if (dest === src) {
            continue;
          }

          const destPile = player.tableau[dest];
          let legal = false;
          let priority = 0;

          const willUncover = idx > 0 && !pile[idx - 1].faceUp;

          if (destPile.length === 0) {
            legal = true;
            // Uncovering a face-down card is high-value even to an empty slot
            priority = willUncover ? 85 : 46;
          } else {
            const first = pile[idx];
            const destTop = destPile[destPile.length - 1];
            legal = canStackOnTableau(first, destTop);
            if (legal) {
              // Only worth moving to a non-empty pile if it uncovers a face-down card;
              // otherwise keep priority below draw so the bot doesn't shuffle piles endlessly
              priority = willUncover ? (idx < pile.length - 1 ? 69 : 67) : 5;
            }
          }

          if (!legal) {
            continue;
          }

          if (idx === 0 && nertzTop && pile.length > 0) {
            priority += 6;
          }

          moves.push({
            kind: "toTableau",
            source: { type: "tableau", pile: src, index: idx },
            toPile: dest,
            priority
          });
        }
      }
    }

    if (remainingHandCount(player) > 0) {
      moves.push({ kind: "draw", priority: 14 });
    }

    return moves;
  }

  function chooseBotMove(player, moves) {
    const cfg = DIFFICULTY[player.difficulty] || DIFFICULTY.medium;

    if (Math.random() < cfg.idleChance) {
      const drawMove = moves.find((m) => m.kind === "draw");
      if (drawMove) {
        return drawMove;
      }
    }

    const ranked = moves.slice().sort((a, b) => b.priority - a.priority);

    if (Math.random() < cfg.skill) {
      const top = ranked[0].priority;
      const window = cfg.skill > 0.65 ? 8 : 16;
      const candidates = ranked.filter((move) => move.priority >= top - window);
      return sample(candidates);
    }

    return sample(ranked.slice(0, Math.min(9, ranked.length)));
  }

  function applyMove(player, move, isBot = false) {
    if (!state.running) {
      return false;
    }

    switch (move.kind) {
      case "draw": {
        const drew = drawFromHand(player);
        if (drew && isBot) {
          addLog(`<strong>${player.name}</strong> cycled 3 cards.`);
        }
        return drew;
      }
      case "toCenter":
        return moveToCenter(player, move.source, move.centerTarget, isBot);
      case "toTableau":
        return moveToTableau(player, move.source, move.toPile, isBot);
      default:
        return false;
    }
  }

  function moveToCenter(player, source, centerTarget, isBot) {
    const picked = pickSourceCard(player, source, true);
    if (!picked) {
      return false;
    }

    const card = picked.card;
    let target = centerTarget;
    if (target === undefined || target === null) {
      target = findCenterTarget(card);
    }

    if (!isCenterTargetLegal(card, target)) {
      return false;
    }

    removePickedCard(player, picked);
    assignCenterCardStyle(card);

    let placedPileIndex = -1;
    if (isNewCenterTarget(target)) {
      const slot = chooseCenterSlotForNewTarget(target, isBot);
      if (slot === null) {
        return false;
      }
      state.centerPiles.push([card]);
      state.centerPileSlots.push(slot);
      placedPileIndex = state.centerPiles.length - 1;
    } else {
      state.centerPiles[target].push(card);
      placedPileIndex = target;
    }

    player.centerPlayed += 1;
    addLog(`<strong>${player.name}</strong> played ${formatCard(card)} to center.`);

    if (card.rank === 13 && placedPileIndex >= 0) {
      const completedSlot = state.centerPileSlots[placedPileIndex];
      state.centerPiles.splice(placedPileIndex, 1);
      state.centerPileSlots.splice(placedPileIndex, 1);
      state.completedCenterSlots.add(completedSlot);
      addLog(`<strong>${player.name}</strong> completed a center pile with ${formatCard(card)}.`);
    }

    if (!isBot) {
      state.selected = null;
    }
    const winner = findWinner();
    if (winner) {
      finishRound(winner);
    }

    return true;
  }

  function moveToTableau(player, source, toPileIndex, isBot) {
    const picked = pickSourceCard(player, source, false);
    if (!picked) {
      return false;
    }

    if (toPileIndex < 0 || toPileIndex >= player.tableau.length) {
      return false;
    }

    const destination = player.tableau[toPileIndex];

    if (picked.source.type === "tableau" && picked.source.pile === toPileIndex) {
      return false;
    }

    const firstCard = picked.run[0];

    if (destination.length === 0) {
      if (!(picked.source.type === "nertz" || picked.source.type === "tableau")) {
        return false;
      }
    } else {
      const destTop = destination[destination.length - 1];
      if (!canStackOnTableau(firstCard, destTop)) {
        return false;
      }
    }

    removePickedCard(player, picked);
    for (const card of picked.run) {
      card.faceUp = true;
      destination.push(card);
    }

    addLog(`<strong>${player.name}</strong> moved ${formatCard(firstCard)} to Pile ${toPileIndex + 1}.`);

    if (!isBot) {
      state.selected = null;
    }
    const winner = findWinner();
    if (winner) {
      finishRound(winner);
    }

    return true;
  }

  function pickSourceCard(player, source, requireSingleCard) {
    if (!source) {
      return null;
    }

    if (source.type === "nertz") {
      const card = topNertzCard(player);
      if (!card) {
        return null;
      }
      return { source, card, run: [card] };
    }

    if (source.type === "waste") {
      const top = getWasteTop(player);
      if (!top) {
        return null;
      }
      return { source, card: top.card, run: [top.card], wasteIndex: top.index };
    }

    if (source.type === "tableau") {
      const pile = player.tableau[source.pile];
      if (!pile || pile.length === 0) {
        return null;
      }

      const startIndex = source.index ?? pile.length - 1;
      const card = pile[startIndex];
      if (!card || !card.faceUp || !isValidFaceUpRun(pile, startIndex)) {
        return null;
      }

      if (requireSingleCard && startIndex !== pile.length - 1) {
        return null;
      }

      return {
        source,
        card,
        run: pile.slice(startIndex)
      };
    }

    return null;
  }

  function removePickedCard(player, picked) {
    const src = picked.source;

    if (src.type === "nertz") {
      player.nertz.pop();
      if (player.nertz.length > 0) {
        player.nertz[player.nertz.length - 1].faceUp = true;
      }
      state.lastNertzPlayAt = Date.now();
      state.lastActivityAt = Date.now();
      return;
    }

    if (src.type === "waste") {
      const top = getWasteTop(player);
      if (!top) {
        return;
      }
      player.handSlots[top.index] = null;
      cleanCurrentChunk(player);
      state.lastActivityAt = Date.now();
      return;
    }

    if (src.type === "tableau") {
      const pile = player.tableau[src.pile];
      pile.splice(src.index ?? pile.length - 1);
      if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
        pile[pile.length - 1].faceUp = true;
      }
    }
  }

  function drawFromHand(player) {
    if (remainingHandCount(player) === 0) {
      player.currentChunk = [];
      return false;
    }

    const slots = player.handSlots;
    let cursor = player.drawCursor;

    if (cursor >= slots.length) {
      cursor = 0;
    }

    let picks = [];
    for (let i = cursor; i < slots.length && picks.length < 3; i += 1) {
      if (slots[i]) {
        picks.push(i);
      }
    }

    if (picks.length === 0) {
      // Wrap around and retry from the beginning
      for (let i = 0; i < slots.length && picks.length < 3; i += 1) {
        if (slots[i]) picks.push(i);
      }
    }

    if (picks.length === 0) {
      player.drawCursor = 0;
      player.currentChunk = [];
      return false;
    }

    player.currentChunk = picks;
    pushWasteHistory(player, picks);
    const last = picks[picks.length - 1];
    player.drawCursor = last + 1 >= slots.length ? 0 : last + 1;

    if (player.isHuman) {
      state.selected = null;
      addLog(`<strong>You</strong> flipped ${picks.length} card${picks.length > 1 ? "s" : ""}.`);
    }

    return true;
  }

  function getWasteTop(player) {
    cleanCurrentChunk(player);
    if (!player.currentChunk.length) {
      return null;
    }

    const index = player.currentChunk[player.currentChunk.length - 1];
    const card = player.handSlots[index];

    if (!card) {
      return null;
    }

    return { index, card };
  }

  function cleanCurrentChunk(player) {
    while (player.currentChunk.length) {
      const idx = player.currentChunk[player.currentChunk.length - 1];
      if (player.handSlots[idx]) {
        break;
      }
      player.currentChunk.pop();
    }
    pruneWasteHistory(player);
  }

  function pushWasteHistory(player, indices) {
    if (!Array.isArray(player.wasteHistory)) {
      player.wasteHistory = [];
    }

    for (const idx of indices) {
      const existing = player.wasteHistory.indexOf(idx);
      if (existing >= 0) {
        player.wasteHistory.splice(existing, 1);
      }
      player.wasteHistory.push(idx);
    }

    pruneWasteHistory(player);
  }

  function pruneWasteHistory(player) {
    if (!Array.isArray(player.wasteHistory)) {
      player.wasteHistory = [];
      return;
    }

    player.wasteHistory = player.wasteHistory.filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < player.handSlots.length && Boolean(player.handSlots[idx])
    );

    if (player.wasteHistory.length > 24) {
      player.wasteHistory.splice(0, player.wasteHistory.length - 24);
    }
  }

  function topNertzCard(player) {
    if (!player.nertz.length) {
      return null;
    }
    return player.nertz[player.nertz.length - 1];
  }

  function remainingHandCount(player) {
    let count = 0;
    for (const card of player.handSlots) {
      if (card) {
        count += 1;
      }
    }
    return count;
  }

  function findCenterTarget(card) {
    for (let i = 0; i < state.centerPiles.length; i += 1) {
      const pile = state.centerPiles[i];
      const top = pile[pile.length - 1];
      if (top.suit === card.suit && card.rank === top.rank + 1) {
        return i;
      }
    }

    if (card.rank === 1) {
      return "new";
    }

    return null;
  }

  function isNewCenterTarget(target) {
    return target === "new" || (typeof target === "string" && target.startsWith("new:"));
  }

  function parseRequestedNewCenterSlot(target) {
    if (!isNewCenterTarget(target)) {
      return null;
    }
    if (target === "new") {
      return null;
    }
    const raw = String(target).slice(4);
    const slot = Number(raw);
    if (!Number.isFinite(slot) || slot < 0) {
      return null;
    }
    return Math.floor(slot);
  }

  function getOccupiedCenterSlotSet() {
    return new Set(state.centerPileSlots.filter((slot) => Number.isFinite(slot)));
  }

  function getCenterSlotCount() {
    const mappedMax = state.centerPileSlots.length ? Math.max(...state.centerPileSlots) : -1;
    return Math.max(BASE_CENTER_SLOT_COUNT, mappedMax + 1);
  }

  function centerSlotCoords(slot, count) {
    const columns = Math.min(CENTER_SLOT_COLUMNS, Math.max(1, count));
    const row = Math.floor(slot / columns);
    const col = slot % columns;
    return { row, col, columns };
  }

  function centerSlotDistanceFromMiddle(slot, count) {
    const coords = centerSlotCoords(slot, count);
    const midCol = (coords.columns - 1) / 2;
    return Math.abs(coords.col - midCol) + coords.row * 0.22;
  }

  function chooseCenterSlotForNewTarget(target, isBot) {
    const occupied = getOccupiedCenterSlotSet();
    const requested = parseRequestedNewCenterSlot(target);
    if (requested !== null && !occupied.has(requested)) {
      return requested;
    }

    const count = getCenterSlotCount();
    const available = [];
    for (let slot = 0; slot < count; slot += 1) {
      if (!occupied.has(slot)) {
        available.push(slot);
      }
    }

    if (available.length > 0) {
      if (isBot) {
        available.sort((a, b) => centerSlotDistanceFromMiddle(a, count) - centerSlotDistanceFromMiddle(b, count));
        return available[0];
      }
      return available[0];
    }

    return count;
  }

  function assignCenterCardStyle(card) {
    if (!card) {
      return;
    }
    if (typeof card.centerRotation !== "number") {
      card.centerRotation = randomInt(-6, 6) + (Math.random() * 1.2 - 0.6);
    }
    if (typeof card.centerOffsetX !== "number") {
      card.centerOffsetX = randomInt(-5, 5);
    }
    if (typeof card.centerOffsetY !== "number") {
      card.centerOffsetY = randomInt(-2, 2);
    }
  }

  function centerPileIndexBySlot(slot) {
    for (let i = 0; i < state.centerPileSlots.length; i += 1) {
      if (state.centerPileSlots[i] === slot) {
        return i;
      }
    }
    return -1;
  }

  function nearestCenterTargetFromPoint(clientX, clientY) {
    const centerSurface = el.centerPiles;
    if (!centerSurface) {
      return null;
    }

    const bounds = centerSurface.getBoundingClientRect();
    if (
      clientX < bounds.left - 12 ||
      clientX > bounds.right + 12 ||
      clientY < bounds.top - 12 ||
      clientY > bounds.bottom + 12
    ) {
      return null;
    }

    const nodes = Array.from(centerSurface.querySelectorAll('[data-target="center"]'));
    if (!nodes.length) {
      return null;
    }

    let bestNode = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = node;
      }
    }

    if (!bestNode) {
      return null;
    }

    const parsed = targetFromElement(bestNode);
    if (!parsed) {
      return null;
    }

    return { ...parsed, targetEl: bestNode };
  }

  function nearestOpenCenterTargetFromPoint(clientX, clientY) {
    const centerSurface = el.centerPiles;
    if (!centerSurface) {
      return null;
    }

    const bounds = centerSurface.getBoundingClientRect();
    if (
      clientX < bounds.left - 12 ||
      clientX > bounds.right + 12 ||
      clientY < bounds.top - 12 ||
      clientY > bounds.bottom + 12
    ) {
      return null;
    }

    const nodes = Array.from(centerSurface.querySelectorAll('[data-target="center"][data-mode="new"]'));
    if (!nodes.length) {
      return null;
    }

    let bestNode = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = node;
      }
    }

    if (!bestNode) {
      return null;
    }

    const parsed = targetFromElement(bestNode);
    if (!parsed) {
      return null;
    }

    return { ...parsed, targetEl: bestNode };
  }

  function normalizeCenterDropTarget(player, source, target, clientX, clientY) {
    if (!target || target.type !== "center") {
      return target;
    }

    const picked = pickSourceCard(player, source, true);
    if (!picked) {
      return target;
    }

    if (isCenterTargetLegal(picked.card, target.centerTarget)) {
      return target;
    }

    if (picked.card.rank !== 1) {
      return target;
    }

    const openTarget = nearestOpenCenterTargetFromPoint(clientX, clientY);
    if (openTarget) {
      return openTarget;
    }

    return target;
  }

  function isCenterTargetLegal(card, target) {
    if (!card) {
      return false;
    }

    if (isNewCenterTarget(target)) {
      return card.rank === 1;
    }

    if (typeof target !== "number") {
      return false;
    }

    const pile = state.centerPiles[target];
    if (!pile || !pile.length) {
      return false;
    }

    const top = pile[pile.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
  }

  function canStackOnTableau(card, onto) {
    return cardColor(card) !== cardColor(onto) && card.rank === onto.rank - 1;
  }

  function isValidFaceUpRun(pile, startIndex) {
    for (let i = startIndex; i < pile.length; i += 1) {
      if (!pile[i].faceUp) {
        return false;
      }
    }

    for (let i = startIndex; i < pile.length - 1; i += 1) {
      const current = pile[i];
      const next = pile[i + 1];
      if (cardColor(current) === cardColor(next)) {
        return false;
      }
      if (current.rank !== next.rank + 1) {
        return false;
      }
    }

    return true;
  }

  function cardColor(card) {
    return card.suit === "H" || card.suit === "D" ? "red" : "black";
  }

  function findWinner() {
    for (const player of state.players) {
      if (player.nertz.length === 0) {
        return player;
      }
    }
    return null;
  }

  function finishRound(winner) {
    state.running = false;
    state.dealAnimating = false;
    state.awaitingReady = false;
    state.readyByPlayerId = {};
    state.dealToken += 1;
    state.winnerId = winner.id;
    state.selected = null;
    clearDragging();
    clearPendingPointer();
    clearSelectionGhost();
    clearFlyingGhosts();

    if (el.setupCard) el.setupCard.classList.remove("hidden");
    if (el.hero) el.hero.classList.remove("hidden");

    if (state.tickHandle) {
      clearInterval(state.tickHandle);
      state.tickHandle = null;
    }

    addLog(`<strong>${winner.name}</strong> emptied their Nertz pile.`);
    openEndModal(winner);
  }

  function openEndModal(winner) {
    const scored = state.players.map((player) => {
      const total = player.centerPlayed - player.nertz.length * 2;
      return {
        name: player.name,
        center: player.centerPlayed,
        nertzRemaining: player.nertz.length,
        total
      };
    });

    scored.sort((a, b) => b.total - a.total);

    el.endTitle.textContent = "Round Complete";
    el.endSubtitle.textContent = `${winner.name} ended the round by emptying their Nertz pile.`;
    el.scoreboard.innerHTML = scored
      .map(
        (row, idx) => `
          <div class="score-row">
            <span>${idx + 1}. ${row.name}</span>
            <span>${row.center} played, ${row.nertzRemaining} nertz left</span>
            <span class="score-total">${row.total}</span>
          </div>
        `
      )
      .join("");

    el.endModal.classList.remove("hidden");
  }

  function handleDelegatedClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === "draw-human") {
        event.preventDefault();
        onHumanDraw();
        return;
      }
    }

    if (!state.selected && Date.now() - state.lastDragEndAt < 220) {
      return;
    }

    const sourceEl = event.target.closest("[data-source]");
    if (sourceEl) {
      return;
    }

    const targetEl = event.target.closest("[data-target]");
    if (targetEl) {
      event.preventDefault();
      onTargetPicked(targetEl, event.clientX, event.clientY);
      return;
    }

    if (state.selected && state.running && !state.dealAnimating && !state.awaitingReady) {
      const nearest = nearestCenterTargetFromPoint(event.clientX, event.clientY);
      if (nearest && nearest.targetEl) {
        event.preventDefault();
        onTargetPicked(nearest.targetEl, event.clientX, event.clientY);
      }
    }
  }

  function onPointerDown(event) {
    if (!state.running || state.dealAnimating || state.awaitingReady || event.button !== 0) {
      return;
    }

    const sourceEl = event.target.closest("[data-source]");
    if (!sourceEl) {
      return;
    }

    const human = state.players[0];
    if (!human) {
      return;
    }

    const source = sourceFromElement(sourceEl);

    if (state.selected && !isSameSelection(state.selected, source)) {
      event.preventDefault();
      state.mouseX = event.clientX;
      state.mouseY = event.clientY;
      onSourcePicked(sourceEl);
      return;
    }

    const picked = pickSourceCard(human, source, false);
    if (!picked) {
      return;
    }

    event.preventDefault();
    clearPendingPointer();
    state.pendingPointer = {
      sourceEl,
      source,
      picked,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragStarted: false
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  }

  function beginDragging(sourceEl, source, picked, event) {
    clearDragging();
    clearSelectionGhost();

    state.selected = source;
    state.dragging = {
      source,
      pointerId: event.pointerId
    };

    state.dragOriginEl = sourceEl;
    sourceEl.classList.add("drag-origin");

    const ghost = buildDragGhost(picked);
    state.dragGhostEl = ghost;
    document.body.appendChild(ghost);
    document.body.classList.add("dragging-card");

    updateGhostPosition(event.clientX, event.clientY);
    updateDragHoverTarget(event.clientX, event.clientY);

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  }

  function onPointerMove(event) {
    if (state.pendingPointer && event.pointerId === state.pendingPointer.pointerId && !state.pendingPointer.dragStarted) {
      const dx = event.clientX - state.pendingPointer.startX;
      const dy = event.clientY - state.pendingPointer.startY;
      if (Math.hypot(dx, dy) >= 7) {
        state.pendingPointer.dragStarted = true;
        beginDragging(
          state.pendingPointer.sourceEl,
          state.pendingPointer.source,
          state.pendingPointer.picked,
          event
        );
      }
      return;
    }

    if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
      return;
    }

    event.preventDefault();
    updateGhostPosition(event.clientX, event.clientY);
    updateDragHoverTarget(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    if (state.pendingPointer && event.pointerId === state.pendingPointer.pointerId && !state.pendingPointer.dragStarted) {
      state.mouseX = event.clientX;
      state.mouseY = event.clientY;
      onSourcePicked(state.pendingPointer.sourceEl);
      clearPendingPointer();
      return;
    }

    if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
      return;
    }

    event.preventDefault();

    const human = state.players[0];
    const source = state.dragging.source;
    let target = getTargetAtPoint(event.clientX, event.clientY);
    if (human && target) {
      target = normalizeCenterDropTarget(human, source, target, event.clientX, event.clientY);
    }
    let moved = false;

    if (human && target && canMoveSourceToTarget(human, source, target)) {
      if (target.type === "center") {
        moved = applyMove(human, {
          kind: "toCenter",
          source,
          centerTarget: target.centerTarget
        });
      } else if (target.type === "tableau") {
        moved = applyMove(human, {
          kind: "toTableau",
          source,
          toPile: target.toPile
        });
      }
    }

    if (!moved && state.running) {
      announce("Move cancelled", "Drop on a valid center stack or pile.", 1200);
    }

    state.lastDragEndAt = Date.now();
    if (moved) {
      state.selected = null;
    }
    clearDragging();
    clearPendingPointer();
    render();
  }

  function onPointerCancel(event) {
    if (state.pendingPointer && event.pointerId === state.pendingPointer.pointerId) {
      clearPendingPointer();
      return;
    }

    if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
      return;
    }

    state.lastDragEndAt = Date.now();
    if (state.running) {
      announce("Move cancelled", "Drop on a valid center stack or pile.", 1200);
    }
    clearDragging();
    clearPendingPointer();
    render();
  }

  function onGlobalKeyDown(event) {
    if (!state.running || state.dealAnimating || state.awaitingReady) {
      return;
    }

    if (event.code !== "Space") {
      return;
    }

    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") {
      return;
    }

    event.preventDefault();
    onHumanDraw();
  }

  function onMouseMovePassive(event) {
    state.mouseX = event.clientX;
    state.mouseY = event.clientY;
    if (state.selectionGhostEl && !state.dragging) {
      updateSelectionGhostPosition();
    }
  }

  function onHumanDraw() {
    if (!state.running || state.dealAnimating || state.awaitingReady) {
      return;
    }

    const human = state.players[0];
    if (!human) {
      return;
    }

    const ok = applyMove(human, { kind: "draw" });
    if (!ok) {
      announce("No cards to draw", "Your hand is empty.", 1500);
    }
    render();
  }

  function onSourcePicked(sourceEl) {
    if (!state.running || state.dealAnimating || state.awaitingReady) {
      return;
    }

    const human = state.players[0];
    if (!human) {
      return;
    }

    const source = sourceFromElement(sourceEl);

    if (state.selected && !isSameSelection(state.selected, source)) {
      const targetEl = sourceEl.closest("[data-target]");
      const rawTarget = targetEl ? targetFromElement(targetEl) : null;
      const target = rawTarget
        ? normalizeCenterDropTarget(human, state.selected, rawTarget, state.mouseX, state.mouseY)
        : null;
      if (target && canMoveSourceToTarget(human, state.selected, target)) {
        let moved = false;
        if (target.type === "center") {
          moved = applyMove(human, {
            kind: "toCenter",
            source: state.selected,
            centerTarget: target.centerTarget
          });
        } else if (target.type === "tableau") {
          moved = applyMove(human, {
            kind: "toTableau",
            source: state.selected,
            toPile: target.toPile
          });
        }

        if (moved) {
          render();
          return;
        }
      }

      state.selected = null;
      clearSelectionGhost();
      announce("Selection cleared", "That click wasn't a valid placement. Re-select a source card.", 1500);
      render();
      return;
    }

    const picked = pickSourceCard(human, source, false);
    if (!picked) {
      announce("Not playable", "That card section is not currently playable.", 1500);
      render();
      return;
    }

    if (isSameSelection(state.selected, source)) {
      state.selected = null;
      clearSelectionGhost();
      announce("Selection cleared", "Pick another source card.", 1200);
    } else {
      state.selected = source;
      syncSelectionGhost();
      announce("Card selected", "Click a destination pile or center stack, or drag.", 1400);
    }

    render();
  }

  function onTargetPicked(targetEl, clientX = state.mouseX, clientY = state.mouseY) {
    if (!state.running || state.dealAnimating || state.awaitingReady || !state.selected) {
      return;
    }

    const human = state.players[0];
    if (!human) {
      return;
    }

    const target = targetFromElement(targetEl);
    if (!target) {
      return;
    }
    const normalizedTarget = normalizeCenterDropTarget(human, state.selected, target, clientX, clientY);

    let ok = false;

    if (normalizedTarget.type === "center") {
      ok = applyMove(human, {
        kind: "toCenter",
        source: state.selected,
        centerTarget: normalizedTarget.centerTarget
      });
    } else if (normalizedTarget.type === "tableau") {
      ok = applyMove(human, {
        kind: "toTableau",
        source: state.selected,
        toPile: normalizedTarget.toPile
      });
    }

    if (!ok) {
      state.selected = null;
      clearSelectionGhost();
      announce("Illegal destination", "That move is not allowed by your current rules.", 1800);
    }

    render();
  }

  function sourceFromElement(sourceEl) {
    const source = {
      type: sourceEl.dataset.source
    };

    if (source.type === "tableau") {
      source.pile = Number(sourceEl.dataset.pile);
      source.index = Number(sourceEl.dataset.index);
    }

    return source;
  }

  function targetFromElement(targetEl) {
    const type = targetEl.dataset.target;
    if (type === "center") {
      const mode = targetEl.dataset.mode;
      const slot = targetEl.dataset.slot;
      return {
        type: "center",
        centerTarget: mode === "new" ? (slot !== undefined ? `new:${Number(slot)}` : "new") : Number(targetEl.dataset.index)
      };
    }

    if (type === "tableau") {
      return {
        type: "tableau",
        toPile: Number(targetEl.dataset.index)
      };
    }

    return null;
  }

  function buildDragGhost(picked) {
    const run = picked.run || [picked.card];
    const container = document.createElement("div");
    container.className = "drag-ghost";
    container.style.height = `calc(var(--card-h) + ${(run.length - 1) * 20}px)`;
    container.style.width = `calc(var(--card-w) + 6px)`;
    container.innerHTML = buildGhostMarkup(run);
    return container;
  }

  function buildGhostMarkup(run) {
    return run
      .map((card, idx) => {
        return `<div class="drag-ghost-card" style="top:${idx * 20}px;left:${idx > 0 ? 2 : 0}px;">${renderCard(card, { faceUp: true })}</div>`;
      })
      .join("");
  }

  function updateGhostPosition(clientX, clientY) {
    if (!state.dragGhostEl) {
      return;
    }
    state.dragGhostEl.style.left = `${clientX}px`;
    state.dragGhostEl.style.top = `${clientY}px`;
  }

  function getTargetAtPoint(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const targetEl = hit ? hit.closest("[data-target]") : null;
    if (!targetEl) {
      return nearestCenterTargetFromPoint(clientX, clientY);
    }

    const parsed = targetFromElement(targetEl);
    if (!parsed) {
      return null;
    }

    return { ...parsed, targetEl };
  }

  function updateDragHoverTarget(clientX, clientY) {
    if (!state.dragging) {
      setHoveredTargetEl(null);
      return;
    }

    const human = state.players[0];
    const target = getTargetAtPoint(clientX, clientY);
    if (!human || !target) {
      setHoveredTargetEl(null);
      return;
    }

    const legal = canMoveSourceToTarget(human, state.dragging.source, target);
    setHoveredTargetEl(legal ? target.targetEl : null);
  }

  function setHoveredTargetEl(targetEl) {
    if (state.hoveredTargetEl === targetEl) {
      return;
    }
    state.hoveredTargetEl = targetEl || null;
  }

  function canMoveSourceToTarget(player, source, target) {
    if (!source || !target) {
      return false;
    }

    if (target.type === "center") {
      const picked = pickSourceCard(player, source, true);
      if (!picked) {
        return false;
      }
      return isCenterTargetLegal(picked.card, target.centerTarget);
    }

    if (target.type === "tableau") {
      const picked = pickSourceCard(player, source, false);
      if (!picked) {
        return false;
      }

      if (target.toPile < 0 || target.toPile >= player.tableau.length) {
        return false;
      }

      if (picked.source.type === "tableau" && picked.source.pile === target.toPile) {
        return false;
      }

      const destination = player.tableau[target.toPile];
      const firstCard = picked.run[0];

      if (destination.length === 0) {
        return picked.source.type === "nertz" || picked.source.type === "tableau";
      }

      return canStackOnTableau(firstCard, destination[destination.length - 1]);
    }

    return false;
  }

  function clearDragging() {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);

    if (state.dragOriginEl) {
      state.dragOriginEl.classList.remove("drag-origin");
    }
    state.dragOriginEl = null;

    if (state.dragGhostEl) {
      state.dragGhostEl.remove();
    }
    state.dragGhostEl = null;

    setHoveredTargetEl(null);
    state.dragging = null;
    document.body.classList.remove("dragging-card");
  }

  function clearPendingPointer() {
    state.pendingPointer = null;
    if (!state.dragging) {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    }
  }

  function clearSelectionGhost() {
    if (state.selectionGhostEl) {
      state.selectionGhostEl.remove();
    }
    state.selectionGhostEl = null;
    state.selectionGhostKey = null;
  }

  function updateSelectionGhostPosition() {
    if (!state.selectionGhostEl) {
      return;
    }
    state.selectionGhostEl.style.left = `${state.mouseX}px`;
    state.selectionGhostEl.style.top = `${state.mouseY}px`;
  }

  function syncSelectionGhost() {
    if (!state.running || !state.selected || state.dragging) {
      clearSelectionGhost();
      return;
    }

    const human = state.players[0];
    const picked = human ? pickSourceCard(human, state.selected, false) : null;
    if (!picked) {
      clearSelectionGhost();
      return;
    }

    const key = `${picked.source.type}:${picked.source.pile ?? "-"}:${picked.source.index ?? "-"}:${picked.run.length}`;
    if (!state.selectionGhostEl || state.selectionGhostKey !== key) {
      clearSelectionGhost();
      const ghost = document.createElement("div");
      ghost.className = "selection-ghost";
      ghost.style.height = `calc(var(--card-h) + ${(picked.run.length - 1) * 20}px)`;
      ghost.style.width = `calc(var(--card-w) + 6px)`;
      ghost.innerHTML = buildGhostMarkup(picked.run);
      document.body.appendChild(ghost);
      state.selectionGhostEl = ghost;
      state.selectionGhostKey = key;
    }

    updateSelectionGhostPosition();
  }

  function render() {
    renderStatus();
    renderReadyOverlay();
    renderBots();
    renderCenter();
    renderHumanArea();
    renderLog();
    syncSelectionGhost();
    if (el.forceReshuffleBtn) {
      const totalNertz = state.players.reduce((s, p) => s + p.nertz.length, 0);
      const initialNertz = 13 * state.players.length;
      const fraction = initialNertz > 0 ? totalNertz / initialNertz : 1;
      const threshold = Math.round(30000 + fraction * (120000 - 30000));
      const lastAct = state.lastActivityAt ?? state.lastNertzPlayAt;
      const show = state.running && !state.dealAnimating && !state.awaitingReady &&
        lastAct != null && Date.now() - lastAct > threshold;
      el.forceReshuffleBtn.style.display = show ? "block" : "none";
    }
  }

  function renderStatus() {
    if (!el.statusTitle || !el.statusText) {
      return;
    }

    let title = "Ready to play";
    let text = "Pick settings, then start a match.";

    if (state.alert && Date.now() <= state.alert.expiresAt) {
      title = state.alert.title;
      text = state.alert.text;
    } else if (state.running && state.awaitingReady) {
      title = "Ready check";
      text = "Click to indicate ready.";
    } else if (state.running) {
      title = "Playing";
      text = "Drag a source card to center/piles. Invalid drops snap back. First empty Nertz pile ends the round.";
    } else if (state.winnerId !== null) {
      const winner = state.players.find((p) => p.id === state.winnerId);
      title = "Round complete";
      text = `${winner ? winner.name : "A player"} emptied their Nertz pile.`;
    }

    el.statusTitle.textContent = title;
    el.statusText.textContent = text;

    const human = state.players[0];
    if (human) {
      el.metricCenter.textContent = `Center: ${human.centerPlayed}`;
      el.metricNertz.textContent = `Nertz Left: ${human.nertz.length}`;
    } else {
      el.metricCenter.textContent = "Center: 0";
      el.metricNertz.textContent = "Nertz Left: 13";
    }

    if (state.selected && human) {
      const picked = pickSourceCard(human, state.selected, false);
      if (picked) {
        el.selectedPill.textContent = `Selected ${formatCard(picked.card)} from ${labelForSource(state.selected)}.`;
        el.selectedPill.classList.remove("hidden");
      } else {
        el.selectedPill.classList.add("hidden");
      }
    } else {
      el.selectedPill.classList.add("hidden");
    }
  }

  function renderBots() {
    const bots = state.players.filter((p) => !p.isHuman);
    el.botRow.style.gridTemplateColumns = bots.length > 1 ? `repeat(${bots.length}, minmax(0, 1fr))` : "1fr";

    el.botRow.innerHTML = bots
      .map((bot) => {
        const topNertz = topNertzCard(bot);
        const wasteTop = getWasteTop(bot);
        const handLeft = remainingHandCount(bot);
        const botBack = cardBackStyle(bot.cardBack);
        const visibleNertz = getVisibleNertzVisual(bot);

        const stockHtml = handLeft > 0
          ? `
              <div class="bot-stock-stack">
                ${renderCard({ faceUp: false }, { faceUp: false, small: true, backStyle: botBack })}
                ${renderCard({ faceUp: false }, { faceUp: false, small: true, backStyle: botBack })}
                ${renderCard({ faceUp: false }, { faceUp: false, small: true, backStyle: botBack })}
              </div>
            `
          : '<div class="ghost-slot small"></div>';

        const wasteHtml = wasteTop
          ? `
              <div class="bot-source-card" data-bot-source="waste" data-player-id="${bot.id}">
                ${renderCard(wasteTop.card, { small: true, faceUp: true })}
              </div>
            `
          : '<div class="ghost-slot small"></div>';

        const nertzBack = visibleNertz > 1
          ? `<div style="position:absolute;top:3px;left:3px;z-index:0;">${renderCard({ faceUp: false }, { faceUp: false, small: true, backStyle: botBack })}</div>`
          : "";
        const nertzHtml = topNertz && visibleNertz > 0
          ? `
              <div class="bot-source-card" data-bot-source="nertz" data-player-id="${bot.id}">
                ${renderCard(topNertz, { small: true, faceUp: true })}
              </div>
            `
          : '<div class="ghost-slot small"></div>';

        const pilesHtml = bot.tableau
          .map((pile, pileIdx) => {
            const visibleCount = getVisiblePileCount(bot, pileIdx);
            const visiblePile = pile.slice(0, visibleCount);
            const cards = visiblePile.length
              ? visiblePile
                  .map((card, cardIdx) => {
                    const sourceAttrs = card.faceUp
                      ? `data-bot-source="tableau" data-player-id="${bot.id}" data-pile="${pileIdx}" data-index="${cardIdx}"`
                      : "";
                    return `
                      <div class="bot-tableau-card" style="top:${cardIdx * BOT_PILE_STEP}px;z-index:${cardIdx + 1};" ${sourceAttrs}>
                        ${renderCard(card, { faceUp: card.faceUp, small: true, backStyle: botBack })}
                      </div>
                    `;
                  })
                  .join("")
              : '<div class="ghost-slot small"></div>';

            return `
              <div class="bot-lane bot-tableau-lane" data-bot-target="tableau" data-player-id="${bot.id}" data-zone="pile" data-pile="${pileIdx}">
                <div class="bot-pile-stack">${cards}</div>
              </div>
            `;
          })
          .join("");

        return `
          <article class="bot-seat" data-player-id="${bot.id}">
            <div class="bot-head">
              <span class="bot-name">${bot.name}</span>
              <span class="bot-meta">${bot.isNetworkPlayer ? "Online" : capitalize(bot.difficulty)}</span>
            </div>
            <div class="bot-play-strip">
              <div class="bot-lane bot-draw-lane" data-player-id="${bot.id}" data-zone="draw">
                <div class="bot-draw-row">
                  ${stockHtml}
                  <div class="bot-waste-stack">${wasteHtml}</div>
                </div>
              </div>

              <div class="bot-lane bot-nertz-lane" data-player-id="${bot.id}" data-zone="nertz">
                <div class="bot-pile-stack">
                  <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);">${nertzBack}${nertzHtml}</div>
                </div>
              </div>

              ${pilesHtml}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderCenter() {
    const slotCount = getCenterSlotCount();
    const slots = [];
    for (let slot = 0; slot < slotCount; slot += 1) {
      if (state.completedCenterSlots.has(slot)) {
        continue;
      }
      const pileIdx = centerPileIndexBySlot(slot);
      if (pileIdx >= 0) {
        const pile = state.centerPiles[pileIdx];
        slots.push(`
          <div class="center-pile">
            <div class="center-target center-stack-target" data-target="center" data-index="${pileIdx}" data-mode="existing" data-slot="${slot}">
              ${renderCenterPileStack(pile)}
            </div>
          </div>
        `);
      } else {
        slots.push(`
          <div class="center-pile">
            <div class="center-slot center-empty-slot" data-target="center" data-mode="new" data-slot="${slot}"></div>
          </div>
        `);
      }
    }

    el.centerPiles.innerHTML = slots.join("");
  }

  function renderCenterPileStack(pile) {
    const shown = pile.slice(-4);
    const layers = shown
      .map((card, idx) => {
        const offsetY = idx * 2 + (card.centerOffsetY || 0);
        const offsetX = card.centerOffsetX || 0;
        const rotation = card.centerRotation || 0;
        const z = 4 + idx;
        return `
          <div class="center-card-layer" style="z-index:${z};left:50%;top:${offsetY}px;transform:translateX(calc(-50% + ${offsetX}px)) rotate(${rotation}deg);">
            ${renderCard(card, { faceUp: true })}
          </div>
        `;
      })
      .join("");

    return `<div class="center-stack-cards">${layers}</div>`;
  }

  function renderHumanArea() {
    const human = state.players[0];
    if (!human) {
      el.nertzSpot.innerHTML = "";
      el.drawSpot.innerHTML = "";
      el.tableau.innerHTML = "";
      return;
    }

    const topNertz = topNertzCard(human);
    const visibleNertz = getVisibleNertzVisual(human);
    el.nertzSpot.innerHTML = "";
    el.drawSpot.innerHTML = "";

    const wasteCards = getWasteCardsForRender(human);
    const wasteHtml = wasteCards.length
      ? wasteCards
          .map((entry, idx) => {
            const isPlayable = entry.isPlayable;
            const selected = isPlayable && isSameSelection(state.selected, { type: "waste" });
            const cardMarkup = renderCard(entry.card, {
              faceUp: true,
              selected,
              small: false
            });

            return `
              <div class="${isPlayable ? "source-card" : ""}" style="position:absolute;left:${idx * WASTE_SPREAD_STEP}px;top:0;z-index:${10 + idx};" ${isPlayable ? 'data-source="waste"' : ""}>
                ${cardMarkup}
              </div>
            `;
          })
          .join("")
      : '<div class="ghost-slot"></div>';

    const stockCards = remainingHandCount(human) > 0
      ? `
          <div class="card face-down"></div>
          <div class="card face-down"></div>
          <div class="card face-down"></div>
        `
      : '<div class="ghost-slot"></div>';

    const drawLane = `
      <div class="tableau-pile draw-lane" data-player-id="${human.id}" data-zone="draw">
        <div class="pile-label">Draw <span style="font-size:0.8em;opacity:0.55;text-transform:none;letter-spacing:0;">(space)</span></div>
        <div class="draw-lane-row">
          <button type="button" class="stock-pile" data-action="draw-human" aria-label="Flip 3 cards">
            ${stockCards}
          </button>
          <div class="waste-stack">
            ${wasteHtml}
          </div>
        </div>
      </div>
    `;

    const nertzLane = (() => {
      const nertzCard = topNertz && visibleNertz > 0
        ? `<div class="source-card" data-source="nertz">${renderCard(topNertz, { faceUp: true, selected: isSameSelection(state.selected, { type: "nertz" }) })}</div>`
        : '<div class="ghost-slot"></div>';
      const nertzBack = visibleNertz > 1
        ? `<div class="card face-down" style="position:absolute;top:4px;left:4px;z-index:0"></div>`
        : "";
      return `
        <div class="tableau-pile nertz-lane" data-player-id="${human.id}" data-zone="nertz">
          <div class="pile-label">Nertz</div>
          <div class="pile-stack" style="min-height:var(--card-h);">
            <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);">${nertzBack}${nertzCard}</div>
          </div>
        </div>
      `;
    })();

    const tableauLanes = human.tableau
      .map((pile, pileIdx) => {
        const visibleCount = getVisiblePileCount(human, pileIdx);
        const visiblePile = pile.slice(0, visibleCount);
        const selectedStart =
          state.selected && state.selected.type === "tableau" && Number(state.selected.pile) === pileIdx
            ? Number(state.selected.index)
            : -1;

        const cards = visiblePile.length
          ? visiblePile
              .map((card, cardIdx) => {
                const isFaceUp = card.faceUp;
                const sourceAttrs = isFaceUp
                  ? `data-source="tableau" data-pile="${pileIdx}" data-index="${cardIdx}"`
                  : "";

                const selected =
                  selectedStart >= 0 && isFaceUp && cardIdx >= selectedStart;

                return `
                  <div class="tableau-card ${isFaceUp ? "source-card" : ""}" style="top:${cardIdx * HUMAN_PILE_STEP}px; z-index:${cardIdx + 1};" ${sourceAttrs}>
                    ${renderCard(card, { faceUp: isFaceUp, selected })}
                  </div>
                `;
              })
              .join("")
          : '<div class="ghost-slot"></div>';

        return `
          <div class="tableau-pile" data-target="tableau" data-index="${pileIdx}" data-player-id="${human.id}" data-zone="pile" data-pile="${pileIdx}">
            <div class="pile-label">Pile ${pileIdx + 1}</div>
            <div class="pile-stack">${cards}</div>
          </div>
        `;
      })
      .join("");

    el.tableau.innerHTML = drawLane + nertzLane + tableauLanes;
  }

  function getWasteCardsForRender(player) {
    cleanCurrentChunk(player);
    const top = getWasteTop(player);
    const cards = [];
    const visible = player.wasteHistory.slice(-MAX_WASTE_VISIBLE);
    for (const idx of visible) {
      const card = player.handSlots[idx];
      if (card) {
        cards.push({ index: idx, card, isPlayable: Boolean(top && top.index === idx) });
      }
    }
    return cards;
  }

  function canSelectedMoveToTableau(player, toPileIndex) {
    if (!state.selected) {
      return false;
    }

    const picked = pickSourceCard(player, state.selected, false);
    if (!picked) {
      return false;
    }

    if (picked.source.type === "tableau" && picked.source.pile === toPileIndex) {
      return false;
    }

    const dest = player.tableau[toPileIndex];
    const firstCard = picked.run[0];

    if (dest.length === 0) {
      return picked.source.type === "nertz" || picked.source.type === "tableau";
    }

    if (picked.run.length !== 1) {
      return false;
    }

    return canStackOnTableau(firstCard, dest[dest.length - 1]);
  }

  function renderLog() {
    el.actionLog.innerHTML = state.logs
      .slice(0, LOG_LIMIT)
      .map((line) => `<li>${line}</li>`)
      .join("");
  }

  function renderCard(card, options = {}) {
    const faceUp = options.faceUp ?? card.faceUp;
    const sizeClass = options.small ? " small" : "";

    if (!faceUp) {
      const style = options.backStyle ? ` style="${options.backStyle}"` : "";
      return `<div class="card face-down${sizeClass}"${style}></div>`;
    }

    const colorClass = cardColor(card);
    const selectedClass = options.selected ? " selected" : "";
    const rank = RANK_LABEL[card.rank];
    const suit = SUIT_SYMBOL[card.suit];
    return `
      <div class="card face-up ${colorClass}${sizeClass}${selectedClass}">
        <span class="corner">${rank}${suit}</span>
        <span class="pip">${suit}</span>
        <span class="corner-bottom">${rank}${suit}</span>
      </div>
    `;
  }

  function formatCard(card) {
    return `${RANK_LABEL[card.rank]}${SUIT_SYMBOL[card.suit]}`;
  }

  function labelForSource(source) {
    if (!source) {
      return "Unknown";
    }

    if (source.type === "nertz") {
      return "Nertz";
    }

    if (source.type === "waste") {
      return "Waste";
    }

    if (source.type === "tableau") {
      return `Pile ${Number(source.pile) + 1}`;
    }

    return "Source";
  }

  function isSameSelection(a, b) {
    if (!a || !b) {
      return false;
    }

    return (
      a.type === b.type &&
      Number(a.pile ?? -1) === Number(b.pile ?? -1) &&
      Number(a.index ?? -1) === Number(b.index ?? -1)
    );
  }

  function addLog(line) {
    state.logs.unshift(line);
    if (state.logs.length > LOG_LIMIT) {
      state.logs.pop();
    }
  }

  function announce(title, text, ttlMs = 1800) {
    state.alert = {
      title,
      text,
      expiresAt: Date.now() + ttlMs
    };
  }

  function sample(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeDifficulty(value) {
    if (value === "easy" || value === "medium" || value === "hard") {
      return value;
    }
    return "medium";
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  init();
})();
