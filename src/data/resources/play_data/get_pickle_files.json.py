import json
from pathlib import Path

base = Path(__file__).parent
file_dict = {}
files = sorted([p for p in base.glob("*.pkl") if p.is_file()])
# store paths relative to project src root so they work with FileAttachment/fetch
rel_paths = [str(Path("data") / "resources" / "play_data" / p.name).replace('\\', '/') for p in files]
for path in rel_paths:
    filename = Path(path).name
    file_dict[filename] = path

json.dumps(file_dict)
