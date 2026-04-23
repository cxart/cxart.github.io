(() => {
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function svgDataUri(svg) {
    return `url("data:image/svg+xml,${svg.replace(/#/g, "%23")}")`;
  }

  const PATTERNS = [
    {
      id: "weave",
      label: "Weave",
      pattern: c2 => `repeating-linear-gradient(45deg,${hexToRgba(c2,.70)} 0 8px,${hexToRgba(c2,.12)} 8px 16px)`
    },
    {
      id: "dots",
      label: "Dots",
      pattern: c2 => {
        const fill = hexToRgba(c2, .82);
        const cols = [12, 30, 48];
        const rows = [11, 27, 42, 57, 73];
        const circles = rows.flatMap(cy => cols.map(cx =>
          `<circle cx='${cx}' cy='${cy}' r='2.5' fill='${fill}'/>`
        )).join('');
        return svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 84'>${circles}</svg>`);
      },
      size: "100% 100%"
    },
    {
      id: "grid",
      label: "Grid",
      pattern: c2 =>
        `repeating-linear-gradient(90deg,${hexToRgba(c2,.55)} 0 1px,transparent 1px 10px),` +
        `repeating-linear-gradient(0deg,${hexToRgba(c2,.55)} 0 1px,transparent 1px 10px)`
    },
    {
      id: "spiral",
      label: "Spiral",
      pattern: c2 => svgDataUri(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 84'>` +
        `<path d='M5,3 L55,3 L55,81 L5,81 L5,11 L49,11 L49,73 L11,73 L11,19 L43,19 L43,65 L17,65 L17,27 L37,27 L37,57 L23,57 L23,35 L31,35 L31,49' ` +
        `fill='none' stroke='${hexToRgba(c2,.72)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>`
      ),
      size: "100% 100%"
    },
    {
      id: "hex",
      label: "Hex",
      pattern: c2 =>
        `repeating-linear-gradient(60deg,${hexToRgba(c2,.55)} 0 1px,transparent 1px 8px),` +
        `repeating-linear-gradient(-60deg,${hexToRgba(c2,.50)} 0 1px,transparent 1px 8px)`
    },
    {
      id: "diamond",
      label: "Diamond",
      pattern: c2 => {
        const s = hexToRgba(c2, .75);
        return svgDataUri(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 84'>` +
          `<polygon points='30,8 54,42 30,76 6,42' fill='none' stroke='${s}' stroke-width='2.5' stroke-linejoin='round'/>` +
          `<rect x='9' y='9' width='6' height='6' rx='2' fill='${s}'/>` +
          `<rect x='45' y='9' width='6' height='6' rx='2' fill='${s}'/>` +
          `<rect x='9' y='69' width='6' height='6' rx='2' fill='${s}'/>` +
          `<rect x='45' y='69' width='6' height='6' rx='2' fill='${s}'/>` +
          `</svg>`
        );
      },
      size: "100% 100%"
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
    el.patternGrid.querySelectorAll(".pattern-swatch").forEach(wrap => {
      const id = wrap.dataset.id;
      const pDef = getPatternDef(id);
      const card = wrap.querySelector(".swatch-card");
      card.style.setProperty("--swatch-ring", state.color2);
      card.style.setProperty("--swatch-inner", state.color1);
      card.style.setProperty("--swatch-pattern", pDef.pattern(state.color2));
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
    el.previewCard.style.setProperty("--preview-bg", state.color2);
    el.previewCard.style.setProperty("--preview-inner", state.color1);
    el.previewCard.style.setProperty("--preview-pattern", pDef.pattern(state.color2));
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
