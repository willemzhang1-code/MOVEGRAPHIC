// Triangle mesh covering a character silhouette.

import Delaunator from 'delaunator';
import { distanceToMask } from './mask';

export interface Mesh {
  /** x, y pairs in cutout pixels (y down). Hull vertices come first. */
  points: Float32Array;
  triangles: Uint32Array;
  /** Number of leading vertices forming the outer boundary loop. */
  hull: number;
  /** Boundary edges as vertex index pairs. */
  edges: Uint32Array;
}

/**
 * Builds a hex-grid mesh over the silhouette. `spacing` is the vertex spacing
 * in pixels; triangles whose centre falls in gaps wider than ~0.7 spacing are
 * dropped so separate limbs do not get bridged.
 */
export function buildMesh(mask: Uint8Array, w: number, h: number, spacing: number): Mesh {
  const dist = distanceToMask(mask, w, h);
  const at = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    return dist[yi * w + xi];
  };

  const pts: number[] = [];
  const rowH = spacing * 0.866;
  for (let row = 0, y = 0; y <= h + rowH; row++, y += rowH) {
    const off = row % 2 ? spacing / 2 : 0;
    for (let x = -spacing + off; x <= w + spacing; x += spacing) {
      if (at(x, y) <= spacing * 0.75) pts.push(x, y);
    }
  }
  const del = new Delaunator(pts);
  const keep: number[] = [];
  const maxEdge2 = (spacing * 1.45) ** 2;
  const t = del.triangles;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    const ax = pts[a * 2], ay = pts[a * 2 + 1];
    const bx = pts[b * 2], by = pts[b * 2 + 1];
    const cx = pts[c * 2], cy = pts[c * 2 + 1];
    const e = Math.max((ax - bx) ** 2 + (ay - by) ** 2, (bx - cx) ** 2 + (by - cy) ** 2, (cx - ax) ** 2 + (cy - ay) ** 2);
    if (e > maxEdge2) continue;
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    // Keep if the centre or any edge midpoint touches the silhouette.
    const near = Math.min(at(mx, my), at((ax + bx) / 2, (ay + by) / 2), at((bx + cx) / 2, (by + cy) / 2), at((cx + ax) / 2, (cy + ay) / 2));
    if (near <= spacing * 0.3) keep.push(a, b, c);
  }

  // Boundary edges (used by exactly one triangle) and the longest loop.
  const edgeCount = new Map<string, [number, number]>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const counts = new Map<string, number>();
  for (let i = 0; i < keep.length; i += 3) {
    for (const [a, b] of [
      [keep[i], keep[i + 1]],
      [keep[i + 1], keep[i + 2]],
      [keep[i + 2], keep[i]],
    ]) {
      const k = key(a, b);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      edgeCount.set(k, [a, b]);
    }
  }
  const next = new Map<number, number[]>();
  for (const [k, n] of counts) {
    if (n !== 1) continue;
    const [a, b] = edgeCount.get(k)!;
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  const visited = new Set<number>();
  let best: number[] = [];
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop = [start];
    visited.add(start);
    let prev = -1;
    let cur = start;
    for (;;) {
      const cand = (next.get(cur) ?? []).filter((v) => v !== prev && !visited.has(v));
      if (!cand.length) break;
      prev = cur;
      cur = cand[0];
      visited.add(cur);
      loop.push(cur);
    }
    if (loop.length > best.length) best = loop;
  }

  // Reindex: hull loop first, then the remaining used vertices.
  const used = new Set(keep);
  const order = [...best, ...[...used].filter((v) => !best.includes(v))];
  const remap = new Map(order.map((v, i) => [v, i]));
  const points = new Float32Array(order.length * 2);
  order.forEach((v, i) => {
    points[i * 2] = Math.min(w, Math.max(0, pts[v * 2]));
    points[i * 2 + 1] = Math.min(h, Math.max(0, pts[v * 2 + 1]));
  });
  const triangles = Uint32Array.from(keep.map((v) => remap.get(v)!));
  const edges: number[] = [];
  for (let i = 0; i < best.length; i++) edges.push(i, (i + 1) % best.length);
  return { points, triangles, hull: best.length, edges: Uint32Array.from(edges) };
}
