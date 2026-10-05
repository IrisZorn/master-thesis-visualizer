import { clamp } from "./viewer-helpers.1421b95f.js";

export class Toggle {
  constructor(value = true) {
    this._value = !!value;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = !!value;
  }
}

// matches the native range input's own min/max mapping ((value - min) / (max - min)) -- the
// input's min is startTime, not 0 (see visualize.js), so a marker's position has to account for
// that same offset or it lands to the right of where the thumb actually sits at that timestamp.
function sliderPercent(time, startTime, maxTime) {
  if (!maxTime || maxTime === startTime) return 0;
  return clamp(((time - startTime) / (maxTime - startTime)) * 100, 0, 100);
}

// a floating panel over the map (position: e.g. { left: "10px" }) whose bold header row collapses
// and expands its body. Returns both, so the caller fills the body.
export function createCollapsiblePanel(title, position) {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "absolute",
    top: "10px",
    background: "white",
    border: "1px solid #ccc",
    borderRadius: "4px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
    padding: "6px 8px",
    fontFamily: "sans-serif",
    fontSize: "13px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    zIndex: "1000",
    ...position,
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    cursor: "pointer",
    userSelect: "none",
    fontWeight: "bold",
  });

  const titleEl = document.createElement("div");
  titleEl.textContent = title;

  const arrow = document.createElement("div");
  arrow.textContent = "▾"; // flips to ▸ when collapsed
  arrow.style.fontSize = "12px";

  header.append(titleEl, arrow);

  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "6px";

  let collapsed = false;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "flex";
    arrow.textContent = collapsed ? "▸" : "▾";
  });

  panel.append(header, body);
  return { panel, body };
}

export function makeLegendGlyph(spriteUrl, backgroundColor, borderColor = "white") {
  const glyph = document.createElement("div");
  glyph.style.width = "28px";
  glyph.style.height = "34px";
  glyph.style.borderRadius = "6px";
  glyph.style.border = `1px solid ${borderColor}`;
  glyph.style.boxSizing = "border-box";
  glyph.style.background = backgroundColor;
  glyph.style.overflow = "hidden";
  glyph.style.display = "flex";
  glyph.style.alignItems = "center";
  glyph.style.justifyContent = "center";

  const inner = document.createElement("div");
  inner.style.width = "calc(100% - 8px)";
  inner.style.height = "calc(100% - 8px)";
  inner.style.borderRadius = "4px";
  inner.style.overflow = "hidden";
  inner.style.background = "rgba(255,255,255,0.16)";
  inner.style.display = "flex";
  inner.style.alignItems = "center";
  inner.style.justifyContent = "center";

  const img = document.createElement("img");
  img.src = spriteUrl;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.style.display = "block";

  inner.appendChild(img);
  glyph.appendChild(inner);
  return glyph;
}

// a continuous field has no single representative color, so its legend entry shows the whole
// ramp rather than one swatch or a sprite
export function makeLegendGradientGlyph(colors, borderColor = "#666") {
  const glyph = document.createElement("div");
  glyph.style.width = "28px";
  glyph.style.height = "16px";
  glyph.style.borderRadius = "3px";
  glyph.style.border = `1px solid ${borderColor}`;
  glyph.style.boxSizing = "border-box";
  glyph.style.background = `linear-gradient(to right, ${colors.join(", ")})`;
  return glyph;
}

// one thick horizontal stripe per color, stacked top to bottom -- for a layer drawn as several
// differently colored paths (e.g. the cup/mug aggregate routes), where a gradient would blend them
export function makeLegendStripesGlyph(colors) {
  const glyph = document.createElement("div");
  Object.assign(glyph.style, {
    width: "28px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  });
  for (const color of colors) {
    const stripe = document.createElement("div");
    Object.assign(stripe.style, {
      height: "6px",
      borderRadius: "3px",
      background: color,
    });
    glyph.appendChild(stripe);
  }
  return glyph;
}

// mirrors the on-map bullet-direction arrows: a short line ending in a triangular head
export function makeLegendArrowGlyph(color) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 28 16");

  const line = document.createElementNS(NS, "line");
  line.setAttribute("x1", "3");
  line.setAttribute("y1", "8");
  line.setAttribute("x2", "18");
  line.setAttribute("y2", "8");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "4");
  line.setAttribute("stroke-linecap", "round");

  const head = document.createElementNS(NS, "path");
  head.setAttribute("d", "M 16 2 L 27 8 L 16 14 z");
  head.setAttribute("fill", color);

  svg.append(line, head);
  return svg;
}

export function createSliderMarkers({
  sliderMarkers,
  startTime,
  maxTime,
  showDeath,
  showHit,
  cupDeath,
  mugDeath,
  cupHit,
  mugHit,
  deathSprites,
  hitSprites,
}) {
  const players = [
    { label: "C", color: "#d62828", lane: 1, deaths: cupDeath, hits: cupHit },
    { label: "M", color: "#2563eb", lane: 0, deaths: mugDeath, hits: mugHit },
  ];

  return function setSliderMarkers() {
    const markers = new Map();

    function upsertMarker({ t, label, lane, color, kind, sprite, overlaySprite = null }) {
      const key = `${label}:${t}`;
      const existing = markers.get(key);
      if (!existing) {
        markers.set(key, { t, label, lane, color, kind, sprite, overlaySprite });
        return;
      }

      if (kind === "death") {
        existing.kind = existing.kind === "hit" ? "hit + death" : "death";
        existing.overlaySprite = sprite;
        return;
      }

      existing.kind = existing.kind === "death" ? "hit + death" : "hit";
      existing.sprite = sprite;
    }

    function addMarkers(kind, sprites, pointsOf) {
      for (const player of players) {
        for (const point of pointsOf(player)) {
          if (!point || point[2] == null) continue;
          upsertMarker({ t: point[2], label: player.label, kind, color: player.color, sprite: sprites[player.label], lane: player.lane });
        }
      }
    }

    if (showDeath()) addMarkers("death", deathSprites, (player) => player.deaths);
    if (showHit()) addMarkers("hit", hitSprites, (player) => player.hits);

    const markerList = Array.from(markers.values()).sort((left, right) => left.t - right.t);
    sliderMarkers.replaceChildren();

    for (const marker of markerList) {
      const glyph = document.createElement("div");
      glyph.style.position = "absolute";
      glyph.style.left = `${sliderPercent(marker.t, startTime, maxTime)}%`;
      glyph.style.top = marker.lane === 0 ? "-2px" : "14px";
      glyph.style.width = "16px";
      glyph.style.height = "16px";
      glyph.style.transform = "translateX(-50%)";
      glyph.style.borderRadius = "50%";
      glyph.style.border = "1px solid rgba(255,255,255,0.95)";
      glyph.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
      glyph.style.background = marker.color;
      glyph.style.overflow = "hidden";
      glyph.style.display = "flex";
      glyph.style.alignItems = "center";
      glyph.style.justifyContent = "center";
      glyph.title = `${marker.label === "C" ? "Cuphead" : "Mugman"} ${marker.kind} @ ${marker.t.toFixed(1)}`;

      const img = document.createElement("img");
      img.src = marker.sprite;
      img.alt = `${marker.kind}`;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.display = "block";
      glyph.appendChild(img);

      if (marker.overlaySprite) {
        const overlay = document.createElement("img");
        overlay.src = marker.overlaySprite;
        overlay.alt = "death";
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.objectFit = "cover";
        overlay.style.pointerEvents = "none";
        glyph.appendChild(overlay);
      }

      sliderMarkers.appendChild(glyph);
    }
  };
}

// draws one vertical tick per stage boundary (skipping stage 0, which is always the slider's own
// start) directly onto the given absolutely-positioned layer. Static once drawn -- unlike death
// /hit markers, boundaries don't depend on currentTime, so callers only need to run this once.
export function drawStageBoundaryMarkers({ layer, startTime, maxTime, stageStarts, stageNames = [] }) {
  layer.replaceChildren();
  for (let i = 1; i < stageStarts.length; i++) {
    const t = stageStarts[i];
    if (t == null) continue;
    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.left = `${sliderPercent(t, startTime, maxTime)}%`;
    line.style.top = "0";
    line.style.bottom = "0";
    line.style.width = "2px";
    line.style.background = "rgba(255,255,255,0.75)";
    line.style.boxShadow = "0 0 2px rgba(0,0,0,0.6)";
    line.title = stageNames[i] ? `${stageNames[i]} starts` : `Stage ${i + 1} starts`;
    layer.appendChild(line);
  }
}

// one button per stage the run actually reached (stage_start_times leaves a stage null when the
// run ended before it began) -- clicking jumps the timeslider to that stage's start via onSelect.
// Styled to match the floating panels (see createCollapsiblePanel); setActiveStage highlights the
// button of the stage playback is currently in, so the caller re-runs it on every render.
export function createStageButtons({ stageStarts, stageNames = [], onSelect }) {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "8px",
  });

  const buttons = new Map(); // stage index -> button
  let activeIndex = null;
  let hoveredIndex = null;

  function applyStyle(i) {
    const button = buttons.get(i);
    const active = i === activeIndex;
    const hovered = i === hoveredIndex;
    button.style.background = active ? (hovered ? "#1f2937" : "#374151") : (hovered ? "#f3f4f6" : "white");
    button.style.color = active ? "white" : "#111827";
    button.style.borderColor = active ? "#374151" : (hovered ? "#9ca3af" : "#ccc");
  }

  stageStarts.forEach((t, i) => {
    if (t == null) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = stageNames[i] || `Stage ${i + 1}`;
    Object.assign(button.style, {
      border: "1px solid #ccc",
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      padding: "5px 12px",
      fontFamily: "sans-serif",
      fontSize: "13px",
      cursor: "pointer",
      transition: "background 0.12s, border-color 0.12s, transform 0.06s",
    });
    button.addEventListener("click", () => onSelect(t));
    button.addEventListener("mouseenter", () => { hoveredIndex = i; applyStyle(i); });
    button.addEventListener("mouseleave", () => {
      hoveredIndex = null;
      button.style.transform = "none";
      applyStyle(i);
    });
    button.addEventListener("mousedown", () => { button.style.transform = "translateY(1px)"; });
    button.addEventListener("mouseup", () => { button.style.transform = "none"; });

    buttons.set(i, button);
    applyStyle(i);
    row.appendChild(button);
  });

  function setActiveStage(index) {
    if (index === activeIndex) return;
    const previous = activeIndex;
    activeIndex = index;
    if (buttons.has(previous)) applyStyle(previous);
    if (buttons.has(index)) applyStyle(index);
  }

  return { row, setActiveStage };
}

export function createLegendRow({ label, color, getter, setter, glyphNode, onChange }) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "12px";
  row.style.cursor = "pointer";
  row.style.userSelect = "none";

  const swatchSlot = document.createElement("div");
  swatchSlot.style.width = "32px";
  swatchSlot.style.flex = "0 0 32px";
  swatchSlot.style.display = "flex";
  swatchSlot.style.alignItems = "center";
  swatchSlot.style.justifyContent = "center";

  const swatch = glyphNode ?? document.createElement("div");
  if (!glyphNode) {
    swatch.style.width = "14px";
    swatch.style.height = "14px";
    swatch.style.background = color;
    swatch.style.borderRadius = "2px";
    swatch.style.border = "1px solid #666";
  }
  swatchSlot.appendChild(swatch);

  const text = document.createElement("div");
  text.style.textAlign = "left";
  text.textContent = label;

  function refreshRow() {
    if (getter()) {
      text.style.textDecoration = "none";
      swatch.style.opacity = "1";
      text.style.opacity = "1";
    } else {
      text.style.textDecoration = "line-through";
      swatch.style.opacity = "0.35";
      text.style.opacity = "0.5";
    }
  }

  row.addEventListener("click", () => {
    setter(!getter());
    refreshRow();
    onChange();
  });

  refreshRow();
  row.appendChild(swatchSlot);
  row.appendChild(text);
  return row;
}