// §13.11 transform-feedback interface. No engine-specific shader names or CPU execution.
export interface FeedbackVarying { name: string; format: number; components: number }
export interface FeedbackLayout { separate: boolean; varyings: FeedbackVarying[]; strides: number[] }
export function feedbackLayout(source: string, separate: boolean, count: number): FeedbackLayout {
  const lines = source.split('\n');
  if (lines.pop() !== '' || lines.length !== count || !count || count > 16 || (separate && count > 4))
    throw new Error('Invalid feedback varying list');
  const seen = new Set<string>();
  const varyings = lines.map(line => {
    const m = /^([A-Za-z_]\w*) ([0-9]+)$/.exec(line);
    if (!m || m[1].startsWith('bgt_internal_') || seen.has(m[1])) throw new Error('Invalid/duplicate feedback varying');
    seen.add(m[1]);
    const format = Number(m[2]);
    if (format > 12 || format === 4) throw new Error('Invalid feedback format');
    const components = format < 4 ? format + 1 : format < 9 ? format - 4 : format - 8;
    return { name: m[1], format, components };
  });
  const strides = separate ? varyings.map(v => v.components * 4) : [varyings.reduce((s,v) => s + v.components * 4, 0)];
  if (strides.some(s => s > (separate ? 16 : 256))) throw new Error('Feedback component limit');
  return { separate, varyings, strides };
}
export function validateFeedbackInterface(source:string,layout:FeedbackLayout):void {
  const clean=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,' ');
  const formats:Record<string,number>={float:0,vec2:1,vec3:2,vec4:3,int:5,ivec2:6,ivec3:7,ivec4:8,uint:9,uvec2:10,uvec3:11,uvec4:12};
  const declared=new Map([...clean.matchAll(/\bout\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*;/g)].map(m=>[m[2],formats[m[1]]]));
  for(const v of layout.varyings)if(declared.get(v.name)!==v.format)throw new Error(`Feedback interface mismatch ${v.name}`);
}
export function feedbackVertexCount(topology:number,count:number):number {
  return topology===0?count:topology===1?Math.floor(count/2)*2:topology===2?Math.max(0,count-1)*2:
    topology===3?Math.floor(count/3)*3:Math.max(0,count-2)*3;
}
/** Complete primitives only; strips are captured as ordered lists, with alternating triangle winding. */
export function feedbackVertices(topology: number, count: number): number[] {
  if (topology === 0) return Array.from({length:count},(_,i)=>i);
  if (topology === 1 || topology === 3) {
    const size = topology === 1 ? 2 : 3;
    return Array.from({length:Math.floor(count/size)*size},(_,i)=>i);
  }
  const out:number[]=[];
  for(let i=0;i<count-(topology===2?1:2);i++) {
    if(topology===2) out.push(i,i+1);
    else out.push(i+(i%2),i+1-(i%2),i+2);
  }
  return out;
}
