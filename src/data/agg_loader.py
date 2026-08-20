import json
import pickle
from statistics import median

from coords_transform import transform_run, load_known_enemy_instances
from helper import cluster_points_by_distance


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

    print(json.dumps(aggregated_paths))
