import json
import pickle
from statistics import median

from coords_transform import transform_run, load_known_enemy_instances
from helper import cluster_points_by_distance

# Enemy occupancy is binned this finely (in map pixels) before being shipped to the viewer.
# Small enough that a hotspot reads at roughly the scale of a single encounter rather than a
# stretch of level, large enough that the payload stays a handful of thousand sparse cells
# rather than the millions a per-pixel field would need.
ENEMY_DENSITY_CELL_SIZE = 16
# Stationary enemies (shroom/tulip/acorn machine) never move, so every frame one is on screen
# lands in the same cell -- including them makes the heatmap read as "where enemies are" rather
# than "where enemies move". Set to False for a movement-only field.
ENEMY_DENSITY_INCLUDES_STATIONARY = True


def load_precomputed_enemy_data(level):
    # enemies whose real extent can only be known by combining many playthroughs are not
    # aggregated here at all -- build_enemy_full_paths.py already did that across every recording,
    # so this just reshapes its cache for the viewer.
    known_instances = load_known_enemy_instances(level)

    data = {}
    for enemy_type in sorted(level.FIXED_VERTICAL_ENEMIES):
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

    for enemy_type in sorted(level.STATIONARY_ENEMIES):
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

    counts = {}
    max_row = 0

    for run in all_runs:
        if not run:
            continue
        for enemy_type in sorted(enemy_types):
            # after transform_run each enemy type holds a list of tracks, not a flat point list
            for track in run.get(enemy_type) or []:
                for point in valid_points(track):
                    col = int(point[0] // cell_size)
                    row = int(point[1] // cell_size)
                    if col < 0 or row < 0:
                        continue
                    counts[(col, row)] = counts.get((col, row), 0) + 1
                    max_row = max(max_row, row)

    cols = -(-level.MAP_WIDTH // cell_size)
    return {
        "cellSize": cell_size,
        "cols": cols,
        # derived from the data rather than a MAP_HEIGHT constant: the grid only has to cover
        # where enemies were actually seen, and the viewer scales it back into map coordinates
        "rows": max_row + 1,
        # sorted so the loader's output is stable from one pipeline run to the next
        "cells": sorted([col, row, count] for (col, row), count in counts.items() if col < cols),
    }


def dump_aggregate(level, agg_dir):
    all_runs = []

    for file in agg_dir.glob("*.pkl"):
        with open(file, "rb") as f:
            point_dict = pickle.load(f)

        all_runs.extend(transform_run(run, level) for run in point_dict)

    # every player's route is pooled into one aggregate under the primary player's type: this
    # shows where players go in general, which isn't a per-character question.
    pooled_paths = [
        path
        for player in level.PLAYERS
        for path in (run.get(player["main"]) for run in all_runs)
        if path
    ]

    aggregated_paths = {player["main"]: [] for player in level.PLAYERS}
    aggregated_paths[level.PLAYERS[0]["main"]] = aggregate_spatial_path(pooled_paths)
    aggregated_paths["enemies"] = load_precomputed_enemy_data(level)
    aggregated_paths["enemy_density"] = aggregate_enemy_density(all_runs, level)

    print(json.dumps(aggregated_paths))
