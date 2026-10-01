import { validTimedPoints } from "./viewer-helpers.d11f403b.js";

// how many points back from "now" to look when reading a bullet's current heading -- short
// enough to reflect where it's heading right now rather than its trajectory since it first
// spawned (in case a stream's aim has since changed).
const DIRECTION_LOOKBACK_POINTS = 3;

// a bullet track only reflects something actually on screen while its most recent detection
// at-or-before the current time is this fresh. Without this, a bullet type whose consecutive
// shots get reconnected into one long track (build_enemy_paths' jump/reacquire heuristic doesn't
// know one shot from the next) would look "active" across the whole gap between bursts, long
// after that shot has actually left the screen.
const MAX_ACTIVE_GAP = 30;

function directionAt(points, index) {
  const from = points[Math.max(0, index - DIRECTION_LOOKBACK_POINTS)];
  const to = points[index];
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dx / len, dy / len] : null;
}

// the track's own point/heading "right now" -- the last real detection at or before time, as
// long as it's recent enough to still count as a bullet currently in flight (see MAX_ACTIVE_GAP).
function activeStateAtTime(points, time) {
  const valid = validTimedPoints(points);
  if (valid.length < 2 || time < valid[0][2]) return null;

  let index = -1;
  for (let i = 0; i < valid.length; i++) {
    if (valid[i][2] > time) break;
    index = i;
  }
  if (index < 0 || time - valid[index][2] > MAX_ACTIVE_GAP) return null;

  const direction = directionAt(valid, index);
  return direction ? { point: valid[index], direction } : null;
}

function nearestOrigin(origins, point) {
  let best = null;
  let bestDist = Infinity;
  for (const origin of origins) {
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) continue;
    const dist = Math.hypot(origin.x - point[0], origin.y - point[1]);
    if (dist < bestDist) {
      bestDist = dist;
      best = origin;
    }
  }
  return best;
}

// For each enemy anchor, the time windows during which one of its own bullets is present --
// keyed `${enemyType}:${anchorIndex}` (anchorIndex into aggr_players.enemies[enemyType].anchors,
// the same array viewer-enemies.js's stationary branch iterates). Each shot is attributed to the
// anchor nearest where it was first seen (i.e. where it was fired from), and stays "present" until
// MAX_ACTIVE_GAP past its last detection -- the exact moment buildBulletArrows stops drawing an
// arrow for it -- so viewer-enemies.js can hold a dead enemy's fade until its arrow is gone.
export function enemyBulletPresenceByAnchor({ bulletPathsByType, bulletConfig, enemyAnchorsByType }) {
  const presence = new Map();

  for (const [bulletType, config] of Object.entries(bulletConfig)) {
    if (config.owner !== "enemy") continue;
    const anchors = (enemyAnchorsByType[config.enemyType] || []).map(([x, y], index) => ({ x, y, index }));
    if (!anchors.length) continue;

    for (const points of bulletPathsByType[bulletType] || []) {
      const valid = validTimedPoints(points);
      const firstLocated = valid.find((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      if (!firstLocated) continue;
      const anchor = nearestOrigin(anchors, firstLocated);
      if (!anchor) continue;
      const key = `${config.enemyType}:${anchor.index}`;
      if (!presence.has(key)) presence.set(key, []);
      presence.get(key).push([valid[0][2], valid[valid.length - 1][2] + MAX_ACTIVE_GAP]);
    }
  }

  return presence;
}

// One arrow per bullet type, anchored at whichever player/enemy fires it, pointing in that
// type's current direction. When more than one shot of the same type is active at once, the one
// nearest its own origin is treated as the most recently fired -- a shot further downrange has
// been flying longer and may reflect an aim that's already changed, so it's not "current".
export function buildBulletArrows({
  time,
  bulletPathsByType,
  bulletConfig,
  enemyAnchorsByType,
  playerPositions,
  arrowLength = 220,
}) {
  const arrows = [];

  for (const [bulletType, config] of Object.entries(bulletConfig)) {
    const tracks = bulletPathsByType[bulletType] || [];
    const origins = config.owner === "player"
      ? playerPositions
      : (enemyAnchorsByType[config.enemyType] || []).map(([x, y]) => ({ x, y }));
    if (!origins.length) continue;

    let closest = null;
    let closestDist = Infinity;

    for (const points of tracks) {
      const state = activeStateAtTime(points, time);
      if (!state) continue;
      const origin = nearestOrigin(origins, state.point);
      if (!origin) continue;
      const dist = Math.hypot(origin.x - state.point[0], origin.y - state.point[1]);
      if (dist < closestDist) {
        closestDist = dist;
        closest = { origin, direction: state.direction };
      }
    }

    if (closest) {
      arrows.push({
        id: `bullet-arrow-${bulletType}`,
        x1: closest.origin.x,
        y1: closest.origin.y,
        x2: closest.origin.x + closest.direction[0] * arrowLength,
        y2: closest.origin.y + closest.direction[1] * arrowLength,
        // a player bullet's origin carries its own trail color (cup/mug can differ); an enemy
        // bullet's anchor has none, so it falls back to the type's configured color instead.
        color: closest.origin.color || config.color || "#facc15",
      });
    }
  }

  return arrows;
}
