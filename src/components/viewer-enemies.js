import * as d3 from "d3";
import { clamp, getLastTimedPoint, pointAtFraction, validTimedPoints } from "./viewer-helpers.js";

export function getEnemyGlyphSource(enemyType, enemySprites, spriteUrls, fallbackKey) {
  return enemySprites[enemyType] || spriteUrls[fallbackKey] || spriteUrls.cupHit;
}

export function getEnemyGlyphSize(type, enemyGlyphSize, defaultGlyphSize) {
  return enemyGlyphSize[type] ?? defaultGlyphSize;
}

export function createEnemyVisualBuilder({
  currentTimeProvider,
  windowDelta,
  enemyAggregates,
  enemyPathsByType,
  enemyPaths,
  stationaryEnemyTypes,
  centeredGlyphEnemyTypes,
  fixedHorizontalEnemyTypes = new Set(),
  neverFadeEnemyTypes = new Set(),
  holdLastPositionEnemyTypes = new Set(),
  minimizingEnemyTypes = new Set(),
  minimizingChainDistance = 700,
  enemyInstanceXThreshold,
  stationaryInstanceThreshold,
  showEnemy,
  stageStarts = [],
  enemyStageIndex = {},
}) {
  // highest stage index whose start has passed, or null on a level with no stages (stageStarts
  // empty) -- stage 0's start is always defined (the run's own stable start), so this is only
  // null before any stage data exists at all.
  function currentStageIndex() {
    if (!stageStarts.length) return null;
    const time = currentTimeProvider();
    let index = null;
    for (let i = 0; i < stageStarts.length; i++) {
      const t = stageStarts[i];
      if (t != null && t <= time) index = i;
    }
    return index;
  }

  // shared by full-path-instances and stationary matching: an instance is "active" only while
  // we're still within its matched live track's last known detection -- no fade-out grace
  // period, so it greys out the instant tracking stops, not windowDelta later.
  function getLastDetectionTime(liveTrack, minClusterSize) {
    const liveTrackPoints = liveTrack ? validTimedPoints(liveTrack) : [];
    if (liveTrackPoints.length < minClusterSize) return null;
    const lastDetection = liveTrackPoints[liveTrackPoints.length - 1];
    return lastDetection ? lastDetection[2] : null;
  }

  function isInstanceActive(liveTrack, minClusterSize) {
    const lastDetection = getLastDetectionTime(liveTrack, minClusterSize);
    return lastDetection != null && currentTimeProvider() <= lastDetection;
  }

  // once an instance/track goes inactive it keeps fading the longer it's been since last seen,
  // all the way to fully invisible, instead of snapping to one fixed grey and staying there
  // forever.
  const GREY_FADE_WINDOW = windowDelta * 2;
  function instanceVisibility(lastDetection) {
    if (lastDetection == null) return 0;
    const elapsed = currentTimeProvider() - lastDetection;
    if (elapsed <= 0) return 1;
    return 1 - clamp(elapsed / GREY_FADE_WINDOW, 0, 1);
  }

  // Across a detection gap the last known position is held rather than dropping to the resting
  // position and back -- during a short gap the enemy has barely moved (median ~66px for gaps of
  // 4-10 time units), so holding is far closer to the truth than a round trip to the bottom it
  // never made. That only stays true while the held position still plausibly overlaps the enemy:
  // beyond ~20 time units median movement (211px) exceeds toothy's glyph half-height (155px of
  // its 310px box), so the held glyph would point somewhere it demonstrably isn't -- past that,
  // fall back to the resting position instead of freezing indefinitely (the "stuck forever" bug).
  // holdLastPositionEnemyTypes are exempt: they stay where they were last seen rather than
  // returning to the bottom, so their hold never expires.
  const FIXED_PATH_MAX_HOLD = 20;
  function pointAtCurrentTime(track, holdIndefinitely = false) {
    const time = currentTimeProvider();
    let current = null;
    for (const point of validTimedPoints(track)) {
      if (point[2] > time) continue;
      if (!current || point[2] > current[2]) current = point;
    }
    if (!current) return null;
    if (holdIndefinitely) return current;
    return time - current[2] <= FIXED_PATH_MAX_HOLD ? current : null;
  }

  function filterRecentPoints(points, minClusterSize = 2) {
    // never includes a point currentTime hasn't reached yet -- see segmentOpacity/buildFadedTrailSegments below for the matching backward-only fade.
    const validPoints = validTimedPoints(points).filter((point) => point[2] <= currentTimeProvider());
    if (validPoints.length < minClusterSize) return [];
    return validPoints;
  }

  // Fade each segment by distance from currentTime, same as the player's trail (makeSegments
  // in visualize.js), instead of drawing the whole track at constant opacity: these enemies
  // (e.g. daisy/blueberry) roam freely and their full history would otherwise clutter the map.
  function segmentOpacity(t1, t2) {
    const dist = currentTimeProvider() - (t1 + t2) / 2;
    if (dist < 0) return 0;
    return clamp(1 - dist / windowDelta, 0, 1);
  }

  function buildFadedTrailSegments(points, idPrefix, color, width) {
    const time = currentTimeProvider();
    const start = time - windowDelta;
    const segs = [];
    let fallbackSegment = null;

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a || !b || a[0] == null || b[0] == null) continue;
      const t1 = a[2];
      const t2 = b[2];
      if (t1 == null || t2 == null) continue;

      const segment = { id: `${idPrefix}-${i - 1}`, points: [[a[0], a[1]], [b[0], b[1]]], stroke: color, width, opacity: segmentOpacity(t1, t2) };
      if (!fallbackSegment) fallbackSegment = segment;
      if (Math.max(t1, t2) < start) continue;
      if (Math.min(t1, t2) > time) continue;
      segs.push(segment);
    }

    if (!segs.length && fallbackSegment) {
      segs.push({ ...fallbackSegment, opacity: Math.max(fallbackSegment.opacity, 0.85) });
    }

    return segs;
  }

  // matching each instance independently via "any live track within enemyInstanceXThreshold"
  // breaks down when two known instances sit closer together than that threshold (e.g. two
  // toothys ~150px apart with a 170px threshold): both instances would match either live track.
  // Matching each live track to its single nearest instance instead resolves the ambiguity,
  // since the threshold only needs to reject tracks that belong to neither.
  // fixedIndex is 0 (x) for a fixed-vertical enemy, 1 (y) for a fixed-horizontal one (see
  // fixedHorizontalEnemyTypes) -- matching always happens along whichever coordinate identifies
  // the instance, not along the one it patrols.
  function matchLiveTracksToInstances(liveTracks, instances, fixedIndex) {
    const instanceFixedCoords = instances.map((instance) =>
      Array.isArray(instance.path) && instance.path.length >= 2 ? instance.path[0][fixedIndex] : null
    );
    const matches = new Map();

    for (const track of liveTracks) {
      const validPoints = (track || []).filter((point) => point && Number.isFinite(point[fixedIndex]));
      if (!validPoints.length) continue;
      const trackFixed = d3.mean(validPoints, (point) => point[fixedIndex]);

      let nearestIndex = null;
      let nearestDist = Infinity;
      instanceFixedCoords.forEach((instanceFixed, index) => {
        if (instanceFixed == null) return;
        const dist = Math.abs(instanceFixed - trackFixed);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIndex = index;
        }
      });

      if (nearestIndex != null && nearestDist <= enemyInstanceXThreshold && !matches.has(nearestIndex)) {
        matches.set(nearestIndex, track);
      }
    }

    return matches;
  }

  // Minimizing enemies (Forest Follies' Blueberry): unlike other roaming enemies (daisy/acorn),
  // these can "minimize" -- become undetected mid-encounter and later pop back up continuing the
  // same encounter, rather than actually leaving. So consecutive tracks close enough in space are
  // chained into one visual identity instead of showing as separate numbered instances. Which
  // types behave this way is a per-level fact (levelConfig.minimizingEnemyTypes, mirroring
  // constants_forest_follies.py's MOVING_MINIMIZING_ENEMIES).
  function buildMinimizingChains(enemyType) {
    const segments = (enemyPathsByType[enemyType] || [])
      .map((points) => validTimedPoints(points))
      .filter((points) => points.length > 1)
      .sort((a, b) => a[0][2] - b[0][2]);

    const chains = [];
    for (const points of segments) {
      const current = chains[chains.length - 1];
      const prevSegment = current ? current.segments[current.segments.length - 1] : null;
      const prevEnd = prevSegment ? prevSegment[prevSegment.length - 1] : null;
      if (prevEnd && Math.hypot(prevEnd[0] - points[0][0], prevEnd[1] - points[0][1]) <= minimizingChainDistance) {
        current.segments.push(points);
        continue;
      }
      // numbering restarts per type, so each type's chains read as instance 0, 1, 2 ...
      chains.push({ id: `minimizing-chain-${enemyType}-${chains.length}`, index: chains.length, type: enemyType, segments: [points] });
    }
    return chains;
  }

  const minimizingChains = [...minimizingEnemyTypes].flatMap((enemyType) => buildMinimizingChains(enemyType));

  // where a chain currently stands: mid-segment (actively detected, moving) or held at the end
  // of whichever segment most recently finished (minimized -- greyed, static) until the next
  // segment's own span begins.
  function chainStateAtTime(chain, time) {
    let heldSegment = null;
    for (const segment of chain.segments) {
      const segStart = segment[0][2];
      const segEnd = segment[segment.length - 1][2];
      if (segStart > time) break;
      if (segEnd >= time) {
        const pointsSoFar = segment.filter((point) => point[2] <= time);
        if (pointsSoFar.length >= 2) {
          return { points: pointsSoFar, lastDetection: segEnd, active: true };
        }
        break;
      }
      heldSegment = segment;
    }
    if (!heldSegment) return null;
    return { points: heldSegment, lastDetection: heldSegment[heldSegment.length - 1][2], active: false };
  }

  function buildEnemyVisuals() {
    const visuals = { paths: [], glyphs: [], stationary: [] };
    if (!showEnemy()) return visuals;

    for (const [enemyType, aggregate] of Object.entries(enemyAggregates)) {
      if (!aggregate) continue;
      const liveTracks = enemyPathsByType[enemyType] || [];

      if (aggregate.mode === "full-path-instances" && Array.isArray(aggregate.instances)) {
        // wally/injured_wally (see enemyStageIndex) only actually exist during their own stage --
        // hide them entirely outside it rather than leaving both patrol lines visible all run.
        // Types absent from enemyStageIndex (e.g. Forest Follies' spiky_bulb/toothy, which has no
        // stages at all) are never restricted here.
        const requiredStage = enemyStageIndex[enemyType];
        if (requiredStage != null && stageStarts.length && requiredStage !== currentStageIndex()) {
          continue;
        }

        // fixed axis is x (a fixed-vertical patrol, e.g. toothy/wally) unless this type is
        // listed as fixed-horizontal (e.g. injured_wally, which patrols side to side along a
        // fixed height instead).
        const isFixedHorizontal = fixedHorizontalEnemyTypes.has(enemyType);
        const fixedIndex = isFixedHorizontal ? 1 : 0;
        const liveTrackByInstance = matchLiveTracksToInstances(liveTracks, aggregate.instances, fixedIndex);
        for (const [index, instance] of aggregate.instances.entries()) {
          if (!Array.isArray(instance.path) || instance.path.length < 2) continue;

          const instanceFixedCoord = instance.path[0][fixedIndex];
          const liveTrack = liveTrackByInstance.get(index) || null;
          // the detection describing where this enemy is *right now*, or null if it isn't being
          // detected at this moment -- no future lookahead, no stale past position.
          const currentPoint = liveTrack ? pointAtCurrentTime(liveTrack, holdLastPositionEnemyTypes.has(enemyType)) : null;
          const lastDetection = getLastDetectionTime(liveTrack, 2);
          // colour tracks whether the enemy is actually being detected right now, independently
          // of whether its *position* is being held in place: a hold-last-position enemy still
          // greys out while undetected rather than looking live forever.
          const detectedNow = liveTrack ? pointAtCurrentTime(liveTrack) != null : false;
          const instanceIsActive = detectedNow || neverFadeEnemyTypes.has(enemyType);
          const visibility = instanceVisibility(lastDetection);
          const instanceStroke = instanceIsActive ? "rgba(64, 224, 208, 0.9)" : `rgba(148, 163, 184, ${(0.9 * visibility).toFixed(2)})`;
          const instanceFill = instanceIsActive ? "rgba(64, 224, 208, 0.9)" : `rgba(148, 163, 184, ${(0.8 * visibility).toFixed(2)})`;

          visuals.paths.push({ id: `enemy-fullpath-${instance.id}`, points: instance.path, stroke: instanceStroke, width: 12, glow: true });
          // undetected right now -> draw it at the end of its patrol path (fraction 1), where
          // these enemies actually rest while idle.
          const glyphPoint = currentPoint || pointAtFraction(instance.path, 1);
          if (glyphPoint) {
            // pin the fixed coordinate to the known instance's line rather than the (possibly
            // slightly noisy) live detection, and take the free coordinate -- the one it
            // actually moves along -- from the current/resting point.
            const x = isFixedHorizontal ? glyphPoint[0] : instanceFixedCoord;
            const y = isFixedHorizontal ? instanceFixedCoord : glyphPoint[1];
            visuals.glyphs.push({ id: `enemy-glyph-fullpath-${instance.id}`, type: enemyType, x, y, color: instanceFill, opacity: instanceIsActive ? 1 : visibility });
          }
        }
        continue;
      }

      if (aggregate.mode === "stationary") {
        for (const [index, anchor] of (aggregate.anchors || []).entries()) {
          const anchorX = anchor[0];
          const anchorY = anchor[1];

          // match by 2D distance to the anchor rather than a single axis: unlike the
          // fixed-axis enemies above, stationary anchors aren't confined to a shared
          // column/row, so two different shrooms/tulips can sit at similar x but very
          // different y.
          const liveTrack = liveTracks.find((track) => {
            const validPoints = (track || []).filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
            if (!validPoints.length) return false;
            const meanX = d3.mean(validPoints, (point) => point[0]);
            const meanY = d3.mean(validPoints, (point) => point[1]);
            return Math.hypot(meanX - anchorX, meanY - anchorY) <= stationaryInstanceThreshold;
          });
          const lastDetection = getLastDetectionTime(liveTrack, 3);
          const instanceIsActive = isInstanceActive(liveTrack, 3);
          const visibility = instanceVisibility(lastDetection);
          const instanceFill = instanceIsActive ? "rgba(64, 224, 208, 0.9)" : `rgba(148, 163, 184, ${(0.8 * visibility).toFixed(2)})`;

          visuals.stationary.push({ id: `enemy-stationary-${enemyType}-${index}`, type: enemyType, x: anchorX, y: anchorY, color: instanceFill, active: instanceIsActive });
          visuals.glyphs.push({ id: `enemy-glyph-${enemyType}-${index}`, type: enemyType, x: anchorX, y: anchorY, color: instanceFill, opacity: instanceIsActive ? 1 : visibility });
        }
      }
    }

    for (const track of enemyPaths) {
      if (stationaryEnemyTypes.has(track.type) || centeredGlyphEnemyTypes.has(track.type) || minimizingEnemyTypes.has(track.type)) continue;
      const points = filterRecentPoints(track.points, 2);

      if (points.length > 1) {
        // same isInstanceActive check used for full-path-instances/stationary enemies above:
        // once tracking stops, the glyph/trail otherwise keeps drawing at the last known point
        // forever, indistinguishable from a still-detected enemy.
        const lastDetection = getLastDetectionTime(track.points, 2);
        const trackIsActive = isInstanceActive(track.points, 2);
        const visibility = instanceVisibility(lastDetection);
        const trackColor = trackIsActive ? "rgba(64, 224, 208, 0.9)" : `rgba(148, 163, 184, ${(0.9 * visibility).toFixed(2)})`;
        visuals.paths.push(...buildFadedTrailSegments(points, `enemy-free-${track.id}`, trackColor, 8));
        const glyphPoint = getLastTimedPoint(points);
        if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-live-${track.id}`, type: track.type, x: glyphPoint[0], y: glyphPoint[1], color: trackColor, label: track.index, opacity: trackIsActive ? 1 : visibility });
      }
    }

    for (const chain of minimizingChains) {
      const state = chainStateAtTime(chain, currentTimeProvider());
      if (!state) continue;

      const visibility = instanceVisibility(state.lastDetection);
      const chainColor = state.active ? "rgba(64, 224, 208, 0.9)" : `rgba(148, 163, 184, ${(0.9 * visibility).toFixed(2)})`;
      visuals.paths.push(...buildFadedTrailSegments(state.points, `enemy-free-${chain.id}`, chainColor, 8));
      const glyphPoint = getLastTimedPoint(state.points);
      if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-live-${chain.id}`, type: chain.type, x: glyphPoint[0], y: glyphPoint[1], color: chainColor, label: chain.index, opacity: state.active ? 1 : visibility });
    }

    return visuals;
  }

  return { buildEnemyVisuals, filterRecentPoints };
}