import * as d3 from "d3";

export async function createMapViewer({ data, mapUrl, showCup: initialShowCup = true, showMug: initialShowMug = true, showDeath: initialShowDeath = true, showHit: initialShowHit = true}) {

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

  // minimap set to same size as the full map image
  const miniW = mapW;
  const miniH = mapH;

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
  const feGaussian = document.createElementNS(NS, 'feGaussianBlur');
  feGaussian.setAttribute('in', 'SourceGraphic');
  feGaussian.setAttribute('stdDeviation', '6');
  haloFilter.appendChild(feGaussian);
  const feComp = document.createElementNS(NS, 'feComponentTransfer');
  const feFuncA = document.createElementNS(NS, 'feFuncA');
  feFuncA.setAttribute('type', 'linear');
  feFuncA.setAttribute('slope', '0.6');
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
  // ensure SVG scales visually but keeps internal coordinates
  miniSvg.setAttribute('viewBox', `0 0 ${mapW} ${mapH}`);
  miniSvg.style.maxWidth = "100%";
  miniSvg.style.height = "auto";

  const miniImage = document.createElementNS(NS, "image");
  // set both modern href and xlink:href for compatibility
  miniImage.setAttribute('href', mapUrl);
  miniImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
  miniImage.setAttribute("x", 0);
  miniImage.setAttribute("y", 0);
  // use the full image pixel dimensions inside the SVG coordinate system
  miniImage.setAttribute("width", mapW);
  miniImage.setAttribute("height", mapH);
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
    // richer saturation and slightly brighter lightness for a more vibrant halo
    if (hpClamped <= 1) return `hsl(0, 100%, 55%)`;
    if (hpClamped >= START_HP) return `hsl(120, 100%, 55%)`;
    const t = (hpClamped - 1) / (START_HP - 1);
    const hue = Math.round(t * 120);
    return `hsl(${hue}, 100%, 55%)`;
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
      for (let i = 1; i < points.length; i++) {
        const a = points[i-1];
        const b = points[i];
        if (!a || !b || a[0] == null || b[0] == null) continue;
        if (a[2] < start && b[2] < start) continue;
        if (a[2] > end && b[2] > end) continue;
        const opacity = segmentOpacity(a[2], b[2]);
        const tmid = (a[2] + b[2]) / 2;
        segs.push({ id: `${prefix}-${i-1}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], color, strokeWidth, opacity, who, t: tmid });
      }
      return segs;
    }

    const cupSegs = makeSegments(cup, 'red', 6, 'cup', 'cup');
    const mugSegs = makeSegments(mug, 'blue', 6, 'mug', 'mug');
    const allSegs = [];
    if (showCupToggle.value) allSegs.push(...cupSegs);
    if (showMugToggle.value) allSegs.push(...mugSegs);


    // render halo per-segment so opacity mirrors the inner line without temporal grouping quirks
    // build halo groups split by HP (hit) changes so color changes at hit points along the path
    function buildHpHaloGroups(segs) {
      const groups = [];
      if (!segs || !segs.length) return groups;
      let curHp = hpAtTime(segs[0].who, segs[0].t);
      let curWho = segs[0].who;
      let curPoints = [[segs[0].x1, segs[0].y1], [segs[0].x2, segs[0].y2]];
      let maxOp = segs[0].opacity || 0;
      let strokeW = segs[0].strokeWidth || 6;
      let tRep = segs[0].t;
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i];
        const hp = hpAtTime(s.who, s.t);
        if (hp === curHp && s.who === curWho) {
          curPoints.push([s.x2, s.y2]);
          if ((s.opacity || 0) > maxOp) { maxOp = s.opacity; tRep = s.t; }
          strokeW = Math.max(strokeW, s.strokeWidth || 6);
        } else {
          groups.push({ id: `halo-${curWho}-${groups.length}-${tRep}`, who: curWho, hp: curHp, points: curPoints.slice(), opacity: maxOp, strokeWidth: strokeW, t: tRep });
          // start new group
          curHp = hp;
          curWho = s.who;
          curPoints = [[s.x1, s.y1], [s.x2, s.y2]];
          maxOp = s.opacity || 0;
          strokeW = s.strokeWidth || 6;
          tRep = s.t;
        }
      }
      // push last
      groups.push({ id: `halo-${curWho}-${groups.length}-${tRep}`, who: curWho, hp: curHp, points: curPoints.slice(), opacity: maxOp, strokeWidth: strokeW, t: tRep });
      return groups;
    }

    const cupHaloGroups = showCupToggle.value ? buildHpHaloGroups(cupSegs) : [];
    const mugHaloGroups = showMugToggle.value ? buildHpHaloGroups(mugSegs) : [];
    const haloGroups = cupHaloGroups.concat(mugHaloGroups);

    const haloSegs = [];

    if (showCupToggle.value) haloSegs.push(...cupSegs);
    if (showMugToggle.value) haloSegs.push(...mugSegs);
    const haloSel = d3
        .select(haloLayer)
        .selectAll(".halo")
        .data(
          haloSegs, // <- flat segment list (cupSegs + mugSegs)
          d => d.id
        );
    haloSel.join(

      enter => enter.append("line")
        .attr("class", "halo")
        .attr("x1", d => d.x1)
        .attr("y1", d => d.y1)
        .attr("x2", d => d.x2)
        .attr("y2", d => d.y2)

        // HP color per segment
        .attr("stroke", d => hpColor(hpAtTime(d.who, d.t)))

        // keep fade PER SEGMENT
        .attr("stroke-opacity", d => d.opacity)

        .attr("stroke-width", d => d.strokeWidth + 26)
        .attr("stroke-linecap", "round")
        .attr("filter", "url(#halo)"),

      update => update
        .attr("x1", d => d.x1)
        .attr("y1", d => d.y1)
        .attr("x2", d => d.x2)
        .attr("y2", d => d.y2)
        .attr("stroke", d => hpColor(hpAtTime(d.who, d.t)))
        .attr("stroke-opacity", d => d.opacity)
        .attr("stroke-width", d => d.strokeWidth + 26),

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
      const deathGlyph = '☠';
      function deathData(points, color) {
        return points.filter(p=>p && p[0] != null && p[2] <= currentTime + WINDOW_DELTA).map((p,i)=>({id:`death-${i}-${p[2]}`, x:p[0], y:p[1], color, t:p[2]}));
      }
      const deaths = deathData(cupDeath,'red').concat(deathData(mugDeath,'blue'));
      const gsel = mainSel.selectAll('.death').data(deaths, d => d.id);
      gsel.join(
        enter => enter.append('text').attr('class','death')
          .attr('x', d=>d.x).attr('y', d=>d.y)
          .attr('text-anchor','middle').attr('dominant-baseline','central')
          .style('font-family','sans-serif')
          .style('font-size', d=>'65px')
          .style('stroke',d=>d.color).style('stroke-width','2px')
          .text(deathGlyph)
          .attr('opacity', d=>eventOpacity(d.t)),
        update => update.attr('x', d=>d.x).attr('y', d=>d.y).attr('opacity', d=>eventOpacity(d.t)),
        exit => exit.remove()
      );
    } else {
      mainSel.selectAll('.death').remove();
    }

    // hits
    if (showHitToggle.value) {
      const hitGlyph = '▲';
      function hitData(points, color) {
        return points.filter(p=>p && p[0] != null && p[2] <= currentTime + WINDOW_DELTA).map((p,i)=>({id:`hit-${i}-${p[2]}`, x:p[0], y:p[1], color, t:p[2]}));
      }
      const hits = hitData(cupHit,'red').concat(hitData(mugHit,'blue'));
      const gsel2 = mainSel.selectAll('.hit').data(hits, d => d.id);
      gsel2.join(
        enter => enter.append('text').attr('class','hit')
          .attr('x', d=>d.x).attr('y', d=>d.y)
          .attr('text-anchor','middle').attr('dominant-baseline','central')
          .style('font-family','sans-serif')
          .style('font-size', d=>'50px')
          .style("fill", d=>d.color)
          .style('stroke',d=>d.color).style('stroke-width','2px')
          .text(hitGlyph)
          .attr('opacity', d=>eventOpacity(d.t)),
        update => update.attr('x', d=>d.x).attr('y', d=>d.y).attr('opacity', d=>eventOpacity(d.t)),
        exit => exit.remove()
      );
    } else {
      mainSel.selectAll('.hit').remove();
    }

    // minimap: draw small scaled paths and viewport rect
    const miniSel = d3.select(miniLayers);

    const miniCupPoints = cup.filter(p=>p && p[0]!=null).map(p=>({x:p[0]*scaleX,y:p[1]*scaleY}));
    const miniMugPoints = mug.filter(p=>p && p[0]!=null).map(p=>({x:p[0]*scaleX,y:p[1]*scaleY}));

    function makePolyPoints(arr) { return arr.map(d=>`${d.x},${d.y}`).join(' '); }

    const miniCup = miniSel.selectAll('.mini-cup').data(showCupToggle.value ? [miniCupPoints] : []);
    miniCup.join(
      enter => enter.append('polyline').attr('class','mini-cup')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','red').attr('stroke-width',1),
      update => update.attr('points', makePolyPoints).attr('stroke','red').attr('stroke-width',1),
      exit => exit.remove()
    );

    const miniMug = miniSel.selectAll('.mini-mug').data(showMugToggle.value ? [miniMugPoints] : []);
    miniMug.join(
      enter => enter.append('polyline').attr('class','mini-mug')
        .attr('points', makePolyPoints)
        .attr('fill','none').attr('stroke','blue').attr('stroke-width',1),
      update => update.attr('points', makePolyPoints).attr('stroke','blue').attr('stroke-width',1),
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
        .attr('fill','none').attr('stroke','lime').attr('stroke-width',1),
      update => update.attr('x',d=>d.x).attr('y',d=>d.y).attr('width',d=>d.w).attr('height',d=>d.h),
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

  function makeLegendRow(label, color, getter, setter) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.cursor = 'pointer';
    row.style.userSelect = 'none';

    const swatch = document.createElement('div');
    swatch.style.width = '14px';
    swatch.style.height = '14px';
    swatch.style.background = color;
    swatch.style.borderRadius = '2px';
    swatch.style.border = '1px solid #666';

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
  leftLegend.appendChild(makeLegendRow('Death', '#000000', () => showDeathToggle.value, v => { showDeathToggle.value = v; }));
  leftLegend.appendChild(makeLegendRow('Hit', '#000000', () => showHitToggle.value, v => { showHitToggle.value = v; }))
  mainWrapper.appendChild(leftLegend);

  return container;
}