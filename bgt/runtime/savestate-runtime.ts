// Test-only runtime lifecycle adapter. All accesses are to the regular host's own fields.
import { BGTRuntime } from './runtime';
import type { GameHost } from './host';
import type { Renderer, Letterbox } from '../renderers/types';
  /** Commit a fully rebuilt checkpoint only after replay has succeeded. No resize or guest calls. */
function replace(this: BGTRuntime,host: GameHost, renderer: Renderer, letterbox: Letterbox): void {
    const old = this['renderer'];
    this['renderer'] = renderer; this['host'] = host; this['canvas'] = renderer.canvas; this['letterbox'] = {...letterbox};
    this['canvas'].className = 'bgt-canvas'; this['stage'].replaceChildren(this['canvas']);
    this['input'].retarget(this['canvas']); this['wireRenderer'](renderer);
    this['acc'] = 0; this['last'] = 0; old?.destroy();
  }


  /** A checkpoint is never allowed to overlap an update, render or explicit step. */
function quiescent(this: BGTRuntime): boolean { return this['ready'] && this['paused'] && !this['failed'] && !this['outsideSlice'] && !this['updateBusy'] && !this['renderBusy'] && !this['renderQueued'] && !this['stepping'] && !this['host']?.ioPending && !this['renderer']?.lost; }

BGTRuntime.prototype.testReplace=replace;BGTRuntime.prototype.testQuiescent=quiescent;
