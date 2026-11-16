// 评委版's model and still files (in place of model-files.js, vite.config.js): the twelve only (Elara 17ed7f8b). It carries
// no 素材署名, so no model under someone else's licence goes with it; the early models stay in the repo and in the normal
// build, where old replays and measurements name them (Sol e3ed92fd).
export const urls = import.meta.glob('../../data/models/generated/fanshuo-*.glb', {query: '?url', import: 'default', eager: true});
export const stillUrls = import.meta.glob('../../data/stills/fanshuo-*.webp', {query: '?url', import: 'default', eager: true});
