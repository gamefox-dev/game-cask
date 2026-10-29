// Browser shell. URL parameters:
//   ?game=<id>          game under /games/<id>/ (default: VITE_BGT_DEFAULT_GAME or sample2d)
//   ?backend=auto|webgpu|webgl2|webgpu-fail|none
//   ?seed=N&arg0=N&arg1=N
//   ?touch=auto|on|off  on-screen controls
//   ?debug=1            diagnostics overlay + verbose logs
//   ?bench=1            benchmark mode (enables the direct-call reference path)
//   ?ephemeral=1        do not persist storage
//   ?paused=1           start paused (tests step deterministically from frame 0)
import './style.css';
import { BGTRuntime, BackendPreference } from '../../bgt/runtime/runtime';
import { installTestAPI } from '../../bgt/runtime/testapi';
import { startOverlay } from './overlay';
import { runBench } from './bench';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return Number.isFinite(v) && q.has(k) ? v : d;
};
const game = (q.get('game') ?? import.meta.env.VITE_BGT_DEFAULT_GAME ?? 'sample2d').replace(/[^a-z0-9-]/g, '');
const testEnabled = import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1';
const debug = q.get('debug') === '1';
const bench = q.get('bench') === '1';

const rt = new BGTRuntime({
  container: document.getElementById('app')!,
  gameUrl: `${import.meta.env.BASE_URL}games/${game}/`,
  backend: (q.get('backend') as BackendPreference) ?? 'auto',
  debug: debug || testEnabled,
  seed: num('seed', 1),
  arg0: num('arg0', 0),
  arg1: num('arg1', 0),
  touch: (q.get('touch') as 'auto' | 'on' | 'off') ?? 'auto',
  ephemeralStorage: q.get('ephemeral') === '1',
  directDraw: bench,
  startPaused: q.get('paused') === '1',
});

window.addEventListener('error', (e) => rt.recordExternalError('js', e.message));
window.addEventListener('unhandledrejection', (e) => rt.recordExternalError('js', String((e as PromiseRejectionEvent).reason)));

if (testEnabled) installTestAPI(rt);
void rt.start().then(() => {
  if (debug) startOverlay(rt);
  if (bench) void runBench(rt, q);
});
