import * as d3 from "d3";
import { createLevelConfig, parseEnemySizes } from "./level-config.js";
import { Toggle, createLegendRow, createSliderMarkers, makeLegendGlyph } from "./viewer-controls.js";
import { createEnemyVisualBuilder, getEnemyGlyphSize, getEnemyGlyphSource } from "./viewer-enemies.js";
import { clamp, findCurrentIndex, flattenEnemyPaths, makePathD, validTimedPoints } from "./viewer-helpers.js";

export async function createMapViewer({
  data: providedData,
  curr_playthrough = null,
  aggr_players = null,
  mapUrl,
  spriteUrls = {},
  enemySizesText = "",
  levelConfig = createLevelConfig(),
  showCup: initialShowCup = true,
  showMug: initialShowMug = true,
  showDeath: initialShowDeath = true,
  showHit: initialShowHit = true,
  showAggregate: initialShowAggregate = true,
}) {

  const data = providedData ?? curr_playthrough;

  /* ---------------- LOAD IMAGE ---------------- */

  const img = new Image();
  img.src = mapUrl;

  await new Promise(r => (img.onload = r));

  const mapW = img.naturalWidth;
  const mapH = img.naturalHeight;

  /* ---------------- VIEWPORT ---------------- */

  const viewportW = levelConfig.viewportWidth;
  const viewportH = mapH;

  /* ---------------- MINIMAP ---------------- */

  const minimapScale = levelConfig.minimapScale;
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

  const cup = data[0][levelConfig.playerTypes.cup] || [];
  const mug = data[0][levelConfig.playerTypes.mug] || [];
  const enemyAggregates = aggr_players?.enemies || {};
  // each tracked enemy type's per-run tracks live directly under
  // data[0][type] as an array of point-arrays (one per enemy instance)
  const enemyPathsByType = Object.fromEntries(
    levelConfig.trackedEnemyTypes.map((type) => [type, data[0][type] || []])
  );
  const aggCup = aggr_players?.[levelConfig.playerTypes.cup] || [];
  const aggMug = aggr_players?.[levelConfig.playerTypes.mug] || [];
  const cupDeathRaw = data[0][levelConfig.playerTypes.cupDeath] || [];
  const mugDeathRaw = data[0][levelConfig.playerTypes.mugDeath] || [];
  const deathSprites = {
    C: spriteUrls.cupDeath,
    M: spriteUrls.mugDeath
  };
  const hitSprites = {
    C: spriteUrls.cupHit,
    M: spriteUrls.mugHit
  };
  const playerSprites = {
    cup: spriteUrls.cup,
    mug: spriteUrls.mug
  };
  const playerGlyphSize = {
    cup: { w: 60, h: 70 },
    mug: { w: 68, h: 70 }
  };
  const miniPlayerMarkerRadius = 15;
  const cupHitRaw = data[0][levelConfig.playerTypes.cupHit] || [];
  const mugHitRaw = data[0][levelConfig.playerTypes.mugHit] || [];
  const enemySprites = Object.fromEntries(
    Object.entries(levelConfig.enemyGlyphSources).map(([type, spriteKey]) => [type, spriteUrls[spriteKey]])
  );
  const enemyGlyphSize = parseEnemySizes(enemySizesText, levelConfig.enemyNameToType);
  const stationaryEnemyTypes = levelConfig.stationaryEnemyTypes;
  const centeredGlyphEnemyTypes = levelConfig.centeredGlyphEnemyTypes;
  const ENEMY_INSTANCE_X_THRESHOLD = levelConfig.enemyInstanceXThreshold;
  const STATIONARY_INSTANCE_THRESHOLD = levelConfig.stationaryInstanceThreshold;
  const WINDOW_DELTA = levelConfig.windowDelta;
  const START_HP = levelConfig.startHp;

  // cupDeathRaw/mugDeathRaw/cupHitRaw/mugHitRaw are already correctly split per player at the
  // data layer (distinct cuphead_ghost/mugman_ghost, cuphead_hit/mugman_hit source types), so
  // just validate them directly rather than re-deriving ownership from path proximity: both
  // players progress through a level in lockstep, so proximity ties are common and previously
  // always got broken in cup's favor, misattributing mug's hits/deaths to cup.
  const cupDeath = validTimedPoints(cupDeathRaw);
  const mugDeath = validTimedPoints(mugDeathRaw);
  const cupHit = validTimedPoints(cupHitRaw);
  const mugHit = validTimedPoints(mugHitRaw);

  /* ---------------- TIME ---------------- */

  // start the timeline at the earlier of the two players' first tracked position, not 0 --
  // there's no data before that (find_stable_start already crops pre-movement noise on the
  // data side), so starting the slider at 0 would just leave the player frozen at their first
  // point for a dead stretch before anything happens.
  const cupMinTime = cup.length ? cup[0][2] : Infinity;
  const mugMinTime = mug.length ? mug[0][2] : Infinity;
  const minTime = Math.min(cupMinTime, mugMinTime);
  const startTime = Number.isFinite(minTime) ? minTime : 0;

  let currentTime = startTime;

  const cupMaxTime = cup.length ? cup[cup.length - 1][2] : 0;
  const mugMaxTime = mug.length ? mug[mug.length - 1][2] : 0;
  const maxTime = Math.max(cupMaxTime, mugMaxTime);

  /* ---------------- SLIDER ---------------- */

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = startTime;
  slider.max = maxTime;
  slider.step = 0.1;
  slider.value = startTime;
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
  const showCupToggle = new Toggle(initialShowCup);
  const showMugToggle = new Toggle(initialShowMug);
  const showDeathToggle = new Toggle(initialShowDeath);
  const showHitToggle = new Toggle(initialShowHit);
  const showEnemyToggle = new Toggle(true);
  const showAggregateToggle = new Toggle(initialShowAggregate);

  const enemyPaths = flattenEnemyPaths(enemyPathsByType);
  const { buildEnemyVisuals, filterRecentPoints } = createEnemyVisualBuilder({
    currentTimeProvider: () => currentTime,
    windowDelta: WINDOW_DELTA,
    enemyAggregates,
    enemyPathsByType,
    enemyPaths,
    stationaryEnemyTypes,
    centeredGlyphEnemyTypes,
    neverFadeEnemyTypes: levelConfig.neverFadeEnemyTypes,
    holdLastPositionEnemyTypes: levelConfig.holdLastPositionEnemyTypes,
    minimizingEnemyTypes: levelConfig.minimizingEnemyTypes,
    minimizingChainDistance: levelConfig.minimizingChainDistance,
    enemyInstanceXThreshold: ENEMY_INSTANCE_X_THRESHOLD,
    stationaryInstanceThreshold: STATIONARY_INSTANCE_THRESHOLD,
    showEnemy: () => showEnemyToggle.value,
  });

  // fade a segment out the further currentTime has moved past it -- never fade one in ahead of
  // time, so nothing previews before the scrub position actually reaches it.
  const FADE_DISTANCE = WINDOW_DELTA;
  function segmentOpacity(t1, t2) {
    const avg = (t1 + t2) / 2;
    const dist = currentTime - avg;
    if (dist < 0) return 0;
    return clamp(1 - dist / FADE_DISTANCE, 0, 1);
  }

  // HP helpers (START_HP default 3)
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

  const setSliderMarkers = createSliderMarkers({
    sliderMarkers,
    maxTime,
    showDeath: () => showDeathToggle.value,
    showHit: () => showHitToggle.value,
    cupDeath,
    mugDeath,
    cupHit,
    mugHit,
    deathSprites,
    hitSprites,
  });

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

    // update last-valid coordinates only when samples are numeric
    if (isFiniteCoord(cupX) && isFiniteCoord(cupY)) { lastValidCupX = cupX; lastValidCupY = cupY; }
    if (isFiniteCoord(mugX) && isFiniteCoord(mugY)) { lastValidMugX = mugX; lastValidMugY = mugY; }

    // follow the midpoint of both players' current (or last-known) position instead of
    // switching between them: their samples aren't time-synced, so picking "whichever has
    // the more recent timestamp" flickers between cup/mug on essentially every frame
    const cupFollowX = isFiniteCoord(cupX) ? cupX : lastValidCupX;
    const cupFollowY = isFiniteCoord(cupY) ? cupY : lastValidCupY;
    const mugFollowX = isFiniteCoord(mugX) ? mugX : lastValidMugX;
    const mugFollowY = isFiniteCoord(mugY) ? mugY : lastValidMugY;

    // exclude a player once they have no more samples for the rest of the run (final death /
    // recording end) so the camera doesn't keep averaging in a frozen corpse position; while
    // currentTime is still within their range, a null sample is a temporary down (revivable
    // ghost), so lastValid keeps them in the average as intended
    const cupHasFollow = currentTime <= cupMaxTime && isFiniteCoord(cupFollowX) && isFiniteCoord(cupFollowY);
    const mugHasFollow = currentTime <= mugMaxTime && isFiniteCoord(mugFollowX) && isFiniteCoord(mugFollowY);

    let followX = null, followY = null;
    if (cupHasFollow && mugHasFollow) {
      followX = (cupFollowX + mugFollowX) / 2;
      followY = (cupFollowY + mugFollowY) / 2;
    } else if (cupHasFollow) {
      followX = cupFollowX; followY = cupFollowY;
    } else if (mugHasFollow) {
      followX = mugFollowX; followY = mugFollowY;
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

    // prepare segment data for cup and mug (only within WINDOW_DELTA range behind currentTime,
    // never ahead of it)
    function makeSegments(points, color, strokeWidth=6, prefix='seg', who='cup') {
      const start = currentTime - WINDOW_DELTA;
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
        if (Math.min(t1, t2) > currentTime) continue;
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
        .attr('stroke-opacity', d => d.opacity ?? 1)
        .attr('marker-start', d => d.arrow ? 'url(#enemy-arrow-start)' : null)
        .attr('marker-end', d => d.arrow ? 'url(#enemy-arrow)' : null)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round'),
      update => update
        .attr('d', d => makePathD(d.points))
        .attr('stroke', d => d.stroke)
        .attr('stroke-opacity', d => d.opacity ?? 1)
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
          .html(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:12px;"><img class="enemy-glyph-sprite" style="width:100%;height:100%;object-fit:contain;display:block;" /></div>`);
        // debug: track index, so a glyph on screen can be matched back to its entry in the
        // python-side track list (e.g. daisy[12]) without guessing from position alone
        group.append('text')
          .attr('class', 'enemy-glyph-debug-label')
          .attr('text-anchor', 'middle')
          .attr('font-size', 20)
          .attr('font-weight', 'bold')
          .attr('fill', 'white')
          .attr('stroke', 'black')
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke');
        return group;
      },
      update => update,
      exit => exit.remove()
    )
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .each(function(d) {
        const group = d3.select(this);
        const { w, h } = getEnemyGlyphSize(d.type, enemyGlyphSize, levelConfig.defaultGlyphSize);
        group.select('.enemy-glyph-badge')
          .attr('fill', d.color)
          .attr('x', -(w + 16) / 2)
          .attr('y', -(h + 16) / 2)
          .attr('width', w + 16)
          .attr('height', h + 16);
        group.select('.enemy-glyph-bg')
          .attr('fill', 'rgba(255,255,255,0.16)')
          .attr('x', -w / 2)
          .attr('y', -h / 2)
          .attr('width', w)
          .attr('height', h);
        group.select('.enemy-glyph-fo')
          .attr('x', -w / 2)
          .attr('y', -h / 2)
          .attr('width', w)
          .attr('height', h);
        group.select('.enemy-glyph-debug-label')
          .attr('y', -(h + 16) / 2 - 6)
          .text(d.label != null ? d.label : '');
        const sprite = this.querySelector('.enemy-glyph-sprite');
        if (sprite) {
          sprite.setAttribute('src', getEnemyGlyphSource(d.type, enemySprites, spriteUrls, levelConfig.enemySpritesFallbackKey));
          sprite.style.opacity = String(d.opacity ?? 1);
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
    if (showCupToggle.value && isFiniteCoord(displayCupX) && isFiniteCoord(displayCupY)) players.push({id:'cup', x:displayCupX, y:displayCupY, sprite: playerSprites.cup, w: playerGlyphSize.cup.w, h: playerGlyphSize.cup.h});
    if (showMugToggle.value && isFiniteCoord(displayMugX) && isFiniteCoord(displayMugY)) players.push({id:'mug', x:displayMugX, y:displayMugY, sprite: playerSprites.mug, w: playerGlyphSize.mug.w, h: playerGlyphSize.mug.h});
    const psel = mainSel.selectAll('.player').data(players, d=>d.id);
    psel.join(
      enter => enter.append('image').attr('class','player')
        .attr('href', d=>d.sprite)
        .attr('xlink:href', d=>d.sprite)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('width', d=>d.w).attr('height', d=>d.h)
        .attr('x', d=>d.x - d.w / 2).attr('y', d=>d.y - d.h / 2),
      update => update
        .attr('width', d=>d.w).attr('height', d=>d.h)
        .attr('x', d=>d.x - d.w / 2).attr('y', d=>d.y - d.h / 2),
      exit => exit.remove()
    )
      .each(function() { this.parentNode?.appendChild(this); });

    // deaths + hits: fade with timestamp like segments, only once currentTime has reached them
    function eventOpacity(t) {
      const dist = currentTime - t;
      if (dist < 0) return 0;
      return clamp(1 - dist / FADE_DISTANCE, 0, 1);
    }

    // deaths
    if (showDeathToggle.value) {
      function deathData(points, color, label) {
        return points
          .filter(p => p && p[0] != null && p[2] <= currentTime)
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
          .filter(p => p && p[0] != null && p[2] <= currentTime)
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

    // keep ghost/death glyphs above hit glyphs regardless of render order above
    mainSel.selectAll('.death').each(function() { this.parentNode?.appendChild(this); });

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

  const rerenderFromControls = () => {
    try {
      render();
      setSliderMarkers();
    } catch (error) {
      // ignore UI refresh failures from control clicks
    }
  };

  leftLegend.appendChild(createLegendRow({ label: 'Cup', color: '#ff0000', getter: () => showCupToggle.value, setter: v => { showCupToggle.value = v; }, onChange: rerenderFromControls }));
  leftLegend.appendChild(createLegendRow({ label: 'Mug', color: '#0000ff', getter: () => showMugToggle.value, setter: v => { showMugToggle.value = v; }, onChange: rerenderFromControls }));
  const enemyLegendSpriteKey = levelConfig.enemyLegendSpriteKey
    ?? Object.values(levelConfig.enemyGlyphSources).find((spriteKey) => spriteUrls[spriteKey]);
  leftLegend.appendChild(createLegendRow({ label: 'Enemies', color: '#40e0d0', getter: () => showEnemyToggle.value, setter: v => { showEnemyToggle.value = v; }, glyphNode: makeLegendGlyph(enemyLegendSpriteKey ? spriteUrls[enemyLegendSpriteKey] : hitSprites.C, 'rgba(64, 224, 208, 0.18)', '#40e0d0'), onChange: rerenderFromControls }));
  leftLegend.appendChild(createLegendRow({ label: 'Aggregate', color: '#6b7280', getter: () => showAggregateToggle.value, setter: v => { showAggregateToggle.value = v; }, onChange: rerenderFromControls }));
  leftLegend.appendChild(createLegendRow({ label: 'Death', color: '#000000', getter: () => showDeathToggle.value, setter: v => { showDeathToggle.value = v; }, glyphNode: makeLegendGlyph(deathSprites.C, 'transparent', 'black'), onChange: rerenderFromControls }));
  leftLegend.appendChild(createLegendRow({ label: 'Hit', color: '#000000', getter: () => showHitToggle.value, setter: v => { showHitToggle.value = v; }, glyphNode: makeLegendGlyph(hitSprites.C, 'transparent', 'black'), onChange: rerenderFromControls }));
  mainWrapper.appendChild(leftLegend);

  return container;
}