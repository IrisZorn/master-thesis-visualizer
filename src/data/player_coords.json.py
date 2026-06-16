import json
import pickle
import sys
from pathlib import Path

from PIL import Image
import constants_forest_follies as const
from helper import filter_points, extract_singular_points

base = Path(__file__).parent
pkl_path = base / "resources/forest_follies_hk_gamer_bro.pkl"
is_coop = True

with open(pkl_path, "rb") as f:
    point_dict = pickle.load(f)

point_json = []

for run in point_dict:
    my_dict = {}

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
        if char is const.cuphead:
            filtered_vals = filter_points(values, run[const.cuphead_ghost], run[const.cuphead_hit])
        elif char is const.mugman:
            filtered_vals = filter_points(values, run[const.mugman_ghost], run[const.mugman_hit])
        elif char in (
                const.cuphead_ghost,
                const.cuphead_hit,
        ):
            # creates one ghost glyph instead of a path
            filtered_vals = extract_singular_points(values)
            add_points[const.cuphead].extend(filtered_vals)
        elif char in (
                const.mugman_ghost,
                const.mugman_hit
        ):
            filtered_vals = extract_singular_points(values)
            add_points[const.mugman].extend(filtered_vals)

        my_dict[char] = [(x, y, t) for x, y, t in filtered_vals]

    for player in (const.cuphead, const.mugman):
        my_dict[player].extend(add_points[player])
        my_dict[player].sort(key=lambda t: t[2])
    point_json.append(my_dict)

print(json.dumps(point_json))