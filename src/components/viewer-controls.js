import { clamp } from "./viewer-helpers.js";

export class Toggle {
  constructor(value = true) {
    this._value = !!value;
    this._listeners = [];
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = !!value;
    this._listeners.forEach((listener) => listener(this._value));
  }

  oninput(listener) {
    this._listeners.push(listener);
  }
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
  function sliderPercent(time) {
    // matches the native range input's own min/max mapping ((value - min) / (max - min)) --
    // the input's min is startTime, not 0 (see visualize.js), so a marker's position has to
    // account for that same offset or it lands to the right of where the thumb actually sits
    // at that timestamp.
    if (!maxTime || maxTime === startTime) return 0;
    return clamp(((time - startTime) / (maxTime - startTime)) * 100, 0, 100);
  }

  function markerKey(label, time) {
    return `${label}:${time}`;
  }

  return function setSliderMarkers() {
    const markers = new Map();

    function upsertMarker({ t, label, lane, color, kind, sprite, overlaySprite = null }) {
      const key = markerKey(label, t);
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

    if (showDeath()) {
      for (const point of cupDeath) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: "C", kind: "death", color: "#d62828", sprite: deathSprites.C, lane: 1 });
      }
      for (const point of mugDeath) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: "M", kind: "death", color: "#2563eb", sprite: deathSprites.M, lane: 0 });
      }
    }

    if (showHit()) {
      for (const point of cupHit) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: "C", kind: "hit", color: "#d62828", sprite: hitSprites.C, lane: 1 });
      }
      for (const point of mugHit) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: "M", kind: "hit", color: "#2563eb", sprite: hitSprites.M, lane: 0 });
      }
    }

    const markerList = Array.from(markers.values()).sort((left, right) => left.t - right.t);
    sliderMarkers.replaceChildren();

    for (const marker of markerList) {
      const glyph = document.createElement("div");
      glyph.style.position = "absolute";
      glyph.style.left = `${sliderPercent(marker.t)}%`;
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
  function sliderPercent(time) {
    if (!maxTime || maxTime === startTime) return 0;
    return clamp(((time - startTime) / (maxTime - startTime)) * 100, 0, 100);
  }

  layer.replaceChildren();
  for (let i = 1; i < stageStarts.length; i++) {
    const t = stageStarts[i];
    if (t == null) continue;
    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.left = `${sliderPercent(t)}%`;
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
export function createStageButtons({ stageStarts, stageNames = [], onSelect }) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "8px";

  stageStarts.forEach((t, i) => {
    if (t == null) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = stageNames[i] || `Stage ${i + 1}`;
    button.addEventListener("click", () => onSelect(t));
    row.appendChild(button);
  });

  return row;
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