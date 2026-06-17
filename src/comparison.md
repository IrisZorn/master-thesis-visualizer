---
title: Gameplay Comparison
---

# Two Player Gameplay
```js
import { createMapViewer } from "./components/visualize.js";

// load data (FileAttachment) and provide a file-input fallback in the browser if needed
let curr_playthrough;

curr_playthrough = await FileAttachment("./data/player_coords.json").json();

aggr_players = await FileAttachment("./data/agg_coords.json").json();

const mapUrl = await FileAttachment("./data/resources/forest_follies_stitched.png").url();
const spriteUrls = {
	cupDeath: await FileAttachment("./data/resources/cuphead_ghost.png").url(),
	mugDeath: await FileAttachment("./data/resources/mugman_ghost.png").url(),
	cupHit: await FileAttachment("./data/resources/cuphead_hit.png").url(),
	mugHit: await FileAttachment("./data/resources/mugman_hit.png").url()
};

// Create and display the viewer. Legend and input UI are owned by the viewer itself.
const currentViewer = await createMapViewer({ curr_playthrough, mapUrl, spriteUrls, aggr_players});

// show the viewer
display(currentViewer);

```