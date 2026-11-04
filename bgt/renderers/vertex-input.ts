// §13.3/13.5 vertex fetch: scalar class must match; vector width need not.
export type VertexScalar = 'f32' | 'i32' | 'u32';
export function vertexFormatScalar(format: number): VertexScalar {
  return format < 5 ? 'f32' : format < 9 ? 'i32' : 'u32';
}
export function vertexFormatWidth(format: number): number {
  return format < 4 ? format + 1 : format === 4 ? 4 : format < 9 ? format - 4 : format - 8;
}
/** Canonical translated WGSL scalar/vector IO (not arbitrary native WGSL reflection). */
export function canonicalVertexType(type: string): { scalar: VertexScalar; width: number } | undefined {
  const match = /^(?:([fiu]32)|vec([234])([fiu]))$/.exec(type.trim());
  if (!match) return;
  return { scalar: (match[1] ?? match[3] + '32') as VertexScalar, width: Number(match[2] ?? 1) };
}
