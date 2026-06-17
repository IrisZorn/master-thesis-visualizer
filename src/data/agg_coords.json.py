from pathlib import Path
import pickle

from envs.pm.Lib import json


base = Path(__file__).parent
pkl_path = base / "resources/forest_follies_agg"

for file in pkl_path.glob("*.pkl"):
    with open(file, "rb") as f:
        point_dict = pickle.load(f)
