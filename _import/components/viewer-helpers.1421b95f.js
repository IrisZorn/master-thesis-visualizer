export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// fades out the further `time` has moved past t (fully gone fadeDistance later) -- and is 0 before
// t, so nothing previews before the scrub position actually reaches it.
export function fadeOpacity(time, t, fadeDistance) {
  const dist = time - t;
  if (dist < 0) return 0;
  return clamp(1 - dist / fadeDistance, 0, 1);
}

// two-sided counterpart of fadeOpacity for player/enemy trails: fully opaque at `time`, fading
// out fadeDistance both behind and ahead of it, so a trail also previews where it's heading next.
export function trailOpacity(time, t, fadeDistance) {
  return clamp(1 - Math.abs(time - t) / fadeDistance, 0, 1);
}

// highest stage index whose start has passed by `time`, or null on a level with no stages
// (stageStarts empty) -- stage 0's start is always defined (the run's own stable start).
export function stageIndexAt(stageStarts, time) {
  if (!stageStarts.length) return null;
  let index = null;
  for (let i = 0; i < stageStarts.length; i++) {
    const t = stageStarts[i];
    if (t != null && t <= time) index = i;
  }
  return index;
}

export function findCurrentIndex(path, time) {
  // holds at the last point whose time has already passed, instead of snapping forward to the
  // next upcoming one, so the glyph never previews a position it hasn't reached yet.
  let index = 0;
  for (let i = 0; i < path.length; i += 1) {
    if (path[i][2] > time) break;
    index = i;
  }
  return index;
}

export function validTimedPoints(points) {
  return (points || []).filter((point) => point && point[2] != null && Number.isFinite(point[2]));
}

export function flattenEnemyPaths(pathsByType) {
  return Object.entries(pathsByType).flatMap(([type, tracks]) =>
    (tracks || []).map((points, index) => ({
      id: `${type}-${index}`,
      type,
      index,
      points: (points || []).filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    })).filter((track) => track.points.length > 1)
  );
}

export function getLastTimedPoint(points) {
  const validPoints = validTimedPoints(points);
  return validPoints.length ? validPoints[validPoints.length - 1] : null;
}

export function pointAtFraction(points, fraction) {
  const validPoints = (points || []).filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
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

export function makePathD(points) {
  const validPoints = points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!validPoints.length) return "";
  const [firstPoint, ...rest] = validPoints;
  return [`M ${firstPoint[0]} ${firstPoint[1]}`, ...rest.map((point) => `L ${point[0]} ${point[1]}`)].join(" ");
}