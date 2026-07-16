---
title: Gameplay Comparison
---

# Two Player Gameplay
```js
import { createMapViewer } from "./components/visualize.js";

// load data (FileAttachment) and provide a file-input fallback in the browser if needed
let aggr_players;

aggr_players = await FileAttachment("./data/agg_coords.json").json();

const mapUrl = await FileAttachment("./data/resources/forest_follies_stitched.png").url();
const spriteUrls = {
	cupDeath: await FileAttachment("./data/resources/sprites/cuphead_ghost.png").url(),
	mugDeath: await FileAttachment("./data/resources/sprites/mugman_ghost.png").url(),
	cupHit: await FileAttachment("./data/resources/sprites/cuphead_hit.png").url(),
	mugHit: await FileAttachment("./data/resources/sprites/mugman_hit.png").url(),
	acorn: await FileAttachment("./data/resources/sprites/acorn.png").url(),
	shroom: await FileAttachment("./data/resources/sprites/shroom.png").url(),
	spikyBulb: await FileAttachment("./data/resources/sprites/spiky_bulb.png").url(),
	toothy: await FileAttachment("./data/resources/sprites/toothy.png").url(),
	tulip: await FileAttachment("./data/resources/sprites/tulip.png").url()
};
```

```js
// All playthroughs from data/resources/play_data/*.pkl, keyed by filename stem
// (see data/player_coords.json.py). Loaded once on page load.
const playthroughsByFile = await FileAttachment("./data/player_coords.json").json();
const playthroughNames = Object.keys(playthroughsByFile);

const playthroughSelect = Inputs.select(playthroughNames, {label: "Select Playthrough", value: playthroughNames[0]});
display(playthroughSelect);

const selectedPlaythrough = Generators.input(playthroughSelect);
```

```js
// Create and display the viewer for the selected playthrough. Legend and input UI
// are owned by the viewer itself. Reruns whenever selectedPlaythrough changes.
const currentViewer = await createMapViewer({
	curr_playthrough: playthroughsByFile[selectedPlaythrough],
	mapUrl,
	spriteUrls,
	aggr_players
});

display(currentViewer);
```