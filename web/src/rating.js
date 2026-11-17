import {currentItemRating} from '../../sim/item-rating.js';

export const GRADES = ['S', 'A', 'B', 'C', 'D'];
export const STATS = [['attack', '攻击'], ['range', '范围'], ['durability', '耐久']];

/** Both backend versions expose the original inputs. Derive the display version used by this build. */
export const ratingOf = currentItemRating;

/** Best grade first; items without a grade last; otherwise the order given. */
export const byGrade = (ids, rate) => ids.map((id, i) => ({id, i, g: GRADES.indexOf(rate(id)?.grade ?? '')}))
  .sort((a, b) => (a.g < 0) - (b.g < 0) || a.g - b.g || a.i - b.i).map(x => x.id);
