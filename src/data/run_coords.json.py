import json
import pickle
from pathlib import Path

import constants_forest_follies as const
from coords_transform import transform_run

base = Path(__file__).parent
play_data_dir = base / "resources/play_data"
COOP_RATIO_THRESHOLD = 20

def merge_to_cuphead_only(runs):
    merged_runs = []

    for run in runs:
        merged_run = dict(run)
        cup_points = list(merged_run.get(const.cuphead, []))
        mug_points = list(merged_run.get(const.mugman, []))
        cup_ghosts = list(merged_run.get(const.cuphead_ghost, []))
        mug_ghosts = list(merged_run.get(const.mugman_ghost, []))
        cup_hits = list(merged_run.get(const.cuphead_hit, []))
        mug_hits = list(merged_run.get(const.mugman_hit, []))

        merged_run[const.cuphead] = sorted(cup_points + mug_points, key=lambda point: point[2])
        merged_run[const.cuphead_ghost] = sorted(cup_ghosts + mug_ghosts, key=lambda point: point[2])
        merged_run[const.cuphead_hit] = sorted(cup_hits + mug_hits, key=lambda point: point[2])
        merged_run[const.mugman] = []
        merged_run[const.mugman_ghost] = []
        merged_run[const.mugman_hit] = []

        merged_runs.append(merged_run)

    return merged_runs


def load_runs(pkl_path):
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    total_cup_points = sum(len(run.get(const.cuphead) or []) for run in point_dict)
    total_mug_points = sum(len(run.get(const.mugman) or []) for run in point_dict)
    is_coop = total_cup_points/total_mug_points < COOP_RATIO_THRESHOLD

    runs = [transform_run(run) for run in point_dict]

    if not is_coop:
        runs = merge_to_cuphead_only(runs)

    return runs


if __name__ == "__main__":
    playthroughs = {
        pkl_path.stem: load_runs(pkl_path)
        for pkl_path in sorted(play_data_dir.glob("*.pkl"))
    }
    print(json.dumps(playthroughs))
