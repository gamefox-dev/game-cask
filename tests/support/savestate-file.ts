// Small-fixture collection only. Scale tests and the probe never concatenate a file.
export async function snapshotChunks(stream:ReadableStream<Uint8Array>):Promise<Uint8Array[]> {
  const reader=stream.getReader(),chunks:Uint8Array[]=[];
  try{for(;;){const p=await reader.read();if(p.done)return chunks;chunks.push(p.value);}}finally{reader.releaseLock();}
}
export async function snapshotFileBytes(stream:ReadableStream<Uint8Array>):Promise<number>{
  const reader=stream.getReader();let bytes=0;
  try{for(;;){const p=await reader.read();if(p.done)return bytes;bytes+=p.value.length;}}finally{reader.releaseLock();}
}
export async function* fileChunks(chunks:Uint8Array[]){yield* chunks;}
