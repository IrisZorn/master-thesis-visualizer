import * as d3 from "d3";

export async function createMapViewer({ data, mapUrl, spriteUrls = {}, showCup: initialShowCup = true, showMug: initialShowMug = true, showDeath: initialShowDeath = true, showHit: initialShowHit = true}) {

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

  const cup = data[0]["3"];
  const mug = data[0]["8"];
  const cupDeath = data[0]["5"] || [];
  const mugDeath = data[0]["9"] || [];
  const deathSprites = {
    C: spriteUrls.cupDeath,
    M: spriteUrls.mugDeath
  };
  const hitSprites = {
    C: spriteUrls.cupHit,
    M: spriteUrls.mugHit
  };
  // hit events: see constants_forest_follies.py (cuphead_hit='6', mugman_hit='10')
  const cupHit = data[0]["6"] || [];
  const mugHit = data[0]["10"] || [];

  /* ---------------- TIME ---------------- */

  let currentTime = 0;

  const maxTime = Math.max(
    cup[cup.length - 1][2],
    mug[mug.length - 1][2]
  );

  /* ---------------- SLIDER ---------------- */

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = maxTime;
  slider.step = 0.1;
  slider.value = 0;
  slider.style.width = "100%";

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

  function makeLegendGlyph(spriteUrl, backgroundColor) {
    const glyph = document.createElement('div');
    glyph.style.width = '28px';
    glyph.style.height = '34px';
    glyph.style.borderRadius = '6px';
    glyph.style.border = '1px solid white';
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
    if (showCupToggle.value && isFiniteCoord(displayCupX) && isFiniteCoord(displayCupY)) players.push({id:'cup', x:displayCupX,y:displayCupY,color:'red',r:5});
    if (showMugToggle.value && isFiniteCoord(displayMugX) && isFiniteCoord(displayMugY)) players.push({id:'mug', x:displayMugX,y:displayMugY,color:'blue',r:5});
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

    function miniWindowPoints(points) {
      return points
        .filter(p => p && p[0] != null && Math.abs(p[2] - currentTime) <= WINDOW_DELTA)
        .map(p => ({ x: p[0] * scaleX, y: p[1] * scaleY }));
    }

    const miniCupPoints = cup.filter(p => p && p[0] != null).map(p => ({ x: p[0] * scaleX, y: p[1] * scaleY }));
    const miniMugPoints = mug.filter(p => p && p[0] != null).map(p => ({ x: p[0] * scaleX, y: p[1] * scaleY }));
    const miniCupWindowPoints = miniWindowPoints(cup);
    const miniMugWindowPoints = miniWindowPoints(mug);

    function makePolyPoints(arr) { return arr.map(d=>`${d.x},${d.y}`).join(' '); }

    const miniCup = miniSel.selectAll('.mini-cup').data(showCupToggle.value ? [miniCupPoints] : []);
    miniCup.join(
      enter => enter.append('polyline').attr('class','mini-cup')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','red').attr('stroke-width',3),
      update => update.attr('points', makePolyPoints).attr('stroke','red').attr('stroke-width',3),
      exit => exit.remove()
    );

    const miniMug = miniSel.selectAll('.mini-mug').data(showMugToggle.value ? [miniMugPoints] : []);
    miniMug.join(
      enter => enter.append('polyline').attr('class','mini-mug')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','blue').attr('stroke-width',3),
      update => update.attr('points', makePolyPoints).attr('stroke','blue').attr('stroke-width',3),
      exit => exit.remove()
    );

    const miniCupWindow = miniSel.selectAll('.mini-cup-window').data(showCupToggle.value && miniCupWindowPoints.length > 1 ? [miniCupWindowPoints] : []);
    miniCupWindow.join(
      enter => enter.append('polyline').attr('class','mini-cup-window')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','red').attr('stroke-width',6),
      update => update.attr('points', makePolyPoints).attr('stroke','red').attr('stroke-width',6),
      exit => exit.remove()
    );

    const miniMugWindow = miniSel.selectAll('.mini-mug-window').data(showMugToggle.value && miniMugWindowPoints.length > 1 ? [miniMugWindowPoints] : []);
    miniMugWindow.join(
      enter => enter.append('polyline').attr('class','mini-mug-window')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','blue').attr('stroke-width',6),
      update => update.attr('points', makePolyPoints).attr('stroke','blue').attr('stroke-width',6),
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

  /* ---------------- CONTAINER ---------------- */
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';

  container.append(miniSvg, mainSvg, slider);

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
      try { render(); } catch (e) { /* ignore */ }
    });

    refreshRow();
    row.appendChild(swatch);
    row.appendChild(txt);
    return row;
  }

  leftLegend.appendChild(makeLegendRow('Cup', '#ff0000', () => showCupToggle.value, v => { showCupToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Mug', '#0000ff', () => showMugToggle.value, v => { showMugToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Death', '#000000', () => showDeathToggle.value, v => { showDeathToggle.value = v; }, makeLegendGlyph(deathSprites.C, '#d62828')));
  leftLegend.appendChild(makeLegendRow('Hit', '#000000', () => showHitToggle.value, v => { showHitToggle.value = v; }, makeLegendGlyph(hitSprites.C, '#d62828')))
  mainWrapper.appendChild(leftLegend);

  return container;
}