// Presented RGB comparison. Alpha is deliberately excluded: WebGL's opaque default framebuffer
// reads alpha=255 while WebGPU readback retains shader alpha; neither affects visible canvas RGB.
export interface Image { width: number; height: number; data: Uint8Array }
export function compareGpuImages(a: Image, b: Image, tolerance = 2) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('image dimensions differ');
  const { width: w, height: h } = a;
  const matches = (x: Image, i: number, y: Image, j: number) =>
    [0,1,2].every(c => Math.abs(x.data[i+c]-y.data[j+c]) <= tolerance);
  const nearby = (x: Image, i: number, y: Image, px: number, py: number) => {
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const sx=px+dx, sy=py+dy;
      if (sx>=0 && sy>=0 && sx<w && sy<h && matches(x,i,y,(sy*w+sx)*4)) return true;
    }
    return false;
  };
  let different=0, unmatched=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i=(y*w+x)*4;
    if (matches(a,i,b,i)) continue;
    different++;
    // Symmetric matching prevents a nearby background color hiding missing geometry.
    if (!nearby(a,i,b,x,y) || !nearby(b,i,a,x,y)) unmatched++;
  }
  return { different: different/(w*h), unmatched: unmatched/(w*h) };
}

/** K69: exact device-pixel retention of a letterboxed screen, except on exact ties. A device row/column whose centre lies
 * exactly on a logical pixel boundary (s = lb.w/logicalW; (d - lb.x + 0.5) = k*s) has no GL-defined owner: polygon
 * coverage of a centre on an edge and scaled NEAREST blit sampling at an exact .5 position are implementation-defined,
 * and implementations differ (docs/webkit.md, "Scaled NEAREST ties"). The WebGL2 renderer's screen passes run at logical
 * size, so a LOAD round trip may move legacy edges by one device pixel on exactly those lines.
 * `changed` counts every other differing pixel (must stay 0); `unexplained` counts tie pixels whose new colour is not an
 * old colour of a direct neighbour across that boundary (must stay 0): the comparison still catches lost content. */
export function screenRetention(a: Image, b: Image, lb: { x: number; y: number; w: number; h: number }, logicalW: number, logicalH: number) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('image dimensions differ');
  const w = a.width, tie = (d: number, o: number, n: number, logical: number) => d >= o && d < o + n && ((2 * (d - o) + 1) * logical) % (2 * n) === 0;
  const same = (x: Image, i: number, y: Image, j: number) => [0, 1, 2].every(c => x.data[i + c] === y.data[j + c]);
  let changed = 0, ties = 0, unexplained = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (same(a, i, b, i)) continue;
    const tx = tie(x, lb.x, lb.w, logicalW), ty = tie(y, lb.y, lb.h, logicalH);
    if (!tx && !ty) { changed++; continue; }
    ties++;
    const near: [number, number][] = [];
    for (const dx of tx ? [-1, 0, 1] : [0]) for (const dy of ty ? [-1, 0, 1] : [0]) if (dx || dy) near.push([x + dx, y + dy]);
    if (!near.some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < a.height && same(b, i, a, (ny * w + nx) * 4))) unexplained++;
  }
  return { changed, ties, unexplained };
}
