import pickle
from pathlib import Path
import json
from statistics import median

import constants_forest_follies as const
from coords_transform import transform_run
from helper import cluster_points_by_distance


base = Path(__file__).parent
pkl_path = base / "resources/forest_follies_agg"
enemy_full_paths_path = base / "resources/enemy_full_paths.pkl"


def load_precomputed_enemy_data():

    with open(enemy_full_paths_path, "rb") as f:
        known_instances = pickle.load(f).get("enemies", {})

    data = {}
    for enemy_type in const.FIXED_VERTICAL_ENEMIES:
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

    for enemy_type in const.STATIONARY_ENEMIES:
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

if __name__ == "__main__":
    all_runs = []

    for file in pkl_path.glob("*.pkl"):
        with open(file, "rb") as f:
            point_dict = pickle.load(f)

        runs = []

        for run in point_dict:
            runs.append(transform_run(run))

        all_runs.extend(runs)

    cup_paths = [run.get(const.cuphead, []) for run in all_runs if run.get(const.cuphead)]
    mug_paths = [run.get(const.mugman, []) for run in all_runs if run.get(const.mugman)]
    combined_cup_paths = cup_paths + mug_paths

    aggregated_paths = {
        const.cuphead: aggregate_spatial_path(combined_cup_paths),
        const.mugman: [],
        "enemies": load_precomputed_enemy_data(),
    }

    print(json.dumps(aggregated_paths))

