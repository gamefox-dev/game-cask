// Deterministic "player" for Coin Cave, used to prove the sample reaches L3
// (one full authentic gameplay loop: start -> collect all coins -> win).
// It only consumes the game's published debug state and the level asset.

import type { ButtonName } from '../../bgt/runtime/abi';

export interface CoinCaveState {
  state: 'title' | 'playing' | 'win' | 'gameover';
  frame: number;
  player: { x: number; y: number };
  size: number;
  tile: number;
  lives: number;
  score: number;
  best: number;
  invuln: number;
  coins: Array<{ c: number; r: number; taken: boolean }>;
  enemies: Array<{ x: number; y: number }>;
}

export function parseLevel(text: string): boolean[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => [...l].map((ch) => ch === '#'));
}

type Tile = [number, number]; // [col, row]

function bfs(walls: boolean[][], from: Tile, goals: Set<string>, blocked: Set<string>): Tile[] | null {
  const rows = walls.length;
  const cols = walls[0].length;
  const key = (t: Tile) => `${t[0]},${t[1]}`;
  const prev = new Map<string, string | null>([[key(from), null]]);
  const q: Tile[] = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (goals.has(key(cur))) {
      const path: Tile[] = [];
      let k: string | null = key(cur);
      while (k) {
        const [c, r] = k.split(',').map(Number);
        path.unshift([c, r]);
        k = prev.get(k) ?? null;
      }
      return path;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n: Tile = [cur[0] + dc, cur[1] + dr];
      if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows) continue;
      if (walls[n[1]][n[0]] || prev.has(key(n)) || blocked.has(key(n))) continue;
      prev.set(key(n), key(cur));
      q.push(n);
    }
  }
  return null;
}

/** Decide which buttons to hold this frame. */
export function botDecide(s: CoinCaveState, walls: boolean[][]): ButtonName[] {
  if (s.state !== 'playing') return [];
  const T = s.tile;
  const half = s.size / 2;
  const cx = s.player.x + half;
  const cy = s.player.y + half;
  const cur: Tile = [Math.floor(cx / T), Math.floor(cy / T)];
  const goals = new Set(s.coins.filter((c) => !c.taken).map((c) => `${c.c},${c.r}`));
  const danger = new Set<string>();
  for (const e of s.enemies) {
    const pad = 10;
    for (let x = e.x - pad; x <= e.x + 12 + pad; x += 4) {
      for (let y = e.y - pad; y <= e.y + 12 + pad; y += 4) {
        danger.add(`${Math.floor(x / T)},${Math.floor(y / T)}`);
      }
    }
  }
  danger.delete(`${cur[0]},${cur[1]}`);
  for (const g of goals) if (danger.has(g)) danger.delete(g);

  let path = bfs(walls, cur, goals, danger);
  let wait = false;
  if (!path) {
    path = bfs(walls, cur, goals, new Set());
    wait = s.invuln === 0; // a safe route will open once the enemy moves on
  }
  if (!path) return [];
  const centerOf = (t: Tile) => [t[0] * T + T / 2, t[1] * T + T / 2];
  const [tx, ty] = centerOf(cur);
  if (path.length < 2) {
    // inside goal tile: step onto its center to overlap the coin
    const out: ButtonName[] = [];
    if (cx < tx - 1) out.push('RIGHT');
    else if (cx > tx + 1) out.push('LEFT');
    if (cy < ty - 1) out.push('DOWN');
    else if (cy > ty + 1) out.push('UP');
    return out;
  }
  if (wait) {
    const next = path[1];
    if (danger.has(`${next[0]},${next[1]}`)) return [];
  }
  const next = path[1];
  const dc = next[0] - cur[0];
  const dr = next[1] - cur[1];
  const tol = 1.5;
  if (dc !== 0) {
    if (cy < ty - tol) return ['DOWN'];
    if (cy > ty + tol) return ['UP'];
    return [dc > 0 ? 'RIGHT' : 'LEFT'];
  }
  if (cx < tx - tol) return ['RIGHT'];
  if (cx > tx + tol) return ['LEFT'];
  return [dr > 0 ? 'DOWN' : 'UP'];
}
