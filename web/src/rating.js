/**
 * Each item's 等级 (远夏 11-02 #万物对战 69f9a308, Elara 79a528bb): 攻击, 范围 and 耐久 each scored 0–100, a letter for
 * each, and the item's grade from the plain average of the three scores. The generation/import side (Sol) writes it
 * once into the catalog as `item.rating` (see docs/item-rating.md); the screens only read it and never work a grade out themselves.
 *
 *   rating: {version, scores: {attack, range, durability}, letters: {attack, range, durability}, grade}
 */
export const GRADES = ['S', 'A', 'B', 'C', 'D'];
export const STATS = [['attack', '攻击'], ['range', '范围'], ['durability', '耐久']];

/** The item's rating, or null for an item that has none yet. */
export const ratingOf = item => item?.rating ?? null;

/** Best grade first; items without a grade last; otherwise the order given. */
export const byGrade = (ids, rate) => ids.map((id, i) => ({id, i, g: GRADES.indexOf(rate(id)?.grade ?? '')}))
  .sort((a, b) => (a.g < 0) - (b.g < 0) || a.g - b.g || a.i - b.i).map(x => x.id);
