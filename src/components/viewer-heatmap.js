import * as d3 from "d3";

// Teal ramp, light -> dark, stepped around the live enemy turquoise (#40e0d0) so the density
// field reads as part of the same "enemy" colour family rather than a fourth entity. Lightness
// is monotonic (relative luminance 0.89 -> 0.15, so it still reads correctly as a sequential
// scale), but unlike a pure single-hue ramp the hue itself drifts from teal toward blue as it
// darkens (HSL hue 172 -> 182) -- the hottest spots read as a deeper blue-teal, not just a darker
// copy of the lightest step. Against the other things on screen it stays clear of both floors:
// worst pair vs cup red / mug blue is 29.7 normal-vision / 8.3 CVD (OKLab dE x100, tritan-limited
// by the hue drift toward mug's blue -- 182 was chosen as the bluest end-hue that still clears
// the 8 target without needing the "legal only with secondary encoding" exception). The
// deliberate trade is against the enemy turquoise itself -- field and live tracks share a hue
// family, so the two are told apart by form (a flat wash under everything vs. a bright stroke
// and glyph on top), not by colour.
export const HEATMAP_COLORS = ["#e3f7f4", "#a0e7e1", "#59d1dc", "#14a5e3", "#10A6FF"];

// How many nested contour bands the field is cut into. High on purpose: an attention-heatmap
// look comes from a tight concentric falloff around each hotspot, and with only a handful of
// bands the same field reads as a few flat plateaus instead.
const BAND_COUNT = 10;
// Contour bands nest -- each one is a filled region that also covers every band above it -- so
// their alpha compounds where they overlap, and that stacking is what produces the hot core.
// Ramping the per-band value from faint to strong is what makes a core actually read as a core
// rather than as more of the same wash: the outermost ring lands at MIN alone, while the densest
// core composites all ten to ~0.9. That near-opaque core is deliberate and is why the blur is
// kept tight -- it only ever covers a small spot, the way an attention heatmap's hot centre does,
// rather than the broad plateaus a flat alpha produced.
const BAND_OPACITY_MIN = 0.10;
const BAND_OPACITY_MAX = 0.30;
// Where the bands sit, as quantiles over the occupied cells. Starting above the median keeps the
// outermost ring from tinting everywhere an enemy was ever seen once -- a level this wide has a
// long tail of single-sighting cells -- and running up to 0.99 puts most of the ramp inside the
// genuinely busy spots, which is where the detail should go.
const BAND_QUANTILE_START = 0.6;
const BAND_QUANTILE_END = 0.99;
// Smoothing radius in grid cells, so the contours read as a density field rather than tracing
// the edges of the bins the python side happened to pick. This -- not the bin size -- is what
// caps how large a blob can grow, so it is kept small in absolute map pixels (radius x
// ENEMY_DENSITY_CELL_SIZE = ~19px): a fine grid smoothed hard would just reproduce a coarse one.
// This only smooths the *geometry* -- each contour band is still a flat-fill polygon, so the
// color/opacity still jumps hard at every ring boundary regardless of how smooth the curve is.
const DATA_BLUR_RADIUS = 1.2;
// A second, larger blur applied to the *rendered* bands themselves (as an SVG filter on the
// heatmap layer, in visualize.js) -- this is what actually removes the ring edges, by averaging
// each pixel with its neighbours across band boundaries, rather than just spacing the same hard
// edges further apart. In the same grid-cell units as DATA_BLUR_RADIUS and the contour geometry.
export const BAND_BLUR_RADIUS = 0.5;

const colorAt = d3.piecewise(d3.interpolateRgb, HEATMAP_COLORS);

function computeBands(density) {
  if (!density) return null;

  const { cellSize, cols, rows, cells } = density;
  if (!cellSize || !cols || !rows || !Array.isArray(cells) || !cells.length) return null;

  const values = new Float32Array(cols * rows);
  for (const cell of cells) {
    const [col, row, count] = cell || [];
    if (!Number.isFinite(col) || !Number.isFinite(row) || !Number.isFinite(count)) continue;
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    values[row * cols + col] = count;
  }

  d3.blur2({ data: values, width: cols, height: rows }, DATA_BLUR_RADIUS);

  // Thresholds by quantile over the occupied cells, not linearly over the value range: a
  // stationary enemy sits in a single cell for thousands of frames across the aggregate, so
  // linear steps would put every roaming enemy in the bottom band and leave the ramp unused.
  const occupied = Array.from(values).filter((value) => value > 0).sort(d3.ascending);
  if (!occupied.length) return null;

  const thresholds = [];
  for (let i = 0; i < BAND_COUNT; i += 1) {
    const quantile = BAND_QUANTILE_START + (BAND_QUANTILE_END - BAND_QUANTILE_START) * (i / (BAND_COUNT - 1));
    const threshold = d3.quantileSorted(occupied, quantile);
    // a degenerate (repeated or zero) threshold would emit a band identical to the one below it
    if (threshold > 0 && (!thresholds.length || threshold > thresholds[thresholds.length - 1])) {
      thresholds.push(threshold);
    }
  }
  if (!thresholds.length) return null;

  const path = d3.geoPath();
  const contours = d3.contours().size([cols, rows]).thresholds(thresholds)(values);

  const bands = [];
  contours.forEach((contour, index) => {
    if (!contour.coordinates.length) return;
    const t = thresholds.length > 1 ? index / (thresholds.length - 1) : 1;
    bands.push({
      id: `heat-band-${index}`,
      d: path(contour),
      fill: colorAt(t),
      opacity: BAND_OPACITY_MIN + t * (BAND_OPACITY_MAX - BAND_OPACITY_MIN),
    });
  });

  return bands.length ? { bands, cellSize } : null;
}

// The field is static -- it aggregates every run, so it doesn't move with the slider. Building
// it is therefore done once, lazily on first activation, and never again: while the overlay is
// switched off it costs nothing, and while it's on scrubbing only toggles visibility.
export function createEnemyHeatmapBuilder({ density }) {
  let cached = null;
  let built = false;

  return function getHeatmap() {
    if (!built) {
      built = true;
      cached = computeBands(density);
    }
    return cached;
  };
}
