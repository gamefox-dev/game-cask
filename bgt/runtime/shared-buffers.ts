// K74 (Q138): one CPU copy of each §13 buffer, shared by the decoder and the executor it was created for.
//
// Before K74 every buffer's bytes were held twice in JS: the decoder's validation shadow (decode-time contents) and the
// executor's shadow (execution-time contents: device/context-loss recovery, WebGL 2 index rebasing and wide-stride
// repacking, WebGPU unaligned writes, copy-on-write renames and rotated indices). Now the executor adopts the store the
// decoder allocated at BUFFER_CREATE, and only the executor writes it, in execution order, so every executor read keeps
// its execution-time meaning unchanged. The decoder, which runs ahead by the not yet executed items of the current frame,
// keeps a journal of those writes and reads `store + journal` (index validation, BUFFER_COPY sources). When the host
// consumes a frame, `settle()` applies any journaled write the sharing executor did not apply (a replay/other executor,
// a dropped or failed frame), so the decoder's view never depends on the executor. Recovery shadows (`gpu.recoveryShadows`)
// only concern textures: buffer bytes are load-bearing on both backends and stay, once.

/** One write the decoder made to a buffer store that the executor will repeat at execution. */
export interface SharedWrite {
  store: Uint8Array<ArrayBuffer>;
  offset: number;
  data: Uint8Array;
  /** The sharing executor applied it to `store` (so settle() must not). */
  applied: boolean;
  /** BUFFER_CREATE only: the executor adopted `store` (at most once per item: replays get a private copy). */
  adopted?: boolean;
}

// Keyed by the item's `words` array (executors dispatch shallow copies of an item, which keep that array), never
// stored on the item: items are recorded and cloned (checkpoints), and the owner is an executor object that must not
// be cloned. A cloned or rebuilt item has another array, so it never shares.
const writes = new WeakMap<object, { write: SharedWrite; owner: object }>();
const key = (item: object): object => (item as { words?: object }).words ?? item;

export function attachSharedWrite(item: object, write: SharedWrite, owner: object): void { writes.set(key(item), { write, owner }); }

/** The shared write `item` carries for `owner` (the executor the decoder was created for); undefined otherwise. */
export function sharedWriteFor(item: object, owner: object): SharedWrite | undefined {
  const e = writes.get(key(item));
  return e && e.owner === owner ? e.write : undefined;
}

/** Executor side of BUFFER_CREATE: the decoder's store on the first execution for its owner, else a private copy. */
export function adoptBufferStore(item: { data?: Uint8Array }, size: number, owner: object): { data: Uint8Array<ArrayBuffer>; shared: boolean } {
  const s = sharedWriteFor(item, owner);
  if (s && !s.adopted && s.store.length === size) {
    s.adopted = true; s.applied = true;
    return { data: s.store, shared: true };
  }
  const data = new Uint8Array(size);
  if (item.data) data.set(item.data);
  return { data, shared: false };
}

/** Executor side of BUFFER_UPDATE / BUFFER_COPY: call after writing `target`. */
export function markApplied(item: object, owner: object, target: Uint8Array): void {
  const s = sharedWriteFor(item, owner);
  if (s && s.store === target) s.applied = true;
}

/** Restore after a loss: keep the existing array (no transient second copy) and its sharing. */
export function restoreBufferItem<T extends object>(item: T, store: Uint8Array<ArrayBuffer>, owner: object): T {
  attachSharedWrite(item, { store, offset: 0, data: store, applied: false }, owner);
  return item;
}

/** Decoder side: the journal of writes not yet settled, in decode order, indexed by store. */
export class BufferJournal {
  private readonly pending: SharedWrite[] = [];
  private readonly byStore = new Map<Uint8Array, SharedWrite[]>();

  get size(): number { return this.pending.length; }

  write(store: Uint8Array<ArrayBuffer>, offset: number, data: Uint8Array): SharedWrite {
    const w: SharedWrite = { store, offset, data, applied: false };
    this.pending.push(w);
    const list = this.byStore.get(store);
    if (list) list.push(w); else this.byStore.set(store, [w]);
    return w;
  }

  /** Bytes [offset, offset+length) as the decoder sees them. A view when nothing overlaps (do not retain it). */
  read(store: Uint8Array<ArrayBuffer>, offset: number, length: number): Uint8Array {
    const list = this.byStore.get(store);
    if (!list) return store.subarray(offset, offset + length);
    const end = offset + length;
    // Fast path: the newest overlapping write covers the whole range (e.g. a ring slot uploaded right before its draw).
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i], ws = w.offset, we = w.offset + w.data.length;
      if (we <= offset || ws >= end) continue;
      if (ws <= offset && we >= end) return w.data.subarray(offset - ws, end - ws);
      break;
    }
    let out: Uint8Array | undefined;
    for (const w of list) {
      const lo = Math.max(offset, w.offset), hi = Math.min(end, w.offset + w.data.length);
      if (lo >= hi) continue;
      out ??= store.slice(offset, end);
      out.set(w.data.subarray(lo - w.offset, hi - w.offset), lo - offset);
    }
    return out ?? store.subarray(offset, end);
  }

  /** Apply what the sharing executor did not, then forget the journal (the host consumed the frame). */
  settle(): number {
    let applied = 0;
    for (const w of this.pending) if (!w.applied) { w.store.set(w.data, w.offset); w.applied = true; applied++; }
    this.pending.length = 0; this.byStore.clear();
    return applied;
  }
}
