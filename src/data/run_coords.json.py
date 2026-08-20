from pathlib import Path

import constants_forest_follies as const
from run_loader import dump_playthroughs

# Forest Follies' per-run coordinates. A second level gets a copy of this file named
# run_coords_<level>.json.py, pointing at its own constants module and play data -- the loader
# itself is level-agnostic.
if __name__ == "__main__":
    dump_playthroughs(const, Path(__file__).parent / "resources/play_data")
