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
  neverFadeEnemyTypes = new Set(),
  holdLastPositionEnemyTypes = new Set(),
  enemyInstanceXThreshold,
  stationaryInstanceThreshold,
  showEnemy,
}) {
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
  // instead of snapping to one fixed grey and staying there forever; floored so it never
  // disappears entirely.
  const GREY_FADE_WINDOW = windowDelta * 2;
  const MIN_GREY_ALPHA = 0.15;
  function instanceVisibility(lastDetection) {
    if (lastDetection == null) return MIN_GREY_ALPHA;
    const elapsed = currentTimeProvider() - lastDetection;
    if (elapsed <= 0) return 1;
    const fade = 1 - clamp(elapsed / GREY_FADE_WINDOW, 0, 1);
    return MIN_GREY_ALPHA + fade * (1 - MIN_GREY_ALPHA);
  }

  // fixed-path enemies are never drawn from a future detection: filterRecentPoints's
  // +windowDelta window would show where the enemy will be up to windowDelta later, which at
  // their patrol speed is hundreds of pixels off.
  //
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
    const validPoints = validTimedPoints(points).filter((point) => point[2] <= currentTimeProvider() + windowDelta);
    if (validPoints.length < minClusterSize) return [];
    return validPoints;
  }

  function hasRecentEnemyEvidence(tracks, minClusterSize = 2) {
    return tracks.some((track) => filterRecentPoints(track, minClusterSize).length >= minClusterSize);
  }

  // Fade each segment by distance from currentTime, same as the player's trail (makeSegments
  // in visualize.js), instead of drawing the whole track at constant opacity: these enemies
  // (e.g. daisy/blueberry) roam freely and their full history would otherwise clutter the map.
  function segmentOpacity(t1, t2) {
    const dist = Math.abs((t1 + t2) / 2 - currentTimeProvider());
    return clamp(1 - dist / windowDelta, 0, 1);
  }

  function buildFadedTrailSegments(points, idPrefix, color, width) {
    const time = currentTimeProvider();
    const start = time - windowDelta;
    const end = time + windowDelta;
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
      if (Math.min(t1, t2) > end) continue;
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
  function matchLiveTracksToInstances(liveTracks, instances) {
    const instanceXs = instances.map((instance) =>
      Array.isArray(instance.path) && instance.path.length >= 2 ? instance.path[0][0] : null
    );
    const matches = new Map();

    for (const track of liveTracks) {
      const validXs = (track || []).filter((point) => point && Number.isFinite(point[0]));
      if (!validXs.length) continue;
      const trackX = d3.mean(validXs, (point) => point[0]);

      let nearestIndex = null;
      let nearestDist = Infinity;
      instanceXs.forEach((instanceX, index) => {
        if (instanceX == null) return;
        const dist = Math.abs(instanceX - trackX);
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

  function buildEnemyVisuals() {
    const visuals = { paths: [], glyphs: [], stationary: [] };
    if (!showEnemy()) return visuals;

    for (const [enemyType, aggregate] of Object.entries(enemyAggregates)) {
      if (!aggregate) continue;
      const liveTracks = enemyPathsByType[enemyType] || [];

      if (aggregate.mode === "full-path-instances" && Array.isArray(aggregate.instances)) {
        const liveTrackByInstance = matchLiveTracksToInstances(liveTracks, aggregate.instances);
        for (const [index, instance] of aggregate.instances.entries()) {
          if (!Array.isArray(instance.path) || instance.path.length < 2) continue;

          const instanceX = instance.path[0][0];
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
          // undetected right now -> draw it at the bottom of its patrol path (fraction 1, i.e.
          // y_max), where these enemies actually rest while idle.
          const glyphPoint = currentPoint || pointAtFraction(instance.path, 1);
          if (glyphPoint) visuals.glyphs.push({ id: `enemy-glyph-fullpath-${instance.id}`, type: enemyType, x: instanceX, y: glyphPoint[1], color: instanceFill, opacity: instanceIsActive ? 1 : visibility });
        }
        continue;
      }

      if (aggregate.mode === "stationary") {
        for (const [index, anchor] of (aggregate.anchors || []).entries()) {
          const anchorX = anchor[0];
          const anchorY = anchor[1];

          // match by 2D distance to the anchor rather than X alone: unlike the fixed-vertical
          // enemies above, stationary anchors aren't confined to a shared column, so two
          // different shrooms/tulips can sit at similar x but very different y.
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
      if (stationaryEnemyTypes.has(track.type) || centeredGlyphEnemyTypes.has(track.type)) continue;
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

    return visuals;
  }

  return { buildEnemyVisuals, filterRecentPoints };
}