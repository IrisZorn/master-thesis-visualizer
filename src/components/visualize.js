import * as d3 from "d3";
import { parseEnemySizes } from "./level-config.js";
import { Toggle, createLegendRow, createSliderMarkers, createStageButtons, drawStageBoundaryMarkers, makeLegendGlyph, makeLegendGradientGlyph } from "./viewer-controls.js";
import { createEnemyVisualBuilder, getEnemyGlyphSize, getEnemyGlyphSource } from "./viewer-enemies.js";
import { buildBulletArrows, enemyBulletPresenceByAnchor } from "./viewer-bullets.js";
import { BAND_BLUR_RADIUS, HEATMAP_COLORS, createEnemyHeatmapBuilder } from "./viewer-heatmap.js";
import { clamp, findCurrentIndex, flattenEnemyPaths, makePathD, validTimedPoints } from "./viewer-helpers.js";

export async function createMapViewer({
  data: providedData,
  curr_playthrough = null,
  aggr_players = null,
  totalRuns = null,
  mapUrl,
  spriteUrls = {},
  enemySizesText = "",
  levelConfig,
  showMinimap = true,
  showCup: initialShowCup = true,
  showMug: initialShowMug = true,
  showDeath: initialShowDeath = true,
  showHit: initialShowHit = true,
  showAggregate: initialShowAggregate = true,
  showHeatmap: initialShowHeatmap = false,
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

  // bleaches the background toward white so paths/heatmap drawn on top read more clearly
  const mainImageWash = document.createElementNS(NS, "rect");
  mainImageWash.setAttribute("x", 0);
  mainImageWash.setAttribute("y", 0);
  mainImageWash.setAttribute("width", mapW);
  mainImageWash.setAttribute("height", mapH);
  mainImageWash.setAttribute("fill", "white");
  mainImageWash.setAttribute("fill-opacity", "0.3");
  mainImageWash.style.pointerEvents = "none";
  mainSvg.appendChild(mainImageWash);

  // aggregated enemy density field: sits directly above the background image and below the halo
  // and main layers, so switching it on never obscures the run being scrubbed
  const heatmapLayer = document.createElementNS(NS, 'g');
  heatmapLayer.setAttribute('class', 'heatmap-layer');
  heatmapLayer.setAttribute('filter', 'url(#heat-blur)');
  heatmapLayer.style.pointerEvents = 'none';
  mainSvg.appendChild(heatmapLayer);

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

  // blurs the rendered heatmap bands themselves (not just the density data behind them, which
  // viewer-heatmap.js already smooths before contouring): each band is still a flat-fill polygon,
  // so without this the color/opacity jumps hard at every ring boundary. This blends across those
  // boundaries so adjacent rings read as a continuous gradient instead of a stepped/banded look.
  // Shared by both the main and minimap heatmap layers, each of which sits in the same grid-cell
  // coordinate space as the contour geometry (see BAND_BLUR_RADIUS in viewer-heatmap.js) before
  // its own transform scales it up to screen pixels.
  const heatBlurFilter = document.createElementNS(NS, 'filter');
  heatBlurFilter.setAttribute('id', 'heat-blur');
  heatBlurFilter.setAttribute('x', '-30%');
  heatBlurFilter.setAttribute('y', '-30%');
  heatBlurFilter.setAttribute('width', '160%');
  heatBlurFilter.setAttribute('height', '160%');
  const heatBlurGaussian = document.createElementNS(NS, 'feGaussianBlur');
  heatBlurGaussian.setAttribute('in', 'SourceGraphic');
  heatBlurGaussian.setAttribute('stdDeviation', String(BAND_BLUR_RADIUS));
  heatBlurFilter.appendChild(heatBlurGaussian);
  defs.appendChild(heatBlurFilter);

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

  let miniSvg = null, miniHeatmapLayer = null, miniLayers = null;
  if (showMinimap) {
    miniSvg = document.createElementNS(NS, "svg");
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

    // bleaches the background toward white so paths/heatmap drawn on top read more clearly
    const miniImageWash = document.createElementNS(NS, "rect");
    miniImageWash.setAttribute("x", 0);
    miniImageWash.setAttribute("y", 0);
    miniImageWash.setAttribute("width", miniW);
    miniImageWash.setAttribute("height", miniH);
    miniImageWash.setAttribute("fill", "white");
    miniImageWash.setAttribute("fill-opacity", "0.3");
    miniImageWash.style.pointerEvents = "none";
    miniSvg.appendChild(miniImageWash);

    miniHeatmapLayer = document.createElementNS(NS, "g");
    miniHeatmapLayer.setAttribute("class", "mini-heatmap-layer");
    miniHeatmapLayer.setAttribute("filter", "url(#heat-blur)");
    miniHeatmapLayer.style.pointerEvents = "none";
    miniSvg.appendChild(miniHeatmapLayer);

    miniLayers = document.createElementNS(NS, "g");
    miniLayers.setAttribute("class", "mini-layers");
    miniSvg.appendChild(miniLayers);
  }

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
  // bullet-direction-arrow feature (see viewer-bullets.js): per-shot tracks for each configured
  // bullet type, plus each "enemy" bullet's owner anchors (only stationary enemies have anchors
  // in aggr_players.enemies) -- empty on a level with no bulletConfig.
  const bulletConfig = levelConfig.bulletConfig || {};
  const bulletPathsByType = Object.fromEntries(
    Object.keys(bulletConfig).map((type) => [type, data[0][type] || []])
  );
  const enemyAnchorsByType = {};
  for (const config of Object.values(bulletConfig)) {
    if (config.owner === "enemy" && !enemyAnchorsByType[config.enemyType]) {
      enemyAnchorsByType[config.enemyType] = aggr_players?.enemies?.[config.enemyType]?.anchors || [];
    }
  }
  // lets a dead shroom's fade wait until its own bullet's arrow is gone (see viewer-enemies.js)
  const bulletPresenceByAnchor = enemyBulletPresenceByAnchor({ bulletPathsByType, bulletConfig, enemyAnchorsByType });
  // level-wide fallback, used before any stage data exists or on a level with no stages at all
  // (aggr_players.stages absent) -- render() below picks the active stage's own aggregate instead
  // when one is available, so the pooled path/heatmap actually change as playback crosses a stage
  // boundary rather than always showing the whole level's aggregate.
  const baseAggCup = aggr_players?.[levelConfig.playerTypes.cup] || [];
  const baseAggMug = aggr_players?.[levelConfig.playerTypes.mug] || [];
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
  // some levels have no hit-reaction detection stream at all (e.g. Wally Warbles) -- without one
  // there's nothing to base an HP count on, so the HP halo and its legend entry are hidden
  // entirely rather than showing a halo that's always full HP.
  const hasHitTracking = Boolean(levelConfig.playerTypes.cupHit || levelConfig.playerTypes.mugHit);
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

  // cup/mug (the main path) has each death/hit's own position folded into it (see
  // coords_transform.py's clean_player_path) so the trail-line segments have somewhere to end
  // at a death/hit instead of jumping straight across the gap -- but that same real coordinate
  // makes a ghost/hit point look like a live position to findCurrentIndex, which just holds at
  // "the last point at or before currentTime" with no notion of which points are real gameplay.
  // Cross-referencing against these timestamps lets the render loop below tell the two apart.
  const cupNonLiveTimes = new Set([...cupDeath, ...cupHit].map(p => p[2]));
  const mugNonLiveTimes = new Set([...mugDeath, ...mugHit].map(p => p[2]));

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

  /* ---------------- STAGES ---------------- */
  // data[0].stage_starts (see coords_transform.stage_start_times) is only present on levels with
  // STAGES (e.g. Wally Warbles) -- absent on Forest Follies, which leaves stageStarts empty and
  // skips this whole block.
  const stageStarts = data[0].stage_starts || [];
  const stageNames = levelConfig.stageNames || [];
  let stageButtonsRow = null;

  if (stageStarts.length) {
    const stageMarkersLayer = document.createElement('div');
    stageMarkersLayer.style.position = 'absolute';
    stageMarkersLayer.style.left = '0';
    stageMarkersLayer.style.right = '0';
    stageMarkersLayer.style.top = '0';
    stageMarkersLayer.style.bottom = '0';
    stageMarkersLayer.style.pointerEvents = 'none';
    sliderWrapper.appendChild(stageMarkersLayer);

    drawStageBoundaryMarkers({ layer: stageMarkersLayer, startTime, maxTime, stageStarts, stageNames });

    stageButtonsRow = createStageButtons({
      stageStarts,
      stageNames,
      onSelect: (t) => {
        slider.value = t;
        currentTime = t;
        render();
      },
    });
  }

  // highest stage index whose start has passed, or null on a level with no stages (stageStarts
  // empty) -- used to pick which stage's own aggregate (pooled path/heatmap) is showing right now.
  function currentStageIndex() {
    if (!stageStarts.length) return null;
    let index = null;
    for (let i = 0; i < stageStarts.length; i++) {
      const t = stageStarts[i];
      if (t != null && t <= currentTime) index = i;
    }
    return index;
  }

  /* ---------------- LAYER TOGGLES / POPUP LEGEND ---------------- */
  // Layer visibility flags (use small Toggle helper for clarity)
  const showCupToggle = new Toggle(initialShowCup);
  const showMugToggle = new Toggle(initialShowMug);
  const showDeathToggle = new Toggle(initialShowDeath);
  const showHitToggle = new Toggle(initialShowHit);
  const showEnemyToggle = new Toggle(true);
  const showAggregateToggle = new Toggle(initialShowAggregate);
  const showHeatmapToggle = new Toggle(initialShowHeatmap);

  // built from the aggregate across playthroughs (build_aggregate_data.py's
  // aggregate_enemy_density), not from the run currently being scrubbed -- missing if the data
  // loader's cache predates that key, in which case the overlay simply stays empty. Level-wide
  // fallback, used before any stage data exists or on a level with no stages.
  const getBaseHeatmap = createEnemyHeatmapBuilder({ density: aggr_players?.enemy_density });

  // one lazily-built, cached heatmap per stage (agg_coords_[level].json.py's aggregated_paths.stages
  // -- each stage's own aggregate_enemy_density), so the field actually changes as playback crosses
  // a stage boundary instead of always showing the whole level's density. Mirrors getBaseHeatmap's
  // own build-once-then-cache behavior, just keyed per stage rather than one fixed density.
  const stageHeatmapBuilders = new Map();
  function getHeatmapForStage(stageIndex) {
    const stageData = stageIndex != null ? aggr_players?.stages?.[stageIndex] : null;
    if (!stageData) return getBaseHeatmap();
    if (!stageHeatmapBuilders.has(stageIndex)) {
      stageHeatmapBuilders.set(stageIndex, createEnemyHeatmapBuilder({ density: stageData.enemy_density }));
    }
    return stageHeatmapBuilders.get(stageIndex)();
  }

  const enemyPaths = flattenEnemyPaths(enemyPathsByType);
  const { buildEnemyVisuals, filterRecentPoints, computeEnemyDisappearances } = createEnemyVisualBuilder({
    currentTimeProvider: () => currentTime,
    windowDelta: WINDOW_DELTA,
    enemyAggregates,
    enemyPathsByType,
    enemyPaths,
    stationaryEnemyTypes,
    centeredGlyphEnemyTypes,
    fixedHorizontalEnemyTypes: levelConfig.fixedHorizontalEnemyTypes,
    neverFadeEnemyTypes: levelConfig.neverFadeEnemyTypes,
    holdLastPositionEnemyTypes: levelConfig.holdLastPositionEnemyTypes,
    minimizingEnemyTypes: levelConfig.minimizingEnemyTypes,
    minimizingChainDistance: levelConfig.minimizingChainDistance,
    enemyInstanceXThreshold: ENEMY_INSTANCE_X_THRESHOLD,
    stationaryInstanceThreshold: STATIONARY_INSTANCE_THRESHOLD,
    showEnemy: () => showEnemyToggle.value,
    stageStarts,
    enemyStageIndex: levelConfig.enemyStageIndex || {},
    mapWidth: mapW,
    bulletPresenceByAnchor,
  });

  // Enemies Hit stat: a raw disappearance (see computeEnemyDisappearances) only counts as a hit
  // if the enemy's last known x position was still within (or ahead of) the camera's viewport at
  // that moment -- otherwise it's just the camera scrolling past a still-alive enemy, which looks
  // identical to a hit from the detection data alone. cameraLeftEdgeAtTime mirrors render()'s own
  // follow-camera math (see cameraX below) but evaluated at the disappearance's own timestamp
  // instead of currentTime, using each player's last live position at-or-before that time. On a
  // level with a static camera (e.g. Wally Warbles, viewportW === mapW) this always clamps to 0,
  // so every disappearance passes -- exactly the no-op that's expected there.
  function lastLiveX(path, nonLiveTimes, t) {
    let x = null;
    for (const point of path) {
      if (!point || point[2] == null) continue;
      if (point[2] > t) break;
      if (nonLiveTimes.has(point[2])) continue;
      if (isFiniteCoord(point[0])) x = point[0];
    }
    return x;
  }
  function followXAtTime(t) {
    const cupX = lastLiveX(cup, cupNonLiveTimes, t);
    const mugX = lastLiveX(mug, mugNonLiveTimes, t);
    if (cupX != null && mugX != null) return (cupX + mugX) / 2;
    if (cupX != null) return cupX;
    if (mugX != null) return mugX;
    return null;
  }
  function cameraLeftEdgeAtTime(t) {
    const followX = followXAtTime(t);
    if (followX == null) return null;
    return clamp(followX - viewportW / 2, 0, mapW - viewportW);
  }
  // computeEnemyDisappearances (viewer-enemies.js) already excludes an enemy that was still
  // moving into the map's own left/right boundary when tracking ended -- that's flying off the
  // level alive (e.g. Wally Warbles' nailbird routinely exits off the static screen's edge), not a
  // hit, and buildEnemyVisuals skips its grey fade on screen for the same reason. What's left here
  // only needs the camera-scroll check below.
  const enemyHitEvents = computeEnemyDisappearances()
    .filter((event) => levelConfig.countableEnemyTypes.has(event.type))
    .filter((event) => {
      const leftEdge = cameraLeftEdgeAtTime(event.timestamp);
      if (leftEdge == null) return true;
      return event.x >= leftEdge;
    })
    .map((event) => event.timestamp);

  /* ---------------- STATS PANEL (right of the map) ---------------- */
  // Built once here (not in the CONTAINER section below) so it already exists by the time the
  // first render() call runs -- render() updates these rows' values directly rather than
  // recreating them every frame.
  const statsPanel = document.createElement('div');
  statsPanel.style.position = 'absolute';
  statsPanel.style.top = '10px';
  statsPanel.style.right = '10px';
  statsPanel.style.background = 'white';
  statsPanel.style.border = '1px solid #ccc';
  statsPanel.style.borderRadius = '4px';
  statsPanel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
  statsPanel.style.padding = '6px 8px';
  statsPanel.style.fontFamily = 'sans-serif';
  statsPanel.style.fontSize = '13px';
  statsPanel.style.display = 'flex';
  statsPanel.style.flexDirection = 'column';
  statsPanel.style.gap = '6px';
  statsPanel.style.width = '180px';
  statsPanel.style.boxSizing = 'border-box';
  statsPanel.style.zIndex = '1000';

  // header row toggles the body's visibility, same collapse pattern as the map legend
  // (legendHeader/legendBody below)
  const statsHeader = document.createElement('div');
  statsHeader.style.display = 'flex';
  statsHeader.style.alignItems = 'center';
  statsHeader.style.justifyContent = 'space-between';
  statsHeader.style.gap = '12px';
  statsHeader.style.cursor = 'pointer';
  statsHeader.style.userSelect = 'none';
  statsHeader.style.fontWeight = 'bold';

  const statsTitle = document.createElement('div');
  statsTitle.textContent = 'Run Statistics';

  const statsArrow = document.createElement('div');
  statsArrow.textContent = '▾'; // ▾, flips to ▸ when collapsed
  statsArrow.style.fontSize = '12px';

  statsHeader.append(statsTitle, statsArrow);

  const statsBody = document.createElement('div');
  statsBody.style.display = 'flex';
  statsBody.style.flexDirection = 'column';
  statsBody.style.gap = '6px';

  let statsCollapsed = false;
  statsHeader.addEventListener('click', () => {
    statsCollapsed = !statsCollapsed;
    statsBody.style.display = statsCollapsed ? 'none' : 'flex';
    statsArrow.textContent = statsCollapsed ? '▸' : '▾';
  });

  statsPanel.append(statsHeader, statsBody);

  function createStatRow(label) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.style.fontWeight = 'bold';
    row.append(labelEl, valueEl);
    statsBody.appendChild(row);
    return { row, valueEl };
  }

  const retriesStat = createStatRow('Retries');
  if (totalRuns != null) {
    retriesStat.valueEl.textContent = String(totalRuns - 1);
  } else {
    retriesStat.row.style.display = 'none';
  }

  // a single-player recording has the other player's streams merged away to empty arrays (see
  // coords_transform.py's merge_into_primary_player) -- no point showing a player's rows at all
  // when they were never in the run, rather than showing them stuck at 0.
  const hasCup = cup.length > 0;
  const hasMug = mug.length > 0;

  // no hit-reaction detection stream on a level like Wally Warbles (see hasHitTracking above) --
  // there's nothing to count, so these two rows aren't created at all rather than showing 0s.
  const cupHitsStat = (hasHitTracking && hasCup) ? createStatRow('Cuphead Hits') : null;
  const mugHitsStat = (hasHitTracking && hasMug) ? createStatRow('Mugman Hits') : null;
  const cupDeathsStat = hasCup ? createStatRow('Cuphead Deaths') : null;
  const mugDeathsStat = hasMug ? createStatRow('Mugman Deaths') : null;
  const enemyHitsStat = createStatRow('Enemies Hit');

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
    startTime,
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
    // pick the currently active stage's own pooled path (falls back to the level-wide aggregate
    // before any stage starts, or on a level with no stages at all) -- shadows the module-level
    // baseAggCup/baseAggMug for the rest of this render pass so every use below (main overlay,
    // minimap) automatically follows the same choice.
    const stageIndex = currentStageIndex();
    const stageAggregate = stageIndex != null ? aggr_players?.stages?.[stageIndex] : null;
    const aggCup = stageAggregate ? (stageAggregate[levelConfig.playerTypes.cup] || []) : baseAggCup;
    const aggMug = stageAggregate ? (stageAggregate[levelConfig.playerTypes.mug] || []) : baseAggMug;

    const cupIndex = findCurrentIndex(cup, currentTime);
    const mugIndex = findCurrentIndex(mug, currentTime);

    const cupSample = cup[cupIndex] || [null, null, 0];
    const mugSample = mug[mugIndex] || [null, null, 0];

    // a held-over sample that's actually a death/hit marker (see cupNonLiveTimes/mugNonLiveTimes
    // above) isn't a live position, even though it carries real coordinates for the trail line
    const cupIsLive = !cupNonLiveTimes.has(cupSample[2]);
    const mugIsLive = !mugNonLiveTimes.has(mugSample[2]);
    const cupX = cupIsLive ? cupSample[0] : null, cupY = cupIsLive ? cupSample[1] : null;
    const mugX = mugIsLive ? mugSample[0] : null, mugY = mugIsLive ? mugSample[1] : null;

    // bullet-direction-arrow origins for "player" bullets (see viewer-bullets.js) -- only
    // currently-live players count, since a dead/undetected one can't be the one shooting. Each
    // carries its own trail color ('red'/'blue', matching makeSegments below) so the arrow reads
    // as "this player's shot" rather than a fixed, player-agnostic color.
    const bulletPlayerPositions = [
      { x: cupX, y: cupY, color: 'red' },
      { x: mugX, y: mugY, color: 'blue' },
    ].filter((p) => isFiniteCoord(p.x) && isFiniteCoord(p.y));

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

    // enemy heatmap: aggregated over every playthrough within the currently active stage (falls
    // back to the level-wide field before any stage starts, or on a level with no stages), so it
    // only changes when currentTime crosses a stage boundary, not on every scrub. Each stage's
    // contours are built once on first activation and cached from then on (see getHeatmapForStage).
    // The contour geometry is in grid cells, so each layer scales it into its own coordinate space.
    const heatmap = showHeatmapToggle.value ? getHeatmapForStage(stageIndex) : null;
    const heatmapBands = heatmap?.bands ?? [];

    function joinHeatmapBands(layer, className, transform) {
      const sel = d3.select(layer).selectAll(`.${className}`).data(heatmapBands, d => d.id);
      sel.join(
        enter => enter.append('path').attr('class', className)
          .attr('d', d => d.d)
          .attr('fill', d => d.fill)
          .attr('fill-opacity', d => d.opacity)
          .attr('stroke', 'none'),
        update => update
          .attr('d', d => d.d)
          .attr('fill', d => d.fill)
          .attr('fill-opacity', d => d.opacity),
        exit => exit.remove()
      );
      if (transform) layer.setAttribute('transform', transform);
      else layer.removeAttribute('transform');
    }

    joinHeatmapBands(heatmapLayer, 'heat-band', heatmap ? `scale(${heatmap.cellSize})` : null);
    if (showMinimap) {
      joinHeatmapBands(
        miniHeatmapLayer,
        'mini-heat-band',
        heatmap ? `scale(${heatmap.cellSize * scaleX}, ${heatmap.cellSize * scaleY})` : null
      );
    }

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
    if (hasHitTracking) {
      if (showCupToggle.value) haloGroups.push(...buildHpTrailGroups(cupSegs));
      if (showMugToggle.value) haloGroups.push(...buildHpTrailGroups(mugSegs));
    }

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

    const bulletArrows = buildBulletArrows({
      time: currentTime,
      bulletPathsByType,
      bulletConfig,
      enemyAnchorsByType,
      playerPositions: bulletPlayerPositions,
    });

    const bulletArrowSel = mainSel.selectAll('.bullet-arrow').data(bulletArrows, d => d.id);
    bulletArrowSel.join(
      enter => enter.append('line').attr('class', 'bullet-arrow')
        .attr('x1', d => d.x1).attr('y1', d => d.y1)
        .attr('x2', d => d.x2).attr('y2', d => d.y2)
        .attr('stroke', d => d.color)
        .attr('stroke-width', 10)
        .attr('stroke-linecap', 'round')
        .attr('marker-end', 'url(#enemy-arrow)'),
      update => update
        .attr('x1', d => d.x1).attr('y1', d => d.y1)
        .attr('x2', d => d.x2).attr('y2', d => d.y2)
        .attr('stroke', d => d.color),
      exit => exit.remove()
    );

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
      .attr('opacity', d => d.opacity ?? 1)
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

    // players: draw cup and mug separately based on flags -- no last-valid fallback here (unlike
    // the camera-follow logic above, which needs it to avoid jerking during a temporary death):
    // the glyph should only appear where a player is currently detected, so it disappears for
    // the whole of any gap (temporary death/ghost or the final one) and reappears on its own
    // once real detection resumes (e.g. a revival), instead of staying frozen at their last
    // known spot for the duration of the gap. cupIsLive/mugIsLive alone only catches a held
    // sample that's itself a flagged death/hit point -- it says nothing about a track that simply
    // ends on an ordinary live point (an undetected death, or track loss near a run's end), so
    // this also bounds display to each player's own last known timestamp, same as cupHasFollow/
    // mugHasFollow above.
    const displayCupX = currentTime <= cupMaxTime ? cupX : null;
    const displayCupY = currentTime <= cupMaxTime ? cupY : null;
    const displayMugX = currentTime <= mugMaxTime ? mugX : null;
    const displayMugY = currentTime <= mugMaxTime ? mugY : null;

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
    if (showMinimap) {
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

    // stats panel: running counts up to currentTime, so they build up as the timeline is scrubbed.
    // A row is null (and never rendered) for a player who isn't in this run at all -- see hasCup/
    // hasMug above -- so every update here is guarded rather than assuming both rows exist.
    if (cupHitsStat) cupHitsStat.valueEl.textContent = String(cupHit.filter(p => p[2] <= currentTime).length);
    if (mugHitsStat) mugHitsStat.valueEl.textContent = String(mugHit.filter(p => p[2] <= currentTime).length);
    if (cupDeathsStat) cupDeathsStat.valueEl.textContent = String(cupDeath.filter(p => p[2] <= currentTime).length);
    if (mugDeathsStat) mugDeathsStat.valueEl.textContent = String(mugDeath.filter(p => p[2] <= currentTime).length);
    enemyHitsStat.valueEl.textContent = String(enemyHitEvents.filter(t => t <= currentTime).length);
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

  if (showMinimap) container.append(miniSvg);
  container.append(mainSvg, sliderWrapper);
  if (stageButtonsRow) container.append(stageButtonsRow);

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
  mainWrapper.appendChild(statsPanel);

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
  leftLegend.style.fontSize = '13px';
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

  // header row toggles the body's visibility -- collapsed by default state stays expanded, only
  // the arrow glyph and body display flip, so nothing about the legend's own toggles is affected
  const legendHeader = document.createElement('div');
  legendHeader.style.display = 'flex';
  legendHeader.style.alignItems = 'center';
  legendHeader.style.justifyContent = 'space-between';
  legendHeader.style.gap = '12px';
  legendHeader.style.cursor = 'pointer';
  legendHeader.style.userSelect = 'none';
  legendHeader.style.fontWeight = 'bold';

  const legendTitle = document.createElement('div');
  legendTitle.textContent = 'Legend';

  const legendArrow = document.createElement('div');
  legendArrow.textContent = '▾'; // ▾, flips to ▸ when collapsed
  legendArrow.style.fontSize = '12px';

  legendHeader.append(legendTitle, legendArrow);

  const legendBody = document.createElement('div');
  legendBody.style.display = 'flex';
  legendBody.style.flexDirection = 'column';
  legendBody.style.gap = '6px';

  let legendCollapsed = false;
  legendHeader.addEventListener('click', () => {
    legendCollapsed = !legendCollapsed;
    legendBody.style.display = legendCollapsed ? 'none' : 'flex';
    legendArrow.textContent = legendCollapsed ? '▸' : '▾';
  });

  legendBody.appendChild(createLegendRow({ label: 'Cup', color: '#ff0000', getter: () => showCupToggle.value, setter: v => { showCupToggle.value = v; }, onChange: rerenderFromControls }));
  legendBody.appendChild(createLegendRow({ label: 'Mug', color: '#0000ff', getter: () => showMugToggle.value, setter: v => { showMugToggle.value = v; }, onChange: rerenderFromControls }));
  const enemyLegendSpriteKey = levelConfig.enemyLegendSpriteKey
    ?? Object.values(levelConfig.enemyGlyphSources).find((spriteKey) => spriteUrls[spriteKey]);
  legendBody.appendChild(createLegendRow({ label: 'Enemies', color: '#40e0d0', getter: () => showEnemyToggle.value, setter: v => { showEnemyToggle.value = v; }, glyphNode: makeLegendGlyph(enemyLegendSpriteKey ? spriteUrls[enemyLegendSpriteKey] : hitSprites.C, 'rgba(64, 224, 208, 0.18)', '#40e0d0'), onChange: rerenderFromControls }));
  legendBody.appendChild(createLegendRow({ label: 'Enemy heatmap', color: HEATMAP_COLORS[HEATMAP_COLORS.length - 1], getter: () => showHeatmapToggle.value, setter: v => { showHeatmapToggle.value = v; }, glyphNode: makeLegendGradientGlyph(HEATMAP_COLORS), onChange: rerenderFromControls }));
  legendBody.appendChild(createLegendRow({ label: 'Aggregate', color: '#6b7280', getter: () => showAggregateToggle.value, setter: v => { showAggregateToggle.value = v; }, onChange: rerenderFromControls }));
  legendBody.appendChild(createLegendRow({ label: 'Death', color: '#000000', getter: () => showDeathToggle.value, setter: v => { showDeathToggle.value = v; }, glyphNode: makeLegendGlyph(deathSprites.C, 'transparent', 'black'), onChange: rerenderFromControls }));
  if (hasHitTracking) {
    legendBody.appendChild(createLegendRow({ label: 'Hit', color: '#000000', getter: () => showHitToggle.value, setter: v => { showHitToggle.value = v; }, glyphNode: makeLegendGlyph(hitSprites.C, 'transparent', 'black'), onChange: rerenderFromControls }));
  }
  leftLegend.append(legendHeader, legendBody);
  mainWrapper.appendChild(leftLegend);

  return container;
}