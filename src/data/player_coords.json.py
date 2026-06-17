import json
import pickle
import sys
from pathlib import Path

from PIL import Image
import constants_forest_follies as const
from helper import filter_points, extract_singular_points, remove_reconnecting_jumps

base = Path(__file__).parent
pkl_path = base / "resources/forest_follies_hk_gamer_bro.pkl"
is_coop = True

with open(pkl_path, "rb") as f:
    point_dict = pickle.load(f)

point_json = []

for run in point_dict:
    my_dict = {}

    real_cup_hits = extract_singular_points(run.get(const.cuphead_hit) or [], min_cluster_size=6)
    real_mug_hits = extract_singular_points(run.get(const.mugman_hit) or [], min_cluster_size=6)

    cup = run.get(const.cuphead) or []
    mug = run.get(const.mugman) or []
    if not cup or not mug:
        continue  # nothing to process

    add_points = {
        const.cuphead: [],
        const.mugman: [],
    }

    for char, values in run.items():
        values = sorted(values, key=lambda t: t[2])
        filtered_vals = values
        if char == const.cuphead:
            filtered_vals = filter_points(values, run[const.cuphead_ghost], real_cup_hits)
            filtered_vals = remove_reconnecting_jumps(
                filtered_vals,
                jump_dist=150,
                return_dist=180,
                max_branch_points=70,
                min_branch_points=3,
                min_deviation=70,
            )
        elif char == const.mugman:
            filtered_vals = filter_points(values, run[const.mugman_ghost], real_mug_hits)
            filtered_vals = remove_reconnecting_jumps(
                filtered_vals,
                jump_dist=150,
                return_dist=180,
                max_branch_points=70,
                min_branch_points=3,
                min_deviation=70,
            )
        elif char == const.cuphead_ghost:
            # creates one ghost glyph instead of a path
            filtered_vals = extract_singular_points(values, min_cluster_size=8)
            add_points[const.cuphead].extend(filtered_vals)
        elif char == const.cuphead_hit:
            filtered_vals = real_cup_hits
            add_points[const.cuphead].extend(filtered_vals)
        elif char == const.mugman_ghost:
            filtered_vals = extract_singular_points(values, min_cluster_size=8)
            add_points[const.mugman].extend(filtered_vals)
        elif char == const.mugman_hit:
            filtered_vals = real_mug_hits
            add_points[const.mugman].extend(filtered_vals)

        my_dict[char] = [(x, y, t) for x, y, t in filtered_vals]

    for player in (const.cuphead, const.mugman):
        my_dict[player].extend(add_points[player])
        my_dict[player].sort(key=lambda t: t[2])
    point_json.append(my_dict)

print(json.dumps(point_json))