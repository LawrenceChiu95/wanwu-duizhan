/**
 * Each item's 等级 (远夏 11-02 #万物对战 69f9a308, Elara 79a528bb): 攻击, 范围 and 耐久 each scored 0–100, a letter for
 * each, and the item's grade from the plain average of the three scores. The generation/import side (Sol) writes it
 * once into the catalog as `item.rating`; the screens only read it and never work a grade out themselves.
 *
 *   rating: {version, scores: {attack, range, durability}, letters: {attack, range, durability}, grade, lengthCm, massKg}
 */
export const GRADES = ['S', 'A', 'B', 'C', 'D'];
export const STATS = [['attack', '攻击'], ['range', '范围'], ['durability', '耐久']];

// Until Sol's first table lands (11-03 14:00): his estimate's first-round targets for the nine items, shown as 占位.
// Delete this block, and the `placeholder` flag with it, once every offered item carries a rating.
const PLACEHOLDER = {
  scissors: [88, 40, 60], 'wasteland-knife': [88, 40, 60], 'lamp-lux3d': [70, 65, 60], lamp: [70, 65, 60],
  broom: [45, 100, 80], 'wasteland-broom': [45, 100, 80], 'pan-lux3d': [90, 55, 80], pot: [90, 55, 80], 'wasteland-pot': [90, 55, 80],
  slipper: [45, 40, 65], pillow: [40, 85, 100]
};
const LINES = [75, 60, 45, 30, 0];
const letter = score => GRADES[LINES.findIndex(l => score >= l)];

/** The item's rating, or a placeholder (`placeholder: true`) for an item that has none yet; null if neither. */
export function ratingOf(item) {
  if (item?.rating) return item.rating;
  const s = PLACEHOLDER[item?.id];
  if (!s) return null;
  const scores = {attack: s[0], range: s[1], durability: s[2]};
  return {
    version: 'placeholder', placeholder: true, scores,
    letters: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, letter(v)])),
    grade: letter((s[0] + s[1] + s[2]) / 3)
  };
}

/** Best grade first; items without a grade last; otherwise the order given. */
export const byGrade = (ids, rate) => ids.map((id, i) => ({id, i, g: GRADES.indexOf(rate(id)?.grade ?? '')}))
  .sort((a, b) => (a.g < 0) - (b.g < 0) || a.g - b.g || a.i - b.i).map(x => x.id);
