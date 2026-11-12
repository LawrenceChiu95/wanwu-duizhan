/**
 * 陶瓷炸片: the break a batch of shards caused waits for that batch to land (Elara f08a6c36, 937d44f2). Keyed by
 * `${side}:${part}`. Only the batch that took the piece's last hp holds it: an earlier batch that only hurt the same
 * piece lands without taking the break or letting the piece go, and a break nothing holds shows at once.
 */
export class BreakHolds {
  constructor() { this.held = new Map(); }
  /** A batch is thrown at `key`; `breaks`: it took the last hp. Returns the batch's token for land(). */
  shoot(key, breaks) {
    const batch = {key};
    if (breaks) this.held.set(key, {batch, e: null});
    return batch;
  }
  isHeld(key) { return this.held.has(key); }
  /** A 'break' event for `key`: kept for its batch (true), or not held (false) and the page shows it now. */
  hold(key, e) {
    const h = this.held.get(key);
    if (!h) return false;
    h.e = e;
    return true;
  }
  /** The batch landed: the break it caused (null if it caused none, or it was already taken); the piece is let go. */
  land(batch) {
    const h = this.held.get(batch.key);
    if (!h || h.batch !== batch) return null;
    this.held.delete(batch.key);
    return h.e;
  }
  clear() { this.held.clear(); }
}
