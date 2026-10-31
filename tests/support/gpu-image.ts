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
