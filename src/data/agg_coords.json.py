from pathlib import Path

import constants_forest_follies as const
from agg_loader import dump_aggregate

# Forest Follies' aggregate across playthroughs. A second level gets a copy of this file named
# agg_coords_<level>.json.py, pointing at its own constants module and recordings.
if __name__ == "__main__":
    dump_aggregate(const, Path(__file__).parent / "resources/forest_follies_agg")
