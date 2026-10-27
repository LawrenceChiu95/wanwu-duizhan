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

Convex hulls remain solid collision envelopes, but the current fighter mass uses Elara’s category reference values in item-standards.json (pot 2.5 kg, lamp 1.5, pillow/broom 0.6, slipper 0.25, scissors 0.15), rather than solid hull volume times density. These are nominal prototype values, not measured objects. Generated variants use the same mass as their category. Rapier derives inertia from that mass and collision shape; material hardness/restitution remain game tuning, not engineering measurements.

Physics: [Rapier](https://github.com/dimforge/rapier.js), Apache-2.0; package license retained by npm. [Official contact manifold documentation](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/) describes contact-space/impulse APIs used here.

## Lux3D additions

Wren supplied two generated variants and their generation receipts in [lux3d/RECEIPT.md](lux3d/RECEIPT.md). The catalog defaults to the 1.46 MB pan and 1.36 MB lamp mobile GLBs in data/models/, retaining UVs and 1024px base-color and metallic/roughness textures. The untextured ~0.7 MB meshes and textured high-detail files in data/lux3d/ are retained as source evidence. This is a local prototype delivery, not a clearance of generated-asset rights for a public release; the Aholo output terms and photograph attributions must accompany any later release review.

| Variant | Input photograph attribution supplied by Wren |
|---|---|
| 锅（Lux3D） | “Frying pan” — kevin dooley, CC BY; https://www.flickr.com/photos/12836528@N00/4565041679 |
| 台灯（Lux3D） | “Art Deco Mica Table Lamp” — Artdecodude, CC BY; https://www.flickr.com/photos/62920259@N03/5771792573 |

Both variants retain their existing counterpart's catalog attack/defense/material and legacy HP values; actual fighter HP is uniformly 140 for singles and assemblies. Geometry, volume and the surface weak point come from the supplied meshes; mass is the same category reference value as the counterpart. Different collision geometry can still produce different outcomes. The pan is centered and rotated with its long axis along Z at 0.38 m; the lamp stays Y-up at 0.45 m. These are consistent prototype scales, not dimensions measured from photographs.
