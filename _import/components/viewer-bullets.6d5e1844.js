import { clamp, validTimedPoints } from "./viewer-helpers.1421b95f.js";
import { ACTIVE_ENEMY_COLOR, inactiveEnemyColor } from "./viewer-enemies.ebbd2b62.js";

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

// a shot's heading for its whole life: the average of every step's direction (as unit vectors,
// so e.g. 179deg and -179deg average to 180deg rather than 0deg). Enemy shots fly close to
// straight, so this smooths out per-detection jitter instead of tracking it frame by frame.
function averageDirection(points) {
  let sumX = 0;
  let sumY = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    sumX += dx / len;
    sumY += dy / len;
  }
  const len = Math.hypot(sumX, sumY);
  return len > 0 ? [sumX / len, sumY / len] : null;
}

// Every individual enemy shot across the run, computed once up front. Only points with real
// coordinates count as detections. Consecutive shots can be reconnected into one track (see
// MAX_ACTIVE_GAP), so a track is split where a new shot starts: after a gap of more than
// MAX_ACTIVE_GAP, when the next detection is no farther from the shooter than the shot's last one
// was. A shot only ever moves away from its shooter, so a detection that's still further out after
// a gap is the same cloud having gone briefly undetected, not a new one. Each shot is attributed
// to the anchor nearest where it was first seen (i.e. where it was fired from) and keeps that
// shooter for its whole life. Shared by enemyBulletPresenceByAnchor and buildBulletArrows so the
// enemy fade and the arrows always agree on which shots exist and when each one stops being
// detected.
export function buildEnemyShots({ bulletPathsByType, bulletConfig, enemyAnchorsByType }) {
  const shots = [];

  for (const [bulletType, config] of Object.entries(bulletConfig)) {
    if (config.owner !== "enemy") continue;
    const anchors = (enemyAnchorsByType[config.enemyType] || []).map(([x, y], index) => ({ x, y, index }));
    if (!anchors.length) continue;

    (bulletPathsByType[bulletType] || []).forEach((track, trackIndex) => {
      const located = validTimedPoints(track).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      const segments = [];
      for (const point of located) {
        const current = segments[segments.length - 1];
        if (current) {
          const prev = current.points[current.points.length - 1];
          const distToShooter = (p) => Math.hypot(p[0] - current.anchor.x, p[1] - current.anchor.y);
          const startsNewShot = point[2] - prev[2] > MAX_ACTIVE_GAP && distToShooter(point) <= distToShooter(prev);
          if (!startsNewShot) {
            current.points.push(point);
            continue;
          }
        }
        const anchor = nearestOrigin(anchors, point);
        if (anchor) segments.push({ anchor, points: [point] });
      }

      segments.forEach(({ anchor, points }, shotIndex) => {
        // a single detection has no heading, so it can't get an arrow
        if (points.length < 2) return;
        const direction = averageDirection(points);
        if (!direction) return;
        shots.push({
          id: `bullet-arrow-${bulletType}-${trackIndex}-${shotIndex}`,
          bulletType,
          enemyType: config.enemyType,
          anchorIndex: anchor.index,
          anchor,
          direction,
          start: points[0][2],
          end: points[points.length - 1][2],
        });
      });
    });
  }

  return shots;
}

// For each enemy anchor, the time windows during which one of its own shots is detected --
// keyed `${enemyType}:${anchorIndex}` (anchorIndex into aggr_players.enemies[enemyType].anchors,
// the same array viewer-enemies.js's stationary branch iterates). A window ends at the shot's last
// detection -- the moment buildBulletArrows greys its arrow and starts fading it -- so
// viewer-enemies.js can hold a dead enemy's fade until then and fade both together.
export function enemyBulletPresenceByAnchor(enemyShots) {
  const presence = new Map();
  for (const shot of enemyShots) {
    const key = `${shot.enemyType}:${shot.anchorIndex}`;
    if (!presence.has(key)) presence.set(key, []);
    presence.get(key).push([shot.start, shot.end]);
  }
  return presence;
}

// One arrow per enemy shot, from its shooter's anchor, pointing in the shot's averaged direction
// (see averageDirection). Turquoise while the shot is detected; after its last detection it greys
// and fades out the same way an inactive enemy does (fadeWindow), independently of any other shot -- so two
// shots in flight at once show as two arrows, and a greyed one stays until fully faded even when
// a newer shot from the same shooter is already live.
function buildEnemyShotArrows({ time, enemyShots, bulletConfig, fadeWindow, arrowLength }) {
  const arrows = [];

  for (const shot of enemyShots) {
    if (time < shot.start) continue;
    const elapsed = time - shot.end;
    const visibility = elapsed <= 0 ? 1 : 1 - clamp(elapsed / fadeWindow, 0, 1);
    if (visibility <= 0) continue;

    const { direction } = shot;
    const config = bulletConfig[shot.bulletType] || {};
    arrows.push({
      id: shot.id,
      x1: shot.anchor.x,
      y1: shot.anchor.y,
      x2: shot.anchor.x + direction[0] * arrowLength,
      y2: shot.anchor.y + direction[1] * arrowLength,
      color: elapsed <= 0 ? (config.color || ACTIVE_ENEMY_COLOR) : inactiveEnemyColor(0.9 * visibility),
      // same id viewer-enemies.js gives this anchor's stationary glyph, so visualize.js can
      // keep the arrow layered directly under its shooter
      glyphId: `enemy-glyph-${shot.enemyType}-${shot.anchorIndex}`,
    });
  }

  return arrows;
}

// Player bullets: one arrow per bullet type, anchored at whichever player fires it, pointing in
// that type's current direction. When more than one shot of the same type is active at once, the
// one nearest its own origin is treated as the most recently fired -- a shot further downrange has
// been flying longer and may reflect an aim that's already changed, so it's not "current".
// Enemy bullets get one arrow per shot instead (see buildEnemyShotArrows).
export function buildBulletArrows({
  time,
  bulletPathsByType,
  bulletConfig,
  enemyShots = [],
  fadeWindow,
  playerPositions,
  arrowLength = 220,
}) {
  const arrows = [];

  for (const [bulletType, config] of Object.entries(bulletConfig)) {
    if (config.owner !== "player") continue;
    const tracks = bulletPathsByType[bulletType] || [];
    if (!playerPositions.length) continue;

    let closest = null;
    let closestDist = Infinity;

    for (const points of tracks) {
      const state = activeStateAtTime(points, time);
      if (!state) continue;
      const origin = nearestOrigin(playerPositions, state.point);
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
        // a player bullet's origin carries its own trail color (cup/mug can differ)
        color: closest.origin.color || config.color || "#facc15",
        glyphId: null,
      });
    }
  }

  arrows.push(...buildEnemyShotArrows({ time, enemyShots, bulletConfig, fadeWindow, arrowLength }));
  return arrows;
}
