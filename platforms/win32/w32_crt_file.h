/* Bounded FILE buffering above (never instead of) deferred immutable range I/O. MIT. */
static void file_sync_aliases(crt_file_t *f) {
    for(unsigned i=0;i<64;i++)if(cfiles[i].open&&file_backend(&cfiles[i])==f){
        cfiles[i].eof=f->eof;cfiles[i].error=f->error;cfile_sync(&cfiles[i]);
    }
}
static uint8_t *file_buffer(crt_file_t *f) {
    if(f->user_buffer)return cwmem(f->user_buffer,f->capacity);
    if(!f->capacity)f->capacity=16384;
    if(!f->buffer)f->buffer=malloc(f->capacity);
    if(!f->buffer){f->error=1;crt_errno(12);}
    return f->buffer;
}
static int file_flush(crt_file_t *f) {
    if(f->direction==2&&f->end){
        uint8_t *b=file_buffer(f);
        uint32_t n=f->end;
        if(!b||file_write_raw(f,b,n)!=n){file_sync_aliases(f);return -1;}
    }
    if(f->handle&&f->direction==1&&!w32_file_seek_pos(f->handle,(int64_t)f->pos,0,0)){
        f->error=1;crt_errno(5);file_sync_aliases(f);return -1;
    }
    f->begin=f->end=0;f->direction=0;return 0;
}
static void file_flush_all(void) {
    for(unsigned i=0;i<64;i++)if(cfiles[i].open&&!cfiles[i].owner&&cfiles[i].direction==2)file_flush(&cfiles[i]);
}
static int file_raw_peek(crt_file_t *f) {
    if(f->begin==f->end){
        f->begin=f->end=0;
        uint8_t *b=file_buffer(f);if(!b)return -2;
        f->buffer_pos=f->pos;
        if(f->handle){
            if(!w32_file_read_ahead(f->handle,b,f->capacity,&f->end)){
                f->error=1;crt_errno(5);return -2;
            }
        }else if(f->node){
            uint64_t n=f->pos<f->node->size?f->node->size-f->pos:0;
            if(n>f->capacity)n=f->capacity;
            f->end=(uint32_t)n;
            if(n)memcpy(b,cmem(f->node->data+(uint32_t)f->pos,(uint32_t)n),(uint32_t)n);
        }
        if(!f->end)return -1;
    }
    return file_buffer(f)[f->begin];
}
static void file_raw_take(crt_file_t *f,uint32_t n) {
    if(f->handle)w32_file_consumed(f->handle,f->pos,n);
    f->begin+=n;f->pos+=n;
}
static uint32_t file_read(crt_file_t *stream,uint8_t *dst,uint32_t n) {
    if(!stream){crt_errno(9);return 0;}
    crt_file_t *f=file_backend(stream);
    if(!stream->read){f->error=1;crt_errno(9);file_sync_aliases(f);return 0;}
    if(!n)return 0;
    if(f->direction==2&&file_flush(f))return 0;
    f->direction=1;
    uint32_t got=0;
    if(f->pushback>=0){dst[got++]=(uint8_t)f->pushback;f->pushback=-1;}
    while(got<n&&!f->eof){
        int c=file_raw_peek(f);
        if(c<0){if(c==-1)f->eof=1;break;}
        if(f->binary){
            uint32_t count=f->end-f->begin;if(count>n-got)count=n-got;
            memcpy(dst+got,file_buffer(f)+f->begin,count);file_raw_take(f,count);got+=count;f->last_width=1;
        }else{
            file_raw_take(f,1);f->last_width=1;
            if(c==26){f->eof=1;break;} /* DOS text EOF; retained until clearerr/seek */
            if(c=='\r'){
                int next=file_raw_peek(f);
                if(next=='\n'){file_raw_take(f,1);c='\n';f->last_width=2;}
                else if(next>=0&&f->handle)w32_file_observed(f->handle,f->pos,1);
            }
            dst[got++]=(uint8_t)c;
        }
    }
    file_sync_aliases(f);return got;
}
static int file_output_byte(crt_file_t *f,uint8_t c) {
    /* Default output remains write-through. Explicit setvbuf owns an output buffer. */
    if(f->buffering!=1)return file_write_raw(f,&c,1)==1;
    uint8_t *b=file_buffer(f);if(!b)return 0;
    if(f->end==f->capacity){if(file_flush(f))return 0;f->direction=2;b=file_buffer(f);}
    b[f->end++]=c;return 1;
}
static uint32_t file_write(crt_file_t *stream,const uint8_t *src,uint32_t n) {
    if(!stream){crt_errno(9);return 0;}
    crt_file_t *f=file_backend(stream);
    if(!stream->write){f->error=1;crt_errno(9);file_sync_aliases(f);return 0;}
    if(!n)return 0;
    if(f->direction==1&&file_flush(f))return 0;
    f->pushback=-1;f->direction=2;
    if(f->append&&f->node&&!f->end)f->pos=f->node->size;
    uint32_t got=0;
    /* Fast path retains binary bulk writes and existing process-local VFS behavior. */
    if(f->binary&&f->buffering!=1)got=file_write_raw(f,src,n);
    else for(;got<n;got++){
        if(!f->binary&&src[got]=='\n'&&!file_output_byte(f,'\r'))break;
        if(!file_output_byte(f,src[got]))break;
    }
    file_sync_aliases(f);return got;
}
/* Descriptor operations use the physical underlying cursor, as on Windows. Call
 * fflush/position before switching between FILE and fd I/O; a raw read/seek drops
 * speculative FILE bytes but does not rewind the underlying descriptor. */
static int file_descriptor_read(crt_file_t *f,uint8_t *dst,uint32_t n,uint32_t *got) {
    *got=0;
    if(f->handle){int ok=w32_file_read_buf(f->handle,dst,n,got);f->pos+=*got;return ok;}
    if(f->node){
        uint32_t count=f->pos<f->node->size?(uint32_t)(f->node->size-f->pos):0;
        if(count>n)count=n;
        if(count)memcpy(dst,cmem(f->node->data+(uint32_t)f->pos,count),count);
        f->pos+=count;*got=count;
    }
    return 1;
}
static int file_descriptor(crt_file_t *f) {
    if(f->direction==2&&file_flush(f))return -1;
    if(f->handle&&!w32_file_seek_pos(f->handle,0,1,&f->pos))return -1;
    f->begin=f->end=0;f->direction=0;f->pushback=-1;f->eof=0;file_sync_aliases(f);return 0;
}
