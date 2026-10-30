// Bounded file preparation. Original bytes remain private; no executable is ever run.
import { createHash } from 'node:crypto';
import { openSync, closeSync, fstatSync, readSync, writeSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { peMetadata } from '../inspect/pe.mjs';

export function hashFile(file) {
  const fd=openSync(file,'r');try {
    const hash=createHash('sha256'), b=Buffer.alloc(1024*1024);let off=0,n;
    while((n=readSync(fd,b,0,b.length,off))>0){hash.update(b.subarray(0,n));off+=n;}
    return hash.digest('hex');
  }finally{closeSync(fd);}
}
export function streamFile(file,path,out,chunkSize=256*1024) {
  if(!/^[^\\:]+$/.test(path)||path.startsWith('/')||path.split('/').some((s)=>!s||s==='.'||s==='..'))throw new Error('invalid streamed path');
  if(!Number.isInteger(chunkSize)||chunkSize<4096||chunkSize>1024*1024)throw new Error('stream chunkSize must be 4096..1048576');
  const fd=openSync(file,'r'),chunks=[];
  try {
    const size=fstatSync(fd).size;
    mkdirSync(join(out,'chunks'),{recursive:true});
    for(let off=0;off<size;off+=chunkSize){
      const n=Math.min(chunkSize,size-off),b=Buffer.alloc(n);
      if(readSync(fd,b,0,n,off)!==n)throw new Error('short file chunk read');
      const sha256=createHash('sha256').update(b).digest('hex'),url=`chunks/${sha256}.bin`;
      writeFileSync(join(out,url),b);chunks.push({offset:off,size:n,url,sha256});
    }
    return {path,size,chunkSize,chunks};
  }finally{closeSync(fd);}
}

export function compactPe(file,out) {
  const fd=openSync(file,'r');let dst;
  try {
    const size=fstatSync(fd).size,read=(o,n)=>{const b=Buffer.alloc(n);return b.subarray(0,readSync(fd,b,0,n,o));};
    const pe=peMetadata(read,size);
    if(pe.headerBytes>16*1024*1024||pe.imageBytes>256*1024*1024)throw new Error('PE virtual image exceeds loader preparation limits');
    const header=read(0,pe.headerBytes),nt=header.readUInt32LE(60),so=nt+24+header.readUInt16LE(nt+20);
    let cursor=pe.headerBytes;dst=openSync(out,'w');writeSync(dst,header);
    for(let i=0;i<pe.sectionTable.length;i++){
      const s=pe.sectionTable[i],n=Math.min(s.rawSize,s.vsize||s.rawSize);
      if(s.rawPtr+n>size)throw new Error('PE section outside source file');
      const aligned=Math.ceil(cursor/512)*512;
      if(aligned>cursor)writeSync(dst,Buffer.alloc(aligned-cursor));cursor=aligned;
      header.writeUInt32LE(n,so+i*40+16);header.writeUInt32LE(n?cursor:0,so+i*40+20);
      for(let off=0;off<n;off+=1024*1024){const b=read(s.rawPtr+off,Math.min(1024*1024,n-off));writeSync(dst,b);}
      cursor+=n;
    }
    writeSync(dst,header,0,header.length,0);return {sourceBytes:size,loaderBytes:cursor};
  }finally{if(dst!==undefined)closeSync(dst);closeSync(fd);}
}
