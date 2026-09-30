import argparse
import json
import math
import pickle
from pathlib import Path
from statistics import median

import constants_forest_follies
import constants_wally_warbles
from coords_transform import transform_run, load_known_enemy_instances
from helper import cluster_points_by_distance

# Forest Follies and Wally Warbles' aggregate across playthroughs. Framework calls this once per
# level (e.g. requesting data/agg_coords_wally_warbles.json runs it with --level=wally_warbles) --
# the loader itself is level-agnostic and only ever looks a level up by name here.
LEVELS = {
    "forest_follies": constants_forest_follies,
    "wally_warbles": constants_wally_warbles,
}

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


def load_precomputed_enemy_data(level, allowed_types=None):
    # enemies whose real extent can only be known by combining many playthroughs are not
    # aggregated here at all -- build_enemy_full_paths.py already did that across every recording,
    # so this just reshapes its cache for the viewer. allowed_types restricts this to one stage's
    # own fixed enemy (see build_aggregate) -- None (the level-wide call) means no restriction.
    known_instances = load_known_enemy_instances(level)

    data = {}
    for enemy_type in sorted(level.FIXED_VERTICAL_ENEMIES):
        if allowed_types is not None and enemy_type not in allowed_types:
            continue
        instances = sorted(known_instances.get(enemy_type, []), key=lambda instance: instance["x"])
        data[enemy_type] = {
            "mode": "full-path-instances",
            "instances": [
                {
                    "id": f"{enemy_type}-{index}",
                    "path": [(instance["x"], instance["y_min"], 0), (instance["x"], instance["y_max"], 1)],
                }
                for index, instance in enumerate(instances)
            ],
        }

    for enemy_type in sorted(level.FIXED_HORIZONTAL_ENEMIES):
        if allowed_types is not None and enemy_type not in allowed_types:
            continue
        instances = sorted(known_instances.get(enemy_type, []), key=lambda instance: instance["y"])
        data[enemy_type] = {
            "mode": "full-path-instances",
            "instances": [
                {
                    "id": f"{enemy_type}-{index}",
                    "path": [(instance["x_min"], instance["y"], 0), (instance["x_max"], instance["y"], 1)],
                }
                for index, instance in enumerate(instances)
            ],
        }

    for enemy_type in sorted(level.STATIONARY_ENEMIES):
        if allowed_types is not None and enemy_type not in allowed_types:
            continue
        anchors = sorted(known_instances.get(enemy_type, []), key=lambda instance: instance["x"])
        data[enemy_type] = {
            "mode": "stationary",
            "anchors": [(instance["x"], instance["y"], index) for index, instance in enumerate(anchors)],
        }

    return data


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
    # The per-instance data load_precomputed_enemy_data returns keeps only each enemy's extent
    # (patrol range / anchor), which says nothing about how much time is actually spent where.
    # So the heatmap gets its own product: every reconstructed enemy detection from every
    # aggregated run, binned into a coarse grid. Emitted sparsely (occupied cells only) since
    # most of a level this wide is empty.
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
        # sorted so the loader's output is stable from one pipeline run to the next; counts are
        # no longer integer detection tallies now that spread_into applies fractional falloff
        # weights, so they're rounded (and near-zero fringe cells dropped) to keep the payload
        # from ballooning on precision nothing downstream (quantile banding, then two more
        # rounds of blur in the viewer) can actually make use of
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


def build_aggregate(all_runs, level, stage_index=None):
    # every player's route is pooled into one aggregate under the primary player's type: this
    # shows where players go in general, which isn't a per-character question.
    pooled_paths = [
        path
        for player in level.PLAYERS
        for path in (run.get(player["main"]) for run in all_runs)
        if path
    ]

    # stage_index=None (the level-wide call) leaves "enemies" unfiltered, showing every fixed
    # enemy the level has; a per-stage call restricts it to only the enemy actually active in that
    # stage (see constants_wally_warbles.ENEMY_STAGE_INDEX), instead of repeating e.g. wally's
    # patrol line in every stage's aggregate even though he's only around for stage 1.
    allowed_types = None
    if stage_index is not None:
        enemy_stage_index = getattr(level, "ENEMY_STAGE_INDEX", None)
        if enemy_stage_index:
            allowed_types = {
                enemy_type for enemy_type, index in enemy_stage_index.items() if index == stage_index
            }

    aggregated_paths = {player["main"]: [] for player in level.PLAYERS}
    aggregated_paths[level.PLAYERS[0]["main"]] = aggregate_spatial_path(pooled_paths)
    aggregated_paths["enemies"] = load_precomputed_enemy_data(level, allowed_types)
    aggregated_paths["enemy_density"] = aggregate_enemy_density(all_runs, level)
    return aggregated_paths


def dump_aggregate(level, agg_dir):
    all_runs = []

    for file in agg_dir.glob("*.pkl"):
        with open(file, "rb") as f:
            point_dict = pickle.load(f)

        all_runs.extend(filter(None, (transform_run(run, level) for run in point_dict)))

    aggregated_paths = build_aggregate(all_runs, level)

    # levels with no STAGES (e.g. Forest Follies) get no "stages" key at all, rather than one
    # holding a single stage -- absence means "this level has nothing to stage-split".
    stages = getattr(level, "STAGES", None)
    if stages:
        aggregated_paths["stages"] = [
            build_aggregate(runs_for_stage(all_runs, level, stage_index), level, stage_index=stage_index)
            for stage_index in range(len(stages))
        ]

    print(json.dumps(aggregated_paths))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", required=True, choices=sorted(LEVELS))
    level_name = parser.parse_args().level

    dump_aggregate(LEVELS[level_name], Path(__file__).parent / "resources/agg_play_data" / level_name)
