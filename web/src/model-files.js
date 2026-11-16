// Which model and still files the page bundles (models.js). Only URLs are bundled; a model is fetched when a build first
// uses it. 评委版 swaps in model-files.judge.js (vite.config.js), which has the twelve only.
// The six original items (pot and lamp are the textured Lux3D generations) plus everything the import script writes
// to data/models/generated; each catalog item's still at the turntable's starting angle (scripts/make-stills.mjs).
export const urls = import.meta.glob(['../../data/models/pan-lux3d-mobile.glb', '../../data/models/lamp-lux3d-mobile.glb', '../../data/models/broom.glb', '../../data/models/scissors.glb', '../../data/models/slipper.glb', '../../data/models/pillow.glb', '../../data/models/generated/**/*.glb'], {query: '?url', import: 'default', eager: true});
export const stillUrls = import.meta.glob('../../data/stills/*.webp', {query: '?url', import: 'default', eager: true});
