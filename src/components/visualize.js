import * as d3 from "d3";

export async function createMapViewer({ data: providedData, curr_playthrough = null, aggr_players = null, mapUrl, spriteUrls = {}, showCup: initialShowCup = true, showMug: initialShowMug = true, showDeath: initialShowDeath = true, showHit: initialShowHit = true, showAggregate: initialShowAggregate = true}) {

  const data = providedData ?? curr_playthrough;

  /* ---------------- LOAD IMAGE ---------------- */

  const img = new Image();
  img.src = mapUrl;

  await new Promise(r => (img.onload = r));

  const mapW = img.naturalWidth;
  const mapH = img.naturalHeight;

  /* ---------------- VIEWPORT ---------------- */

  const viewportW = 2000;
  const viewportH = mapH;

  /* ---------------- MINIMAP ---------------- */

  const minimapScale = 0.2;
  const miniW = mapW * minimapScale;
  const miniH = mapH * minimapScale;

  /* ---------------- SVG CANVAS ---------------- */

  const NS = "http://www.w3.org/2000/svg";

  const mainSvg = document.createElementNS(NS, "svg");
  mainSvg.setAttribute("width", viewportW);
  mainSvg.setAttribute("height", viewportH);
  mainSvg.style.maxWidth = "100%";
  mainSvg.style.height = "auto";

  // image background
  const mainImage = document.createElementNS(NS, "image");
  // set both modern href and xlink:href for compatibility
  mainImage.setAttribute('href', mapUrl);
  mainImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
  mainImage.setAttribute("x", 0);
  mainImage.setAttribute("y", 0);
  mainImage.setAttribute("width", mapW);
  mainImage.setAttribute("height", mapH);
  mainImage.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  mainSvg.appendChild(mainImage);

  // add SVG defs with halo filter for outline glow (returns only blur with alpha compression)
  const defs = document.createElementNS(NS, 'defs');
  const haloFilter = document.createElementNS(NS, 'filter');
  haloFilter.setAttribute('id', 'halo');
  haloFilter.setAttribute('x', '-20%');
  haloFilter.setAttribute('y', '-20%');
  haloFilter.setAttribute('width', '140%');
  haloFilter.setAttribute('height', '140%');
  const feGaussian = document.createElementNS(NS, 'feGaussianBlur');
  feGaussian.setAttribute('in', 'SourceGraphic');
  feGaussian.setAttribute('stdDeviation', '10');
  haloFilter.appendChild(feGaussian);
  const feComp = document.createElementNS(NS, 'feComponentTransfer');
  const feFuncA = document.createElementNS(NS, 'feFuncA');
  feFuncA.setAttribute('type', 'linear');
  feFuncA.setAttribute('slope', '1.15');
  feComp.appendChild(feFuncA);
  haloFilter.appendChild(feComp);
  defs.appendChild(haloFilter);

  const enemyArrow = document.createElementNS(NS, 'marker');
  enemyArrow.setAttribute('id', 'enemy-arrow');
  enemyArrow.setAttribute('markerWidth', '4');
  enemyArrow.setAttribute('markerHeight', '4');
  enemyArrow.setAttribute('refX', '3.1');
  enemyArrow.setAttribute('refY', '2');
  enemyArrow.setAttribute('orient', 'auto');
  enemyArrow.setAttribute('markerUnits', 'strokeWidth');
  const enemyArrowPath = document.createElementNS(NS, 'path');
  enemyArrowPath.setAttribute('d', 'M 0 0 L 4 2 L 0 4 z');
  enemyArrowPath.setAttribute('fill', 'context-stroke');
  enemyArrow.appendChild(enemyArrowPath);
  defs.appendChild(enemyArrow);

  const enemyArrowStart = document.createElementNS(NS, 'marker');
  enemyArrowStart.setAttribute('id', 'enemy-arrow-start');
  enemyArrowStart.setAttribute('markerWidth', '4');
  enemyArrowStart.setAttribute('markerHeight', '4');
  enemyArrowStart.setAttribute('refX', '0.9');
  enemyArrowStart.setAttribute('refY', '2');
  enemyArrowStart.setAttribute('orient', 'auto');
  enemyArrowStart.setAttribute('markerUnits', 'strokeWidth');
  const enemyArrowStartPath = document.createElementNS(NS, 'path');
  enemyArrowStartPath.setAttribute('d', 'M 4 0 L 0 2 L 4 4 z');
  enemyArrowStartPath.setAttribute('fill', 'context-stroke');
  enemyArrowStart.appendChild(enemyArrowStartPath);
  defs.appendChild(enemyArrowStart);

  mainSvg.appendChild(defs);

  const mainLayers = document.createElementNS(NS, "g");
  mainLayers.setAttribute("class", "layers");
  mainSvg.appendChild(mainLayers);

  // create a halo layer before the main layers to render colored glows behind strokes
  const haloLayer = document.createElementNS(NS, 'g');
  haloLayer.setAttribute('class', 'halo-layer');
  // use normal blend to avoid brightening overlaps; rely on filter alpha compression
  haloLayer.style.mixBlendMode = 'normal';
  haloLayer.style.pointerEvents = 'none';
  mainSvg.insertBefore(haloLayer, mainLayers);

  const miniSvg = document.createElementNS(NS, "svg");
  miniSvg.setAttribute("width", miniW);
  miniSvg.setAttribute("height", miniH);
  miniSvg.setAttribute('viewBox', `0 0 ${miniW} ${miniH}`);
  miniSvg.style.maxWidth = "100%";
  miniSvg.style.height = "auto";

  const miniImage = document.createElementNS(NS, "image");
  // set both modern href and xlink:href for compatibility
  miniImage.setAttribute('href', mapUrl);
  miniImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
  miniImage.setAttribute("x", 0);
  miniImage.setAttribute("y", 0);
  miniImage.setAttribute("width", miniW);
  miniImage.setAttribute("height", miniH);
  miniImage.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  miniSvg.appendChild(miniImage);

  const miniLayers = document.createElementNS(NS, "g");
  miniLayers.setAttribute("class", "mini-layers");
  miniSvg.appendChild(miniLayers);

  /* ---------------- SCALE ---------------- */

  const scaleX = miniW / mapW;
  const scaleY = miniH / mapH;

  /* ---------------- PLAYER PATHS ---------------- */

  const cup = data[0]["3"] || [];
  const mug = data[0]["8"] || [];
  const enemyPathsByType = data[0]["enemy_paths"] || {};
  const enemyAggregates = aggr_players?.enemies || {};
  const aggCup = aggr_players?.["3"] || [];
  const aggMug = aggr_players?.["8"] || [];
  const cupDeathRaw = data[0]["5"] || [];
  const mugDeathRaw = data[0]["9"] || [];
  const deathSprites = {
    C: spriteUrls.cupDeath,
    M: spriteUrls.mugDeath
  };
  const hitSprites = {
    C: spriteUrls.cupHit,
    M: spriteUrls.mugHit
  };
  const playerMarkerRadius = 13;
  const miniPlayerMarkerRadius = 15;
  // hit events: see constants_forest_follies.py (cuphead_hit='6', mugman_hit='10')
  const cupHitRaw = data[0]["6"] || [];
  const mugHitRaw = data[0]["10"] || [];
  const enemySprites = {
    "0": spriteUrls.acorn,
    "11": spriteUrls.shroom,
    "14": spriteUrls.spikyBulb,
    "16": spriteUrls.toothy,
    "17": spriteUrls.tulip,
  };
  const stationaryEnemyTypes = new Set(["11", "17"]);
  const centeredGlyphEnemyTypes = new Set(["14", "16"]);
  const aggregatedEnemyTypes = new Set(["14", "16"]);

  function validTimedPoints(points) {
    return (points || []).filter(point => point && point[2] != null && Number.isFinite(point[2]));
  }

  function partitionEvents(points, primaryPath, secondaryPath) {
    const primaryAvailable = validTimedPoints(primaryPath);
    const secondaryAvailable = validTimedPoints(secondaryPath);
    const fallbackSource = validTimedPoints(points);

    if (!fallbackSource.length) return { primary: [], secondary: [] };
    if (!secondaryAvailable.length) return { primary: fallbackSource, secondary: [] };
    if (!primaryAvailable.length) return { primary: [], secondary: fallbackSource };

    return fallbackSource.reduce((accumulator, point) => {
      const primaryDistance = Math.abs(primaryAvailable[findCurrentIndex(primaryAvailable, point[2])]?.[2] - point[2]);
      const secondaryDistance = Math.abs(secondaryAvailable[findCurrentIndex(secondaryAvailable, point[2])]?.[2] - point[2]);
      if (primaryDistance <= secondaryDistance) accumulator.primary.push(point);
      else accumulator.secondary.push(point);
      return accumulator;
    }, { primary: [], secondary: [] });
  }

  const deathEvents = partitionEvents(cupDeathRaw.concat(mugDeathRaw), cup, mug);
  const hitEvents = partitionEvents(cupHitRaw.concat(mugHitRaw), cup, mug);
  const cupDeath = deathEvents.primary;
  const mugDeath = deathEvents.secondary;
  const cupHit = hitEvents.primary;
  const mugHit = hitEvents.secondary;

  /* ---------------- TIME ---------------- */

  let currentTime = 0;

  const cupMaxTime = cup.length ? cup[cup.length - 1][2] : 0;
  const mugMaxTime = mug.length ? mug[mug.length - 1][2] : 0;
  const maxTime = Math.max(cupMaxTime, mugMaxTime);

  /* ---------------- SLIDER ---------------- */

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = maxTime;
  slider.step = 0.1;
  slider.value = 0;
  slider.style.width = "100%";

  const sliderWrapper = document.createElement('div');
  sliderWrapper.style.position = 'relative';
  sliderWrapper.style.width = '100%';
  sliderWrapper.style.boxSizing = 'border-box';
  sliderWrapper.style.padding = '8px 0';

  const sliderMarkers = document.createElement('div');
  sliderMarkers.style.position = 'absolute';
  sliderMarkers.style.left = '0';
  sliderMarkers.style.right = '0';
  sliderMarkers.style.top = '50%';
  sliderMarkers.style.transform = 'translateY(-50%)';
  sliderMarkers.style.height = '28px';
  sliderMarkers.style.pointerEvents = 'none';
  sliderMarkers.style.overflow = 'visible';

  sliderWrapper.append(slider, sliderMarkers);

  /* ---------------- LAYER TOGGLES / POPUP LEGEND ---------------- */
  // Layer visibility flags (use small Toggle helper for clarity)
  class Toggle {
    constructor(v=true){ this._v = !!v; this._listeners = []; }
    get value(){ return this._v; }
    set value(v){ this._v = !!v; this._listeners.forEach(fn=>fn(this._v)); }
    oninput(fn){ this._listeners.push(fn); }
  }
  const showCupToggle = new Toggle(initialShowCup);
  const showMugToggle = new Toggle(initialShowMug);
  const showDeathToggle = new Toggle(initialShowDeath);
  const showHitToggle = new Toggle(initialShowHit);
  const showEnemyToggle = new Toggle(true);
  const showAggregateToggle = new Toggle(initialShowAggregate);

  function makeLegendGlyph(spriteUrl, backgroundColor, borderColor = 'white') {
    const glyph = document.createElement('div');
    glyph.style.width = '28px';
    glyph.style.height = '34px';
    glyph.style.borderRadius = '6px';
    glyph.style.border = `1px solid ${borderColor}`;
    glyph.style.boxSizing = 'border-box';
    glyph.style.background = backgroundColor;
    glyph.style.overflow = 'hidden';
    glyph.style.display = 'flex';
    glyph.style.alignItems = 'center';
    glyph.style.justifyContent = 'center';

    const inner = document.createElement('div');
    inner.style.width = 'calc(100% - 8px)';
    inner.style.height = 'calc(100% - 8px)';
    inner.style.borderRadius = '4px';
    inner.style.overflow = 'hidden';
    inner.style.background = 'rgba(255,255,255,0.16)';
    inner.style.display = 'flex';
    inner.style.alignItems = 'center';
    inner.style.justifyContent = 'center';

    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';

    inner.appendChild(img);
    glyph.appendChild(inner);
    return glyph;
  }


  /* ---------------- HELPERS ---------------- */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function findCurrentIndex(path, time) {
    for (let i = 0; i < path.length; i++) if (path[i][2] >= time) return i;
    return path.length - 1;
  }
  function flattenEnemyPaths(pathsByType) {
    return Object.entries(pathsByType).flatMap(([type, tracks]) =>
      (tracks || []).map(track => ({
        id: track.id ?? `${type}-${Math.random().toString(36).slice(2)}`,
        type,
        points: (track.points || []).filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      })).filter(track => track.points.length > 1)
    );
  }

  const enemyPaths = flattenEnemyPaths(enemyPathsByType);
  const activeEnemyTypes = new Set(Object.keys(enemyPathsByType || {}).filter(type => (enemyPathsByType[type] || []).length));

  function getEnemyGlyphSource(enemyType) {
    return enemySprites[enemyType] || spriteUrls.cupHit;
  }

  function getLastTimedPoint(points) {
    const validPoints = validTimedPoints(points);
    return validPoints.length ? validPoints[validPoints.length - 1] : null;
  }

  function pointAtFraction(points, fraction) {
    const validPoints = (points || []).filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (!validPoints.length) return null;
    if (validPoints.length === 1) return validPoints[0];

    const clampedFraction = clamp(fraction, 0, 1);
    const scaledIndex = clampedFraction * (validPoints.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(validPoints.length - 1, lowerIndex + 1);
    const localFraction = scaledIndex - lowerIndex;
    const startPoint = validPoints[lowerIndex];
    const endPoint = validPoints[upperIndex];

    return [
      startPoint[0] + (endPoint[0] - startPoint[0]) * localFraction,
      startPoint[1] + (endPoint[1] - startPoint[1]) * localFraction,
      clampedFraction,
    ];
  }

  function filterRecentPoints(points, minClusterSize = 2) {
    const validPoints = validTimedPoints(points).filter(point => point[2] <= currentTime + WINDOW_DELTA);
    if (validPoints.length < minClusterSize) return [];
    return validPoints;
  }

  function hasRecentEnemyEvidence(tracks, minClusterSize = 2) {
    return tracks.some(track => filterRecentPoints(track.points, minClusterSize).length >= minClusterSize);
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  function smoothPolyline(points, windowSize = 5) {
    const validPoints = (points || []).filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (validPoints.length < 3 || windowSize <= 1) return validPoints;

    const radius = Math.floor(windowSize / 2);
    return validPoints.map((point, index) => {
      const windowPoints = validPoints.slice(Math.max(0, index - radius), Math.min(validPoints.length, index + radius + 1));
      return [
        d3.mean(windowPoints, sample => sample[0]),
        d3.mean(windowPoints, sample => sample[1]),
        point[2],
      ];
    });
  }

  function aggregateVerticalEnemyTracks(tracks) {
    const verticalGroupingThreshold = 170;
    const groupedTracks = [];

    for (const track of tracks) {
      const points = filterRecentPoints(track.points, 2);
      if (points.length < 2) continue;

      const xs = points.map(point => point[0]);
      const ys = points.map(point => point[1]);
      const centerX = median(xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (!Number.isFinite(centerX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) continue;

      const matchingGroup = groupedTracks.find(group => group.type === track.type && Math.abs(group.centerX - centerX) <= verticalGroupingThreshold);
      if (matchingGroup) {
        matchingGroup.centerXs.push(centerX);
        matchingGroup.minY = Math.min(matchingGroup.minY, minY);
        matchingGroup.maxY = Math.max(matchingGroup.maxY, maxY);
        matchingGroup.ids.push(track.id);
      } else {
        groupedTracks.push({
          centerX,
          centerXs: [centerX],
          minY,
          maxY,
          ids: [track.id],
          type: track.type,
        });
      }
    }

    return groupedTracks.map((group, index) => {
      const centerX = median(group.centerXs);
      const basePoints = [
        [centerX, group.minY, 0],
        [centerX, (group.minY + group.maxY) / 2, 0.5],
        [centerX, group.maxY, 1],
      ];

      return {
        id: `enemy-merged-${group.type}-${index}`,
        type: group.type,
        points: smoothPolyline(basePoints, 3),
      };
    });
  }

  function buildEnemyVisuals() {
    const visuals = { paths: [], glyphs: [], stationary: [] };
    if (!showEnemyToggle.value) return visuals;

    for (const [enemyType, aggregate] of Object.entries(enemyAggregates)) {
      if (!aggregate) continue;
      const liveTracks = enemyPathsByType[enemyType] || [];
      const livePoints = liveTracks.flatMap(track => filterRecentPoints(track.points, stationaryEnemyTypes.has(enemyType) ? 3 : 2));
      const hasRecentEvidence = hasRecentEnemyEvidence(liveTracks, stationaryEnemyTypes.has(enemyType) ? 3 : 2);
      const isActive = livePoints.length > 0 || activeEnemyTypes.has(enemyType);
      const stroke = isActive ? 'rgba(64, 224, 208, 0.9)' : 'rgba(148, 163, 184, 0.9)';
      const fill = isActive ? 'rgba(64, 224, 208, 0.9)' : 'rgba(148, 163, 184, 0.8)';

      if (aggregate.mode === 'aggregated-linear' && Array.isArray(aggregate.path) && aggregate.path.length > 1) {
        if (aggregatedEnemyTypes.has(enemyType)) continue;
        visuals.paths.push({ id: `enemy-agg-${enemyType}`, points: aggregate.path, stroke, width: 12, glow: true });
        const glyphPoint = aggregatedEnemyTypes.has(enemyType)
          ? pointAtFraction(aggregate.path, 0.5) || aggregate.path[1] || aggregate.path[0]
          : pointAtFraction(aggregate.path, maxTime ? currentTime / maxTime : 0) || aggregate.path[0];
        if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-${enemyType}`, type: enemyType, x: glyphPoint[0], y: glyphPoint[1], color: fill });
        continue;
      }

      if (aggregate.mode === 'stationary') {
        for (const [index, anchor] of (aggregate.anchors || []).entries()) {
          visuals.stationary.push({ id: `enemy-stationary-${enemyType}-${index}`, type: enemyType, x: anchor[0], y: anchor[1], color: fill, active: isActive });
          visuals.glyphs.push({ id: `enemy-glyph-${enemyType}-${index}`, type: enemyType, x: anchor[0], y: anchor[1], color: fill });
        }
        continue;
      }

      if (aggregate.mode === 'full-path' && enemyType === '0') {
        for (const track of liveTracks) {
          const points = filterRecentPoints(track.points, 2);
          if (points.length > 1) {
            visuals.paths.push({ id: `enemy-live-${track.id}`, points, stroke: 'rgba(64, 224, 208, 0.9)', width: 5 });
            const glyphPoint = getLastTimedPoint(points);
            if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-${track.id}`, type: enemyType, x: glyphPoint[0], y: glyphPoint[1], color: 'rgba(64, 224, 208, 0.9)' });
          }
        }
      }
    }

    const centeredEnemyTracks = aggregateVerticalEnemyTracks(
      enemyPaths.filter(track => centeredGlyphEnemyTypes.has(track.type))
    );

    for (const track of enemyPaths) {
      if (stationaryEnemyTypes.has(track.type) || centeredGlyphEnemyTypes.has(track.type)) continue;
      const points = filterRecentPoints(track.points, 2);
      if (points.length > 1) {
        visuals.paths.push({ id: `enemy-free-${track.id}`, points, stroke: 'rgba(64, 224, 208, 0.9)', width: 5 });
        const glyphPoint = getLastTimedPoint(points);
        if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-live-${track.id}`, type: track.type, x: glyphPoint[0], y: glyphPoint[1], color: 'rgba(64, 224, 208, 0.9)' });
      }
    }

    for (const track of centeredEnemyTracks) {
      if (track.points.length <= 1) continue;
      visuals.paths.push({ id: `enemy-free-${track.id}`, points: track.points, stroke: 'rgba(64, 224, 208, 0.9)', width: 8, glow: true, arrow: true });
      const glyphPoint = pointAtFraction(track.points, 0.5) || track.points[1] || track.points[0];
      if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-centered-${track.id}`, type: track.type, x: glyphPoint[0], y: glyphPoint[1], color: 'rgba(64, 224, 208, 0.9)' });
    }

    return visuals;
  }

  // compute segment opacity based on distance from currentTime
  const WINDOW_DELTA = 50;
  const FADE_DISTANCE = WINDOW_DELTA;
  function segmentOpacity(t1, t2) {
    const avg = (t1 + t2) / 2;
    const dist = Math.abs(avg - currentTime);
    return clamp(1 - dist / FADE_DISTANCE, 0, 1);
  }

  // HP helpers (START_HP default 3)
  const START_HP = 3;
  function hpAtTime(who, t) {
    const hits = who === 'cup' ? cupHit : mugHit;
    if (!hits || !hits.length) return START_HP;
    let count = 0;
    for (let i = 0; i < hits.length; i++) {
      const p = hits[i];
      if (!p || p[2] == null) continue;
      if (p[2] <= t) count += 1;
    }
    return Math.max(0, START_HP - count);
  }
  function hpColor(hp) {
    const hpClamped = clamp(Math.round(hp), 0, START_HP);
    if (hpClamped >= 3) return '#21c55d';
    if (hpClamped === 2) return '#f59e0b';
    return '#ef4444';
  }

  function sliderPercent(t) {
    if (!maxTime) return 0;
    return clamp((t / maxTime) * 100, 0, 100);
  }

  function markerKey(label, time) {
    return `${label}:${time}`;
  }

  function setSliderMarkers() {
    const markers = new Map();

    function upsertMarker({ t, label, lane, color, kind, sprite, overlaySprite = null }) {
      const key = markerKey(label, t);
      const existing = markers.get(key);
      if (!existing) {
        markers.set(key, { t, label, lane, color, kind, sprite, overlaySprite });
        return;
      }

      if (kind === 'death') {
        existing.kind = existing.kind === 'hit' ? 'hit + death' : 'death';
        existing.overlaySprite = sprite;
        return;
      }

      existing.kind = existing.kind === 'death' ? 'hit + death' : 'hit';
      existing.sprite = sprite;
    }

    if (showDeathToggle.value) {
      for (const point of cupDeath) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: 'C', kind: 'death', color: '#d62828', sprite: deathSprites.C, lane: 1 });
      }
      for (const point of mugDeath) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: 'M', kind: 'death', color: '#2563eb', sprite: deathSprites.M, lane: 0 });
      }
    }

    if (showHitToggle.value) {
      for (const point of cupHit) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: 'C', kind: 'hit', color: '#d62828', sprite: hitSprites.C, lane: 1 });
      }
      for (const point of mugHit) {
        if (!point || point[2] == null) continue;
        upsertMarker({ t: point[2], label: 'M', kind: 'hit', color: '#2563eb', sprite: hitSprites.M, lane: 0 });
      }
    }

    const markerList = Array.from(markers.values()).sort((left, right) => left.t - right.t);
    sliderMarkers.replaceChildren();

    for (const marker of markerList) {
      const glyph = document.createElement('div');
      glyph.style.position = 'absolute';
      glyph.style.left = `${sliderPercent(marker.t)}%`;
      glyph.style.top = marker.lane === 0 ? '-2px' : '14px';
      glyph.style.width = '16px';
      glyph.style.height = '16px';
      glyph.style.transform = 'translateX(-50%)';
      glyph.style.borderRadius = '50%';
      glyph.style.border = '1px solid rgba(255,255,255,0.95)';
      glyph.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
      glyph.style.background = marker.color;
      glyph.style.overflow = 'hidden';
      glyph.style.display = 'flex';
      glyph.style.alignItems = 'center';
      glyph.style.justifyContent = 'center';
      glyph.title = `${marker.label === 'C' ? 'Cuphead' : 'Mugman'} ${marker.kind} @ ${marker.t.toFixed(1)}`;

      const img = document.createElement('img');
      img.src = marker.sprite;
      img.alt = `${marker.kind}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';

      glyph.appendChild(img);

      if (marker.overlaySprite) {
        const overlay = document.createElement('img');
        overlay.src = marker.overlaySprite;
        overlay.alt = 'death';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.objectFit = 'cover';
        overlay.style.pointerEvents = 'none';
        glyph.appendChild(overlay);
      }

      sliderMarkers.appendChild(glyph);
    }
  }

  /* ---------------- RENDER (SVG + d3 joins) ---------------- */
  // keep last known good positions so encountering null/None samples doesn't blow up the camera
  let lastValidCupX = null, lastValidCupY = null, lastValidMugX = null, lastValidMugY = null;
  let lastCameraX = 0, lastCameraY = 0;
  function isFiniteCoord(v) { return v != null && Number.isFinite(v); }

  function render() {
    const cupIndex = findCurrentIndex(cup, currentTime);
    const mugIndex = findCurrentIndex(mug, currentTime);

    const cupSample = cup[cupIndex] || [null, null, 0];
    const mugSample = mug[mugIndex] || [null, null, 0];

    const cupX = cupSample[0], cupY = cupSample[1];
    const mugX = mugSample[0], mugY = mugSample[1];

    const cupTime = cupSample[2] || 0;
    const mugTime = mugSample[2] || 0;

    // update last-valid coordinates only when samples are numeric
    if (isFiniteCoord(cupX) && isFiniteCoord(cupY)) { lastValidCupX = cupX; lastValidCupY = cupY; }
    if (isFiniteCoord(mugX) && isFiniteCoord(mugY)) { lastValidMugX = mugX; lastValidMugY = mugY; }

    // pick which player to follow based on most recent timestamp, but fallback to last-valid when needed
    let followX = null, followY = null;
    if (mugTime > cupTime) {
      followX = isFiniteCoord(mugX) ? mugX : lastValidMugX;
      followY = isFiniteCoord(mugY) ? mugY : lastValidMugY;
    } else {
      followX = isFiniteCoord(cupX) ? cupX : lastValidCupX;
      followY = isFiniteCoord(cupY) ? cupY : lastValidCupY;
    }

    // fallback to the other player's last-valid position if chosen follow is invalid
    if (!isFiniteCoord(followX) || !isFiniteCoord(followY)) {
      if (mugTime > cupTime) {
        if (isFiniteCoord(lastValidCupX) && isFiniteCoord(lastValidCupY)) { followX = lastValidCupX; followY = lastValidCupY; }
      } else {
        if (isFiniteCoord(lastValidMugX) && isFiniteCoord(lastValidMugY)) { followX = lastValidMugX; followY = lastValidMugY; }
      }
    }

    // if still not valid, keep the last camera position
    let cameraX = lastCameraX, cameraY = lastCameraY;
    if (isFiniteCoord(followX) && isFiniteCoord(followY)) {
      cameraX = followX - viewportW / 2;
      cameraY = followY - viewportH / 2;
      cameraX = clamp(cameraX, 0, mapW - viewportW);
      cameraY = clamp(cameraY, 0, mapH - viewportH);
      lastCameraX = cameraX; lastCameraY = cameraY;
    }

    // set main viewBox to implement camera
    mainSvg.setAttribute('viewBox', `${cameraX} ${cameraY} ${viewportW} ${viewportH}`);

    // prepare segment data for cup and mug (only within WINDOW_DELTA range)
    function makeSegments(points, color, strokeWidth=6, prefix='seg', who='cup') {
      const start = currentTime - WINDOW_DELTA;
      const end = currentTime + WINDOW_DELTA;
      const segs = [];
      let fallbackSegment = null;
      for (let i = 1; i < points.length; i++) {
        const a = points[i-1];
        const b = points[i];
        if (!a || !b || a[0] == null || b[0] == null) continue;
        const t1 = a[2];
        const t2 = b[2];
        if (t1 == null || t2 == null) continue;
        const tmid = (t1 + t2) / 2;
        const segment = { id: `${prefix}-${i-1}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], points: [[a[0], a[1]], [b[0], b[1]]], color, strokeWidth, opacity: segmentOpacity(t1, t2), who, t: tmid };
        if (!fallbackSegment) fallbackSegment = segment;
        if (Math.max(t1, t2) < start) continue;
        if (Math.min(t1, t2) > end) continue;
        segs.push(segment);
      }
      if (!segs.length && fallbackSegment) {
        segs.push({
          ...fallbackSegment,
          opacity: Math.max(fallbackSegment.opacity, 0.85)
        });
      }
      return segs;
    }

    const cupSegs = makeSegments(cup, 'red', 6, 'cup', 'cup');
    const mugSegs = makeSegments(mug, 'blue', 6, 'mug', 'mug');
    const allSegs = [];
    if (showCupToggle.value) allSegs.push(...cupSegs);
    if (showMugToggle.value) allSegs.push(...mugSegs);


    function buildHpTrailGroups(segs) {
      const groups = [];
      if (!segs.length) return groups;

      let currentGroup = null;
      const MIN_VISIBLE_SEGMENT_OPACITY = 0.10;

      for (const seg of segs) {
        const hp = hpAtTime(seg.who, seg.t);
        const color = hpColor(hp);
        const startPoint = seg.points?.[0] ?? [seg.x1, seg.y1];
        const endPoint = seg.points?.[1] ?? [seg.x2, seg.y2];
        const shouldBreakForVisibility = seg.opacity < MIN_VISIBLE_SEGMENT_OPACITY;

        if (!currentGroup || currentGroup.who !== seg.who || currentGroup.hp !== hp || shouldBreakForVisibility) {
          currentGroup = {
            id: `${seg.who}-hp-${seg.id}`,
            who: seg.who,
            hp,
            color,
            points: [startPoint, endPoint],
            opacity: seg.opacity,
            opacitySum: seg.opacity,
            opacityCount: 1,
            strokeWidth: seg.strokeWidth
          };
          groups.push(currentGroup);
          continue;
        }

        currentGroup.points.push(endPoint);
        currentGroup.opacity = Math.max(currentGroup.opacity, seg.opacity);
        currentGroup.opacitySum += seg.opacity;
        currentGroup.opacityCount += 1;
        currentGroup.strokeWidth = Math.max(currentGroup.strokeWidth, seg.strokeWidth);
      }

      for (const group of groups) {
        const avgOpacity = group.opacityCount ? group.opacitySum / group.opacityCount : group.opacity;
        group.opacity = Math.max(avgOpacity * 0.45, group.opacity * 0.9);
      }

      return groups;
    }

    function makePathD(points) {
      const validPoints = points.filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
      if (!validPoints.length) return '';
      const [firstPoint, ...rest] = validPoints;
      return [`M ${firstPoint[0]} ${firstPoint[1]}`, ...rest.map(point => `L ${point[0]} ${point[1]}`)].join(' ');
    }

    const haloGroups = [];
    if (showCupToggle.value) haloGroups.push(...buildHpTrailGroups(cupSegs));
    if (showMugToggle.value) haloGroups.push(...buildHpTrailGroups(mugSegs));

    const haloBaseSel = d3
        .select(haloLayer)
        .selectAll('.halo-base')
        .data(haloGroups, d => d.id);
    haloBaseSel.join(

      enter => enter.append('path')
        .attr('class', 'halo-base')
        .attr('d', d => makePathD(d.points))
        .attr('fill', 'none')
        .attr('stroke', d => d.color)
        .attr('stroke-opacity', d => Math.max(d.opacity * 0.32, 0.08))
        .attr('stroke-width', d => d.strokeWidth + 22)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round'),

      update => update
        .attr('d', d => makePathD(d.points))
        .attr('stroke', d => d.color)
        .attr('stroke-opacity', d => Math.max(d.opacity * 0.32, 0.08))
        .attr('stroke-width', d => d.strokeWidth + 22),

      exit => exit.remove()
    );

    const haloGlowSel = d3
        .select(haloLayer)
        .selectAll('.halo-glow')
        .data(haloGroups, d => d.id);
    haloGlowSel.join(

      enter => enter.append('path')
        .attr('class', 'halo-glow')
        .attr('d', d => makePathD(d.points))
        .attr('fill', 'none')
        .attr('stroke', d => d.color)
        .attr('stroke-opacity', d => Math.max(d.opacity * 0.2, 0.03))
        .attr('stroke-width', d => d.strokeWidth + 34)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('filter', 'url(#halo)'),

      update => update
        .attr('d', d => makePathD(d.points))
        .attr('stroke', d => d.color)
        .attr('stroke-opacity', d => Math.max(d.opacity * 0.2, 0.03))
        .attr('stroke-width', d => d.strokeWidth + 34),

      exit => exit.remove()
    );

    // bind main segments (inner strokes) in the mainLayers so they stay on top
    const mainSel = d3.select(mainLayers);

    const aggregatePaths = [];
    if (showAggregateToggle.value && aggCup.length > 1) {
      aggregatePaths.push({ id: 'agg-cup', points: aggCup, color: 'rgba(255, 0, 0, 0.35)', width: 10 });
    }
    if (showAggregateToggle.value && aggMug.length > 1) {
      aggregatePaths.push({ id: 'agg-mug', points: aggMug, color: 'rgba(0, 0, 255, 0.35)', width: 10 });
    }

    const aggregateSel = mainSel.selectAll('.aggregate-path').data(aggregatePaths, d => d.id);
    aggregateSel.join(
      enter => enter.append('path').attr('class', 'aggregate-path')
        .attr('d', d => makePathD(d.points))
        .attr('fill', 'none')
        .attr('stroke', d => d.color)
        .attr('stroke-width', d => d.width)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round'),
      update => update
        .attr('d', d => makePathD(d.points))
        .attr('stroke', d => d.color)
        .attr('stroke-width', d => d.width),
      exit => exit.remove()
    );

    const enemyVisuals = buildEnemyVisuals();

    const enemyBackSel = d3.select(haloLayer);

    const enemyPathSel = enemyBackSel.selectAll('.enemy-path').data(enemyVisuals.paths, d => d.id);
    enemyPathSel.join(
      enter => enter.append('path').attr('class', 'enemy-path')
        .attr('d', d => makePathD(d.points))
        .attr('fill', 'none')
        .attr('stroke', d => d.stroke)
        .attr('stroke-width', d => d.width)
        .attr('marker-start', d => d.arrow ? 'url(#enemy-arrow-start)' : null)
        .attr('marker-end', d => d.arrow ? 'url(#enemy-arrow)' : null)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round'),
      update => update
        .attr('d', d => makePathD(d.points))
        .attr('stroke', d => d.stroke)
        .attr('marker-start', d => d.arrow ? 'url(#enemy-arrow-start)' : null)
        .attr('marker-end', d => d.arrow ? 'url(#enemy-arrow)' : null)
        .attr('stroke-width', d => d.width),
      exit => exit.remove()
    );

    const enemyStationarySel = enemyBackSel.selectAll('.enemy-stationary').data(enemyVisuals.stationary, d => d.id);
    enemyStationarySel.join(
      enter => enter.append('circle').attr('class', 'enemy-stationary')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', 22)
        .attr('fill', 'none')
        .attr('stroke', d => d.color)
        .attr('stroke-width', 6),
      update => update
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('stroke', d => d.color),
      exit => exit.remove()
    );

    const enemyGlyphSel = mainSel.selectAll('.enemy-glyph').data(enemyVisuals.glyphs, d => d.id);
    enemyGlyphSel.join(
      enter => {
        const group = enter.append('g').attr('class', 'enemy-glyph');
        group.append('rect')
          .attr('class', 'enemy-glyph-badge')
          .attr('x', -35)
          .attr('y', -42)
          .attr('width', 70)
          .attr('height', 84)
          .attr('rx', 12)
          .attr('ry', 12)
          .attr('stroke', 'white')
          .attr('stroke-width', 2);
        group.append('rect')
          .attr('class', 'enemy-glyph-bg')
          .attr('x', -27)
          .attr('y', -34)
          .attr('width', 54)
          .attr('height', 68)
          .attr('rx', 9)
          .attr('ry', 9)
          .attr('fill', 'rgba(255,255,255,0.16)');
        group.append('foreignObject')
          .attr('class', 'enemy-glyph-fo')
          .attr('x', -27)
          .attr('y', -34)
          .attr('width', 54)
          .attr('height', 68)
          .html(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:12px;"><img class="enemy-glyph-sprite" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`);
        return group;
      },
      update => update,
      exit => exit.remove()
    )
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .each(function(d) {
        const group = d3.select(this);
        group.select('.enemy-glyph-badge').attr('fill', d.color);
        group.select('.enemy-glyph-bg').attr('fill', 'rgba(255,255,255,0.16)');
        const sprite = this.querySelector('.enemy-glyph-sprite');
        if (sprite) {
          sprite.setAttribute('src', getEnemyGlyphSource(d.type));
          sprite.style.opacity = '1';
          sprite.style.filter = 'none';
        }
      });

    const segSel = mainSel.selectAll('.segment').data(allSegs, d => d.id);
    segSel.join(
      enter => enter.append('line').attr('class','segment')
        .attr('x1', d=>d.x1).attr('y1', d=>d.y1)
        .attr('x2', d=>d.x2).attr('y2', d=>d.y2)
        .attr('stroke', d=>d.color)
        .attr('stroke-width', d=>d.strokeWidth)
        .attr('stroke-linecap','round')
        .attr('stroke-opacity', d=>d.opacity),
      update => update
        .attr('x1', d=>d.x1).attr('y1', d=>d.y1)
        .attr('x2', d=>d.x2).attr('y2', d=>d.y2)
        .attr('stroke', d=>d.color)
        .attr('stroke-width', d=>d.strokeWidth)
        .attr('stroke-opacity', d=>d.opacity),
      exit => exit.remove()
    );

    // players: draw cup and mug separately based on flags (use last-valid if current sample is null)
    const displayCupX = isFiniteCoord(cupX) ? cupX : lastValidCupX;
    const displayCupY = isFiniteCoord(cupY) ? cupY : lastValidCupY;
    const displayMugX = isFiniteCoord(mugX) ? mugX : lastValidMugX;
    const displayMugY = isFiniteCoord(mugY) ? mugY : lastValidMugY;

    const players = [];
    if (showCupToggle.value && isFiniteCoord(displayCupX) && isFiniteCoord(displayCupY)) players.push({id:'cup', x:displayCupX,y:displayCupY,color:'red',r:playerMarkerRadius});
    if (showMugToggle.value && isFiniteCoord(displayMugX) && isFiniteCoord(displayMugY)) players.push({id:'mug', x:displayMugX,y:displayMugY,color:'blue',r:playerMarkerRadius});
    const psel = mainSel.selectAll('.player').data(players, d=>d.id);
    psel.join(
      enter => enter.append('circle').attr('class','player')
        .attr('cx', d=>d.x).attr('cy', d=>d.y).attr('r', d=>d.r)
        .attr('fill', d=>d.color),
      update => update.attr('cx', d=>d.x).attr('cy', d=>d.y),
      exit => exit.remove()
    );

    // deaths + hits: fade with timestamp like segments
    function eventOpacity(t) { return clamp(1 - Math.abs(t - currentTime) / FADE_DISTANCE, 0, 1); }

    // deaths
    if (showDeathToggle.value) {
      function deathData(points, color, label) {
        return points
          .filter(p => p && p[0] != null && p[2] <= currentTime + WINDOW_DELTA)
          .map((p, i) => ({
            id: `death-${label}-${i}-${p[2]}`,
            x: p[0],
            y: p[1],
            color,
            label,
            t: p[2]
          }));
      }

      const deaths = deathData(cupDeath, '#d62828', 'C').concat(deathData(mugDeath, '#2563eb', 'M'));
      const badgeWidth = 70;
      const badgeHeight = 84;
      const spriteInset = 8;

      const gsel = mainSel.selectAll('.death').data(deaths, d => d.id);
      gsel.join(
        enter => {
          const group = enter.append('g').attr('class', 'death');

          group.append('rect')
            .attr('class', 'death-badge')
            .attr('x', -badgeWidth / 2)
            .attr('y', -badgeHeight / 2)
            .attr('width', badgeWidth)
            .attr('height', badgeHeight)
            .attr('rx', 12)
            .attr('ry', 12)
            .attr('stroke', 'white')
            .attr('stroke-width', 2);

          group.append('rect')
            .attr('class', 'death-sprite-bg')
            .attr('x', -badgeWidth / 2 + spriteInset)
            .attr('y', -badgeHeight / 2 + spriteInset)
            .attr('width', badgeWidth - spriteInset * 2)
            .attr('height', badgeHeight - spriteInset * 2)
            .attr('rx', 9)
            .attr('ry', 9)
            .attr('fill', 'rgba(255,255,255,0.16)');

          group.append('foreignObject')
            .attr('class', 'death-sprite-fo')
            .attr('x', -badgeWidth / 2 + spriteInset)
            .attr('y', -badgeHeight / 2 + spriteInset)
            .attr('width', badgeWidth - spriteInset * 2)
            .attr('height', badgeHeight - spriteInset * 2)
            .html(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:12px;"><img class="death-sprite" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`);

          return group;
        },
        update => update,
        exit => exit.remove()
      )
        .attr('transform', d => `translate(${d.x}, ${d.y})`)
        .attr('opacity', d => Math.min(1, eventOpacity(d.t) * 1.5))
        .each(function() { this.parentNode?.appendChild(this); })
        .each(function(d) {
          const group = d3.select(this);
          group.select('.death-badge').attr('fill', d.color);
          const sprite = this.querySelector('.death-sprite');
          if (sprite) sprite.setAttribute('src', deathSprites[d.label]);
        });
    } else {
      mainSel.selectAll('.death').remove();
    }

    // hits
    if (showHitToggle.value) {
      function hitData(points, color, label) {
        return points
          .filter(p => p && p[0] != null && p[2] <= currentTime + WINDOW_DELTA)
          .map((p, i) => ({
            id: `hit-${label}-${i}-${p[2]}`,
            x: p[0],
            y: p[1],
            color,
            label,
            t: p[2]
          }));
      }
      const hits = hitData(cupHit, '#d62828', 'C').concat(hitData(mugHit, '#2563eb', 'M'));
      const badgeWidth = 70;
      const badgeHeight = 84;
      const spriteInset = 8;

      const gsel2 = mainSel.selectAll('.hit').data(hits, d => d.id);
      gsel2.join(
        enter => {
          const group = enter.append('g').attr('class', 'hit');

          group.append('rect')
            .attr('class', 'hit-badge')
            .attr('x', -badgeWidth / 2)
            .attr('y', -badgeHeight / 2)
            .attr('width', badgeWidth)
            .attr('height', badgeHeight)
            .attr('rx', 12)
            .attr('ry', 12)
            .attr('stroke', 'white')
            .attr('stroke-width', 2);

          group.append('rect')
            .attr('class', 'hit-sprite-bg')
            .attr('x', -badgeWidth / 2 + spriteInset)
            .attr('y', -badgeHeight / 2 + spriteInset)
            .attr('width', badgeWidth - spriteInset * 2)
            .attr('height', badgeHeight - spriteInset * 2)
            .attr('rx', 9)
            .attr('ry', 9)
            .attr('fill', 'rgba(255,255,255,0.16)');

          group.append('foreignObject')
            .attr('class', 'hit-sprite-fo')
            .attr('x', -badgeWidth / 2 + spriteInset)
            .attr('y', -badgeHeight / 2 + spriteInset)
            .attr('width', badgeWidth - spriteInset * 2)
            .attr('height', badgeHeight - spriteInset * 2)
            .html(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:12px;"><img class="hit-sprite" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`);

          return group;
        },
        update => update,
        exit => exit.remove()
      )
        .attr('transform', d => `translate(${d.x}, ${d.y})`)
        .attr('opacity', d => Math.min(1, eventOpacity(d.t) * 1.25))
        .each(function() { this.parentNode?.appendChild(this); })
        .each(function(d) {
          const group = d3.select(this);
          group.select('.hit-badge').attr('fill', d.color);
          const sprite = this.querySelector('.hit-sprite');
          if (sprite) sprite.setAttribute('src', hitSprites[d.label]);
        });
    } else {
      mainSel.selectAll('.hit').remove();
    }

    // minimap: draw small scaled paths and viewport rect
    const miniSel = d3.select(miniLayers);

    const miniAggCupPoints = aggCup.filter(p => p && p[0] != null).map(p => ({ x: p[0] * scaleX, y: p[1] * scaleY }));
    const miniAggMugPoints = aggMug.filter(p => p && p[0] != null).map(p => ({ x: p[0] * scaleX, y: p[1] * scaleY }));
    const miniPlayers = [];
    if (showCupToggle.value && isFiniteCoord(displayCupX) && isFiniteCoord(displayCupY)) {
      miniPlayers.push({ id: 'mini-cup-player', x: displayCupX * scaleX, y: displayCupY * scaleY, color: 'red', r: miniPlayerMarkerRadius });
    }
    if (showMugToggle.value && isFiniteCoord(displayMugX) && isFiniteCoord(displayMugY)) {
      miniPlayers.push({ id: 'mini-mug-player', x: displayMugX * scaleX, y: displayMugY * scaleY, color: 'blue', r: miniPlayerMarkerRadius });
    }

    function makePolyPoints(arr) { return arr.map(d=>`${d.x},${d.y}`).join(' '); }
        const miniAggCup = miniSel.selectAll('.mini-agg-cup').data(showAggregateToggle.value && miniAggCupPoints.length > 1 ? [miniAggCupPoints] : []);
        miniAggCup.join(
          enter => enter.append('polyline').attr('class','mini-agg-cup')
            .attr('points', makePolyPoints)
            .attr('fill','none').attr('stroke','rgba(255,0,0,0.35)').attr('stroke-width',20),
          update => update.attr('points', makePolyPoints).attr('stroke','rgba(255,0,0,0.35)').attr('stroke-width',20),
          exit => exit.remove()
        );

        const miniAggMug = miniSel.selectAll('.mini-agg-mug').data(showAggregateToggle.value && miniAggMugPoints.length > 1 ? [miniAggMugPoints] : []);
        miniAggMug.join(
          enter => enter.append('polyline').attr('class','mini-agg-mug')
            .attr('points', makePolyPoints)
            .attr('fill','none').attr('stroke','rgba(0,0,255,0.35)').attr('stroke-width',20),
          update => update.attr('points', makePolyPoints).attr('stroke','rgba(0,0,255,0.35)').attr('stroke-width',20),
          exit => exit.remove()
        );

    const miniPlayerSel = miniSel.selectAll('.mini-player').data(miniPlayers, d => d.id);
    miniPlayerSel.join(
      enter => enter.append('circle').attr('class', 'mini-player')
        .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
        .attr('fill', d => d.color)
        .attr('stroke', 'white')
        .attr('stroke-width', 2),
      update => update
        .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
        .attr('fill', d => d.color),
      exit => exit.remove()
    );

    // viewport rect on minimap
    const rect = miniSel.selectAll('.viewport-rect').data([{
      x: cameraX * scaleX,
      y: cameraY * scaleY,
      w: viewportW * scaleX,
      h: viewportH * scaleY
    }]);
    rect.join(
      enter => enter.append('rect').attr('class','viewport-rect')
        .attr('x',d=>d.x).attr('y',d=>d.y).attr('width',d=>d.w).attr('height',d=>d.h)
        .attr('fill','none').attr('stroke','lime').attr('stroke-width',7),
      update => update.attr('x',d=>d.x).attr('y',d=>d.y).attr('width',d=>d.w).attr('height',d=>d.h).attr('stroke-width',7),
      exit => exit.remove()
    );
  }

  /* ---------------- SLIDER EVENTS ---------------- */
  slider.addEventListener('input', () => { currentTime = Number(slider.value); render(); });

  /* ---------------- INITIAL RENDER ---------------- */
  render();
  setSliderMarkers();

  /* ---------------- CONTAINER ---------------- */
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';

  container.append(miniSvg, mainSvg, sliderWrapper);

  // create main wrapper and move mainSvg inside it so legend won't overlap minimap
  const mainWrapper = document.createElement('div');
  mainWrapper.className = 'main-wrapper';
  mainWrapper.style.position = 'relative';
  mainWrapper.style.display = 'inline-block';
  mainWrapper.style.width = '100%';
  mainWrapper.style.boxSizing = 'border-box';

  // replace mainSvg in container with wrapper containing mainSvg
  container.replaceChild(mainWrapper, mainSvg);
  mainWrapper.appendChild(mainSvg);

  // build a compact left-top legend owned by the viewer
  const leftLegend = document.createElement('div');
  leftLegend.style.position = 'absolute';
  leftLegend.style.top = '10px';
  leftLegend.style.left = '10px';
  leftLegend.style.background = 'white';
  leftLegend.style.padding = '6px 8px';
  leftLegend.style.border = '1px solid #ccc';
  leftLegend.style.borderRadius = '4px';
  leftLegend.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
  leftLegend.style.fontFamily = 'sans-serif';
  leftLegend.style.zIndex = '1000';
  leftLegend.style.display = 'flex';
  leftLegend.style.flexDirection = 'column';
  leftLegend.style.gap = '6px';

  function makeLegendRow(label, color, getter, setter, glyphNode) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.cursor = 'pointer';
    row.style.userSelect = 'none';

    const swatch = glyphNode ?? document.createElement('div');
    if (!glyphNode) {
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.background = color;
      swatch.style.borderRadius = '2px';
      swatch.style.border = '1px solid #666';
    }

    const txt = document.createElement('div');
    txt.textContent = label;

    function refreshRow() {
      if (getter()) {
        txt.style.textDecoration = 'none';
        swatch.style.opacity = '1';
        txt.style.opacity = '1';
      } else {
        txt.style.textDecoration = 'line-through';
        swatch.style.opacity = '0.35';
        txt.style.opacity = '0.5';
      }
    }

    row.addEventListener('click', () => {
      setter(!getter());
      refreshRow();
      // re-render immediately
      try {
        render();
        setSliderMarkers();
      } catch (e) { /* ignore */ }
    });

    refreshRow();
    row.appendChild(swatch);
    row.appendChild(txt);
    return row;
  }

  leftLegend.appendChild(makeLegendRow('Cup', '#ff0000', () => showCupToggle.value, v => { showCupToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Mug', '#0000ff', () => showMugToggle.value, v => { showMugToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Enemies', '#40e0d0', () => showEnemyToggle.value, v => { showEnemyToggle.value = v; }, makeLegendGlyph(spriteUrls.toothy, 'rgba(64, 224, 208, 0.18)', '#40e0d0')));
  leftLegend.appendChild(makeLegendRow('Aggregate', '#6b7280', () => showAggregateToggle.value, v => { showAggregateToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Death', '#000000', () => showDeathToggle.value, v => { showDeathToggle.value = v; }, makeLegendGlyph(deathSprites.C, 'transparent', 'black')));
  leftLegend.appendChild(makeLegendRow('Hit', '#000000', () => showHitToggle.value, v => { showHitToggle.value = v; }, makeLegendGlyph(hitSprites.C, 'transparent', 'black')))
  mainWrapper.appendChild(leftLegend);

  return container;
}