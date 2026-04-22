(() => {
  const PATTERNS = [
    {
      id: "weave",
      label: "Weave",
      pattern: "repeating-linear-gradient(45deg,rgba(255,255,255,.16) 0 8px,rgba(255,255,255,.03) 8px 16px)"
    },
    {
      id: "dots",
      label: "Dots",
      pattern:
        "radial-gradient(circle at 50% 50%,rgba(255,255,255,.22) 0 3px,transparent 3px 12px)," +
        "radial-gradient(circle at 0 0,rgba(255,255,255,.12) 0 3px,transparent 4px 10px)",
      size: "20px 20px"
    },
    {
      id: "grid",
      label: "Grid",
      pattern:
        "repeating-linear-gradient(90deg,rgba(255,255,255,.1) 0 1px,transparent 1px 10px)," +
        "repeating-linear-gradient(0deg,rgba(255,255,255,.1) 0 1px,transparent 1px 10px)"
    },
    {
      id: "stars",
      label: "Stars",
      pattern:
        "radial-gradient(circle at center,rgba(255,255,255,.2) 0 2px,transparent 2px 12px)," +
        "conic-gradient(from 20deg,rgba(255,255,255,.14),transparent 40%,rgba(255,255,255,.14))",
      size: "20px 20px"
    },
    {
      id: "hex",
      label: "Hex",
      pattern:
        "repeating-linear-gradient(60deg,rgba(255,255,255,.12) 0 1px,transparent 1px 8px)," +
        "repeating-linear-gradient(-60deg,rgba(255,255,255,.1) 0 1px,transparent 1px 8px)"
    },
    {
      id: "diamond",
      label: "Diamond",
      pattern:
        "repeating-linear-gradient(45deg,rgba(255,255,255,.15) 0 1px,transparent 1px 14px)," +
        "repeating-linear-gradient(-45deg,rgba(255,255,255,.15) 0 1px,transparent 1px 14px)"
    }
  ];

  const PRIMARY_COLORS = [
    { hex: "#6e1520", name: "Deep Crimson" },
    { hex: "#5c1515", name: "Maroon" },
    { hex: "#4a1555", name: "Deep Plum" },
    { hex: "#1a1e48", name: "Midnight" },
    { hex: "#0e1c38", name: "Dark Navy" },
    { hex: "#0d3848", name: "Deep Teal" },
    { hex: "#0d3020", name: "Dark Forest" },
    { hex: "#1a3518", name: "Hunter Green" },
    { hex: "#5a2e0e", name: "Dark Copper" },
    { hex: "#38180a", name: "Espresso" },
    { hex: "#252528", name: "Charcoal" },
    { hex: "#3a2a10", name: "Dark Ochre" }
  ];

  const SECONDARY_COLORS = [
    { hex: "#b03040", name: "Crimson" },
    { hex: "#c04530", name: "Terracotta" },
    { hex: "#c08825", name: "Amber" },
    { hex: "#b8a820", name: "Gold" },
    { hex: "#359060", name: "Emerald" },
    { hex: "#258898", name: "Teal" },
    { hex: "#3858b8", name: "Cobalt" },
    { hex: "#5865c0", name: "Periwinkle" },
    { hex: "#8845b0", name: "Violet" },
    { hex: "#b04080", name: "Rose" },
    { hex: "#4878a8", name: "Steel Blue" },
    { hex: "#c0601a", name: "Burnt Orange" }
  ];

  const STORAGE_KEY = "nertz_cardback";
  const DEFAULTS = { pattern: "weave", color1: "#6e1520", color2: "#b03040" };

  let state = { ...DEFAULTS };

  const el = {
    patternGrid: document.getElementById("pattern-grid"),
    primaryPalette: document.getElementById("primary-palette"),
    secondaryPalette: document.getElementById("secondary-palette"),
    previewCard: document.getElementById("preview-card")
  };

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) state = { ...DEFAULTS, ...JSON.parse(saved) };
    } catch (e) {}
  }

  function getPatternDef(id) {
    return PATTERNS.find(p => p.id === id) || PATTERNS[0];
  }

  function bgGradient(c1, c2) {
    return `linear-gradient(140deg,${c1},${c2})`;
  }

  /* ── Pattern swatches ── */
  function buildSwatches() {
    el.patternGrid.innerHTML = "";
    PATTERNS.forEach(p => {
      const wrap = document.createElement("div");
      wrap.className = "pattern-swatch";
      wrap.dataset.id = p.id;

      const card = document.createElement("div");
      card.className = "swatch-card";

      const label = document.createElement("span");
      label.className = "swatch-label";
      label.textContent = p.label;

      wrap.appendChild(card);
      wrap.appendChild(label);
      wrap.addEventListener("click", () => {
        state.pattern = p.id;
        updateAll();
      });
      el.patternGrid.appendChild(wrap);
    });
  }

  function updateSwatches() {
    const bg = bgGradient(state.color1, state.color2);
    el.patternGrid.querySelectorAll(".pattern-swatch").forEach(wrap => {
      const id = wrap.dataset.id;
      const pDef = getPatternDef(id);
      const card = wrap.querySelector(".swatch-card");
      card.style.setProperty("--swatch-bg", bg);
      card.style.setProperty("--swatch-pattern", pDef.pattern);
      card.style.setProperty("--swatch-size", pDef.size || "auto");
      wrap.classList.toggle("selected", id === state.pattern);
    });
  }

  /* ── Color palettes ── */
  function buildPalette(container, colors, key) {
    container.innerHTML = "";
    colors.forEach(({ hex, name }) => {
      const btn = document.createElement("button");
      btn.className = "color-swatch";
      btn.style.background = hex;
      btn.title = name;
      btn.setAttribute("aria-label", name);
      btn.dataset.hex = hex;
      btn.addEventListener("click", () => {
        state[key] = hex;
        updateAll();
      });
      container.appendChild(btn);
    });
  }

  function updatePalettes() {
    el.primaryPalette.querySelectorAll(".color-swatch").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.hex === state.color1);
    });
    el.secondaryPalette.querySelectorAll(".color-swatch").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.hex === state.color2);
    });
  }

  /* ── Preview ── */
  function updatePreview() {
    const pDef = getPatternDef(state.pattern);
    el.previewCard.style.setProperty("--preview-bg", bgGradient(state.color1, state.color2));
    el.previewCard.style.setProperty("--preview-pattern", pDef.pattern);
    el.previewCard.style.setProperty("--preview-size", pDef.size || "auto");
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function updateAll() {
    updateSwatches();
    updatePalettes();
    updatePreview();
    save();
  }

  function init() {
    load();
    buildSwatches();
    buildPalette(el.primaryPalette, PRIMARY_COLORS, "color1");
    buildPalette(el.secondaryPalette, SECONDARY_COLORS, "color2");
    updateAll();
  }

  init();
})();
