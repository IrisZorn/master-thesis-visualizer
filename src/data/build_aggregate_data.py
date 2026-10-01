import math
import pickle
from pathlib import Path
from statistics import median

import constants_forest_follies
import constants_wally_warbles
from coords_transform import aggregate_data_path, build_enemy_paths, enemy_full_paths_path, transform_run
from helper import distance, cluster_points_by_distance

# same threshold visualize.js's aggregateVerticalEnemyTracks already uses to
# tell separate instances of these enemy types apart on-screen -- shared by both fixed-vertical
# and fixed-horizontal enemies, since it's just a distance-along-the-fixed-axis cutoff
X_MATCH_THRESHOLD = 170
# tracks shorter than this are almost always single-frame false detections,
# not a real enemy sighting (real sightings run into the hundreds of points)
MIN_TRACK_POINTS = 20
# stationary enemies don't form tracks, so sightings are clustered spatially
# instead; 120 was splitting single enemies into duplicate instances
# ~125-150px apart (confirmed per-file in resources/play_data/*.pkl), so
# this has margin above that gap while staying well below the ~500px+ gap
# between genuinely distinct enemies
STATIONARY_DISTANCE_THRESHOLD = 200
# stationary instances with fewer points than this are almost always a
# one-off false detection rather than a real, recurring enemy; real
# instances run into the hundreds/thousands of points, noise tops out
# around a dozen, so this sits comfortably in the gap between them
OUTLIER_CLUSTER_SIZE = 50

# Enemy occupancy is binned this finely (in map pixels) before being shipped to the viewer.
# Small enough that a hotspot reads at roughly the scale of a single encounter rather than a
# stretch of level, large enough that the payload stays a handful of thousand sparse cells
# rather than the millions a per-pixel field would need.
ENEMY_DENSITY_CELL_SIZE = 16
# Stationary enemies (shroom/tulip/acorn machine) never move, so every frame one is on screen
# lands in the same cell -- including them makes the heatmap read as "where enemies are" rather
# than "where enemies move". Set to False for a movement-only field.
ENEMY_DENSITY_INCLUDES_STATIONARY = True
# Same file the viewer parses (level-config.js's parseEnemySizes) for each enemy's on-screen
# glyph box -- reused here so a detection contributes to the heatmap over roughly the footprint
# that enemy actually renders at (e.g. acorn_machine's 420x550 box spreads much further than
# spiky_bulb's 80x80), rather than every enemy counting as a single pixel-sized point regardless
# of size. One sprites subfolder per level, so the path is built from the level module.
SPRITES_DIR = Path(__file__).parent / "resources/sprites"
# fallback for a type sprite_sizes.txt doesn't cover (shouldn't happen -- it lists every type in
# ENEMY_KEYS -- but keeps a missing entry from crashing the build rather than spreading it)
DEFAULT_OCCUPANCY_RADIUS_CELLS = 0

# every level this script rebuilds caches for, paired with the play data its enemy instances are
# built from and the play data its aggregate (player route + heatmap) is built from. Add a level's
# constants module here once its recordings exist; one run refreshes all of them.
RESOURCES_DIR = Path(__file__).parent / "resources"
LEVELS = [
    (constants_forest_follies, RESOURCES_DIR / "play_data/forest_follies", RESOURCES_DIR / "agg_play_data/forest_follies"),
    (constants_wally_warbles, RESOURCES_DIR / "play_data/wally_warbles", RESOURCES_DIR / "agg_play_data/wally_warbles"),
]


def find_nearest_instance(instances, distance_to, threshold):
    best, best_dist = None, float("inf")
    for instance in instances:
        d = distance_to(instance)
        if d < best_dist:
            best_dist, best = d, instance
    return best if best is not None and best_dist <= threshold else None


def merge_track_into_instances(instances, points, fixed_axis="x", x_match_threshold=X_MATCH_THRESHOLD, min_track_points=MIN_TRACK_POINTS):
    # fixed_axis picks which coordinate identifies the instance (x for a fixed-vertical enemy
    # like toothy/wally, y for a fixed-horizontal one like injured_wally) -- the other coordinate
    # is the one the enemy actually patrols along, so its range gets tracked as free_min/free_max.
    # Field names are derived from fixed_axis so a vertical instance keeps exactly the
    # {"x", "y_min", "y_max"} shape this already had before horizontal support existed.
    fixed_idx = 0 if fixed_axis == "x" else 1
    free_idx = 1 - fixed_idx
    free_axis = "y" if fixed_axis == "x" else "x"
    free_min_key, free_max_key = f"{free_axis}_min", f"{free_axis}_max"

    fixed_values = [p[fixed_idx] for p in points if p[fixed_idx] is not None]
    free_values = [p[free_idx] for p in points if p[free_idx] is not None]
    if len(fixed_values) < min_track_points or not free_values:
        return

    track_fixed = sum(fixed_values) / len(fixed_values)
    track_free_min, track_free_max = min(free_values), max(free_values)
    track_count = len(fixed_values)

    match = find_nearest_instance(instances, lambda i: abs(i[fixed_axis] - track_fixed), x_match_threshold)
    if match is None:
        instances.append({fixed_axis: track_fixed, free_min_key: track_free_min, free_max_key: track_free_max, "num_points": track_count})
        return

    total = match["num_points"] + track_count
    match[fixed_axis] = (match[fixed_axis] * match["num_points"] + track_fixed * track_count) / total
    match[free_min_key] = min(match[free_min_key], track_free_min)
    match[free_max_key] = max(match[free_max_key], track_free_max)
    match["num_points"] = total


def merge_stationary_points_into_instances(instances, points, distance_threshold=STATIONARY_DISTANCE_THRESHOLD):
    for cluster in cluster_points_by_distance(points, distance_threshold=distance_threshold):
        cluster_x = sum(p[0] for p in cluster) / len(cluster)
        cluster_y = sum(p[1] for p in cluster) / len(cluster)
        cluster_count = len(cluster)

        match = find_nearest_instance(instances, lambda i: distance((i["x"], i["y"]), (cluster_x, cluster_y)), distance_threshold)
        if match is None:
            instances.append({"x": cluster_x, "y": cluster_y, "num_points": cluster_count})
            continue

        total = match["num_points"] + cluster_count
        match["x"] = (match["x"] * match["num_points"] + cluster_x * cluster_count) / total
        match["y"] = (match["y"] * match["num_points"] + cluster_y * cluster_count) / total
        match["num_points"] = total


def update_from_pkl(known_paths, pkl_path, level):
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    for run in point_dict:
        for enemy_type in level.FIXED_VERTICAL_ENEMIES:
            for points in build_enemy_paths(run.get(enemy_type) or []):
                merge_track_into_instances(known_paths[enemy_type], points, fixed_axis="x")

        for enemy_type in level.FIXED_HORIZONTAL_ENEMIES:
            for points in build_enemy_paths(run.get(enemy_type) or []):
                merge_track_into_instances(known_paths[enemy_type], points, fixed_axis="y")

        for enemy_type in level.STATIONARY_ENEMIES:
            merge_stationary_points_into_instances(known_paths[enemy_type], run.get(enemy_type) or [])


def print_instances(known_paths):
    for enemy_type, instances in known_paths.items():
        print(f"{enemy_type}: {len(instances)} instance(s)")
        for instance in sorted(instances, key=lambda i: i.get("x", i.get("y"))):
            if "y_min" in instance:
                print(f"  x={instance['x']:.1f} y=[{instance['y_min']:.1f}, {instance['y_max']:.1f}] n={instance['num_points']}")
            elif "x_min" in instance:
                print(f"  y={instance['y']:.1f} x=[{instance['x_min']:.1f}, {instance['x_max']:.1f}] n={instance['num_points']}")
            else:
                print(f"  x={instance['x']:.1f} y={instance['y']:.1f} n={instance['num_points']}")


def build_known_paths(level, source_dir):
    known_paths = {
        enemy_type: []
        for enemy_type in level.FIXED_VERTICAL_ENEMIES | level.FIXED_HORIZONTAL_ENEMIES | level.STATIONARY_ENEMIES
    }

    for pkl_path in sorted(source_dir.glob("*.pkl")):
        update_from_pkl(known_paths, pkl_path, level)

    for enemy_type in level.STATIONARY_ENEMIES:
        known_paths[enemy_type] = [
            instance for instance in known_paths[enemy_type]
            if instance["num_points"] >= OUTLIER_CLUSTER_SIZE
        ]

    return known_paths


def load_enemy_sprite_sizes(level):
    # name=width,height, one per line -- identical format to level-config.js's parseEnemySizes,
    # since it's the same file. Keyed by type number (via the level module's name->type constants,
    # e.g. level.acorn_machine == '1') to match aggregate_enemy_density's per-type point streams.
    sizes = {}
    sprite_sizes_path = SPRITES_DIR / level.LEVEL / "sprite_sizes.txt"
    if not sprite_sizes_path.exists():
        return sizes

    for raw_line in sprite_sizes_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        name, _, rest = line.partition("=")
        enemy_type = getattr(level, name.strip(), None)
        if enemy_type is None or not rest:
            continue
        parts = [part.strip() for part in rest.split(",")]
        try:
            width = float(parts[0])
            height = float(parts[1]) if len(parts) > 1 else width
        except (ValueError, IndexError):
            continue
        sizes[enemy_type] = (width, height)

    return sizes


def enemy_occupancy_radius_cells(enemy_type, sprite_sizes, cell_size):
    # half the sprite's longer side: big enough that the disk covers the enemy's full visual
    # footprint along its longer axis, not just a fraction of it
    size = sprite_sizes.get(enemy_type)
    if not size:
        return DEFAULT_OCCUPANCY_RADIUS_CELLS
    width, height = size
    return max(width, height) / 2 / cell_size


def spread_into(target, source_counts, radius_cells):
    # Splats each occupied source cell across a disk of the given radius with linear falloff
    # (full weight at the center, 0 at the edge) instead of just incrementing the one cell the
    # detection landed in -- this is what makes a large enemy's hotspot actually read as large.
    # The number of *source* cells this runs over is small (raw per-frame detections have
    # already been collapsed into per-cell counts by the caller), so even the widest disk here
    # (acorn_machine, radius ~17 cells) stays cheap.
    if radius_cells <= 0:
        for cell, count in source_counts.items():
            target[cell] = target.get(cell, 0) + count
        return

    reach = math.ceil(radius_cells)
    for (col, row), count in source_counts.items():
        for delta_row in range(-reach, reach + 1):
            for delta_col in range(-reach, reach + 1):
                dist = math.hypot(delta_col, delta_row)
                if dist > radius_cells:
                    continue
                target_col, target_row = col + delta_col, row + delta_row
                if target_col < 0 or target_row < 0:
                    continue
                weight = 1 - dist / radius_cells
                cell = (target_col, target_row)
                target[cell] = target.get(cell, 0) + count * weight


def valid_points(points):
    return [point for point in points if point and point[0] is not None and point[1] is not None]


def aggregate_spatial_path(paths, distance_threshold=120):
    all_points = [point for path in paths for point in valid_points(path)]
    if not all_points:
        return []

    clusters = cluster_points_by_distance(all_points, distance_threshold=distance_threshold)
    aggregated = []

    for cluster in clusters:
        if not cluster:
            continue
        aggregated.append((
            median(point[0] for point in cluster),
            median(point[1] for point in cluster),
            len(cluster),
        ))

    aggregated.sort(key=lambda point: point[0])
    return [(point[0], point[1], index) for index, point in enumerate(aggregated)]


def aggregate_enemy_density(all_runs, level, cell_size=ENEMY_DENSITY_CELL_SIZE):
    # The per-instance data agg_coords_[level].json.py's load_precomputed_enemy_data returns keeps
    # only each enemy's extent (patrol range / anchor), which says nothing about how much time is
    # actually spent where. So the heatmap gets its own product: every reconstructed enemy
    # detection from every aggregated run, binned into a coarse grid. Emitted sparsely (occupied
    # cells only) since most of a level this wide is empty.
    enemy_types = set(level.ENEMY_KEYS)
    if not ENEMY_DENSITY_INCLUDES_STATIONARY:
        enemy_types -= level.STATIONARY_ENEMIES
    # bullets tracked as enemy paths (e.g. Forest Follies' tulip_bullet) aren't enemies to the heatmap
    enemy_types -= getattr(level, "HEATMAP_EXCLUDED_ENEMIES", set())

    sprite_sizes = load_enemy_sprite_sizes(level)

    # kept separate per type until the spread step below, since each type spreads by its own
    # radius -- merging into one shared grid up front would lose which type a cell's count
    # belongs to
    counts_by_type = {enemy_type: {} for enemy_type in enemy_types}

    for run in all_runs:
        if not run:
            continue
        for enemy_type in enemy_types:
            # after transform_run each enemy type holds a list of tracks, not a flat point list
            for track in run.get(enemy_type) or []:
                for point in valid_points(track):
                    col = int(point[0] // cell_size)
                    row = int(point[1] // cell_size)
                    if col < 0 or row < 0:
                        continue
                    type_counts = counts_by_type[enemy_type]
                    type_counts[(col, row)] = type_counts.get((col, row), 0) + 1

    counts = {}
    for enemy_type, type_counts in counts_by_type.items():
        radius_cells = enemy_occupancy_radius_cells(enemy_type, sprite_sizes, cell_size)
        spread_into(counts, type_counts, radius_cells)

    cols = -(-level.MAP_WIDTH // cell_size)
    max_row = max((row for _, row in counts), default=0)
    return {
        "cellSize": cell_size,
        "cols": cols,
        # derived from the data rather than a MAP_HEIGHT constant: the grid only has to cover
        # where enemies were actually seen, and the viewer scales it back into map coordinates
        "rows": max_row + 1,
        # sorted so the build's output is stable from one run to the next; counts are no longer
        # integer detection tallies now that spread_into applies fractional falloff weights, so
        # they're rounded (and near-zero fringe cells dropped) to keep the payload from
        # ballooning on precision nothing downstream (quantile banding, then two more rounds of
        # blur in the viewer) can actually make use of
        "cells": sorted(
            [col, row, rounded]
            for (col, row), count in counts.items()
            if 0 <= col < cols and (rounded := round(count, 2)) > 0
        ),
    }


def slice_run_to_window(run, level, t_min, t_max):
    # restricts one transform_run result to a half-open time window [t_min, t_max) -- t_max=None
    # means "through the end of the run". Used to split a run into its stages before aggregating,
    # by re-slicing the same per-type data transform_run already built rather than re-detecting
    # anything. Enemy and bullet types hold a list of tracks (each a list of points); every other
    # key (players, ghosts/hits, effects) holds a flat point list -- both are pruned the same way,
    # just at a different nesting level.
    def keep(t):
        return t is not None and t >= t_min and (t_max is None or t < t_max)

    track_keys = level.ENEMY_KEYS | getattr(level, "BULLET_KEYS", set())
    sliced = {}
    for key, value in run.items():
        if key == "stage_starts":
            continue
        if key in track_keys:
            sliced[key] = [[point for point in track if keep(point[2])] for track in value]
        else:
            sliced[key] = [point for point in value if keep(point[2])]
    return sliced


def runs_for_stage(all_runs, level, stage_index):
    # only runs that actually reached this stage (stage_start_times leaves a stage None when a
    # run ended before reaching it) contribute to its aggregate.
    sliced_runs = []
    for run in all_runs:
        starts = run.get("stage_starts")
        if not starts or starts[stage_index] is None:
            continue
        t_min = starts[stage_index]
        t_max = starts[stage_index + 1] if stage_index + 1 < len(starts) else None
        sliced_runs.append(slice_run_to_window(run, level, t_min, t_max))
    return sliced_runs


def build_run_aggregate(all_runs, level):
    # every player's route is pooled into one aggregate under the primary player's type: this
    # shows where players go in general, which isn't a per-character question.
    pooled_paths = [
        path
        for player in level.PLAYERS
        for path in (run.get(player["main"]) for run in all_runs)
        if path
    ]
    return {
        "player_path": aggregate_spatial_path(pooled_paths),
        "enemy_density": aggregate_enemy_density(all_runs, level),
    }


def build_aggregate(level, agg_dir):
    # the expensive part of agg_coords_[level].json.py, done once here instead of on every
    # Framework load: re-detecting every aggregated run (transform_run) and then clustering the
    # pooled player route / binning the heatmap. Needs this level's enemy_full_paths.pkl to
    # already be written, since transform_run reads it for the fixed enemies. Bullets are skipped
    # (bullet_paths={}): nothing aggregated here uses them, and reconstructing them is by far the
    # slowest part of transform_run.
    all_runs = []

    for file in sorted(agg_dir.glob("*.pkl")):
        with open(file, "rb") as f:
            point_dict = pickle.load(f)

        all_runs.extend(filter(None, (transform_run(run, level, bullet_paths={}) for run in point_dict)))

    aggregate = build_run_aggregate(all_runs, level)

    # levels with no STAGES (e.g. Forest Follies) get no "stages" key at all, rather than one
    # holding a single stage -- absence means "this level has nothing to stage-split".
    stages = getattr(level, "STAGES", None)
    if stages:
        aggregate["stages"] = [
            build_run_aggregate(runs_for_stage(all_runs, level, stage_index), level)
            for stage_index in range(len(stages))
        ]

    return aggregate


def write_pickle(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(data, f)


if __name__ == "__main__":
    for level, source_dir, agg_dir in LEVELS:
        known_paths = build_known_paths(level, source_dir)

        output_path = enemy_full_paths_path(level)
        write_pickle(output_path, {"enemies": known_paths})

        print(f"{level.LEVEL} -> {output_path}")
        print_instances(known_paths)

        # after the enemy instances above are on disk, since transform_run reads them
        aggregate_path = aggregate_data_path(level)
        write_pickle(aggregate_path, build_aggregate(level, agg_dir))

        print(f"{level.LEVEL} -> {aggregate_path}")
