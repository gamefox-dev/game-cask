// Loaded only by the opt-in browser test controller, before host creation.
import { GameHost, HostError } from './host';
import { captureWasm, restoreWasm } from './savestate-wasm';
import {cloneCheckpoint} from './savestate-clone';
export function assertBoundary(this: GameHost): void {
    if (this['inUpdate'] || this['ioPending'] || this['frame'].items.length) throw new HostError('Checkpoint requires a consumed quiescent update boundary');
    if (this['jspiTask'] || this['jspiResume']) throw new HostError('Unsupported checkpoint state: suspended JSPI continuation; use Asyncify');
  }
export function captureHost(this: GameHost) {
    this['assertCheckpointBoundary']();
    const {backend: _backend, ...gpu} = this['gpu'] ?? {backend:undefined};
    void _backend;
    return {wasm: captureWasm(this['rawExports']), data: cloneCheckpoint({
      abiVersion:this['abiVersion'], ioPtr:this['ioPtr'], initialized:this['initialized'], asyncState:this['asyncState'],
      asyncBuf:this['asyncBuf'], gamepads:this['gamepads'], state:this['state'], logicalWidth:this['logicalWidth'],
      logicalHeight:this['logicalHeight'], flags:this['flags'], frameIndex:this['frameIndex'], yields:this['yields'],
      sizeChanged:this['sizeChanged'], textures:{entries:this['textures'].entries,totalBytes:this['textures'].totalBytes},
      gpu:this['gpu'] ? gpu : null, codeCoverage:this['codeCoverage'], codeCoverageDropped:this['codeCoverageDropped'],
      opCounts:this['opCounts'], importCounts:this['importCounts'], commandErrors:this['commandErrors'], commandErrorCount:this['commandErrorCount'],
    }), requests:this['requests'].checkpoint()};
  }
export function restoreHost(this: GameHost, s: ReturnType<typeof captureHost>): void {
    restoreWasm(this['rawExports'], s.wasm);
    const {textures, gpu, ...data} = cloneCheckpoint(s.data);
    Object.assign(this, data); Object.assign(this['textures'], textures);
    if (gpu) { if (!this['gpu']) throw new HostError('Checkpoint GPU mismatch'); Object.assign(this['gpu'], gpu); }
    this['requests'].restoreCheckpoint(s.requests); this['frame'].reset(this['logicalWidth'],this['logicalHeight']);
  }

GameHost.prototype.assertCheckpointBoundary = assertBoundary;
GameHost.prototype.checkpoint = captureHost;
GameHost.prototype.restoreCheckpoint = restoreHost;

import { InputManager } from '../input/input';
export function captureInputManager(this: InputManager) {
    return cloneCheckpoint({keysHeld:this['keysHeld'], keysLatched:this['keysLatched'], keyButtons:this['keyButtons'],
      sources:this['sources'], latchedPress:this['latchedPress'], prevButtons:this['prevButtons'], pointer:this['pointer'],
      touches:this['touches'], events:this['events'], axes:this['axes'], testPads:this['testPads'], gamepads:this['gamepads'],
      prevPad:this['prevPad'], letterbox:this['letterbox'], logicalW:this['logicalW'], logicalH:this['logicalH'], dpr:this['dpr']});
  }
export function restoreInputManager(this: InputManager,s: ReturnType<typeof captureInputManager>): void { Object.assign(this, cloneCheckpoint(s)); }

InputManager.prototype.checkpoint=captureInputManager;InputManager.prototype.restoreCheckpoint=restoreInputManager;

import { Vfs } from './vfs';
export function captureVfs(this: Vfs) {
    return cloneCheckpoint({open: this['open'], nextHandle: this['nextHandle'], missing: this['missing'],
      ranges: this['ranges'], consumedBytes: this['consumedBytes'], observedBytes: this['observedBytes'],
      readAheadBytes: this['readAheadBytes'], readAheadRequests: this['readAheadRequests'], aheadRanges: this['aheadRanges']});
  }
export function restoreVfs(this: Vfs,s: ReturnType<typeof captureVfs>): void { Object.assign(this, cloneCheckpoint(s)); }

Vfs.prototype.checkpoint=captureVfs;Vfs.prototype.restoreCheckpoint=restoreVfs;

import { Requests } from './requests';
export function captureRequests(this: Requests) {
    if ([...this['entries'].values()].some(t => !t.done)) throw new Error('Checkpoint has pending requests');
    return cloneCheckpoint({entries: this['entries'], epoch: this['epoch'], bytes: this['bytes'], next: this['next']});
  }
export function restoreRequests(this: Requests,s: ReturnType<typeof captureRequests>): void { Object.assign(this, cloneCheckpoint(s)); }

Requests.prototype.checkpoint=captureRequests;Requests.prototype.restoreCheckpoint=restoreRequests;
