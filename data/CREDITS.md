# Model credits

Downloaded 2026-10-26 from the following model pages. License links on all six pages were checked directly. CC BY 3.0 permits commercial reuse with attribution; keep this file and show an accessible credits link in the prototype.

| File | Original title / author | Source | License |
|---|---|---|---|
| models/scissors.glb | Scissors — Zsky | https://poly.pizza/m/RRyFBBtM2K | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| models/lamp.glb | Desk Lamp — involuntary tsetse | https://poly.pizza/m/0_FDq_UjWHp | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| models/broom.glb | Broom — Poly by Google | https://poly.pizza/m/bzCi_ZLQPN4 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| models/pot.glb | Cooking Pot — Quaternius | https://poly.pizza/m/jAUb3FoCN7 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| models/slipper.glb | Slippers — J-Toastie | https://poly.pizza/m/2wR1M99UwP | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| models/pillow.glb | Pillow — Poly by Google | https://poly.pizza/m/f60emm1Xkas | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

Changes: centered each model and rescaled to meters; rotated the long implements to point along Z; kept only the right slipper. Original downloads in source-models/ preserve the authors' assets. Normalization and support-point convex approximation are reproducible with `node sim/prepare-assets.mjs`. Hashes, original bounds, final transforms and source vertex counts are in catalog.json.

The convex hull treats hollow objects as solid; density and dimensions are prototype estimates, not measured real object masses. In particular, the solid pot and broad broom hull are much heavier than their real counterparts. Material damage values are game tuning, not engineering measurements.

Physics: [Rapier](https://github.com/dimforge/rapier.js), Apache-2.0; package license retained by npm. [Official contact manifold documentation](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/) describes contact-space/impulse APIs used here.
