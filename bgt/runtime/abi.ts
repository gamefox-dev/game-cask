// Mirror of bgt/include/bgt.h and bgt_cmd.h. tests/unit/abi-layout.test.ts
// compiles a C probe against the headers and checks these values match.

export const ABI_VERSION = (0 << 16) | (1 << 8);

export const BGT_OK = 0;
export const E_INVALID = -1;
export const E_BOUNDS = -2;
export const E_LIMIT = -3;
export const E_UNSUPPORTED = -4;
export const E_NOT_FOUND = -5;
export const E_IO = -6;
export const E_STATE = -7;

export const ERROR_NAMES: Record<number, string> = {
  [BGT_OK]: 'BGT_OK',
  [E_INVALID]: 'BGT_E_INVALID',
  [E_BOUNDS]: 'BGT_E_BOUNDS',
  [E_LIMIT]: 'BGT_E_LIMIT',
  [E_UNSUPPORTED]: 'BGT_E_UNSUPPORTED',
  [E_NOT_FOUND]: 'BGT_E_NOT_FOUND',
  [E_IO]: 'BGT_E_IO',
  [E_STATE]: 'BGT_E_STATE',
};

export const CAP_AUDIO = 1 << 0;
export const CAP_STORAGE = 1 << 1;
export const CAP_TOUCH = 1 << 2;
export const CAP_GAMEPAD = 1 << 3;
export const CAP_LINEAR_FILTER = 1 << 4;
export const CAP_SCISSOR = 1 << 5;
export const CAP_TRIANGLES = 1 << 6;
export const CAP_DIRECT_DRAW = 1 << 7;

export const BACKEND_NONE = 0;
export const BACKEND_WEBGPU = 1;
export const BACKEND_WEBGL2 = 2;
export const BACKEND_HEADLESS = 3;

export const BUTTONS = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  A: 1 << 4,
  B: 1 << 5,
  X: 1 << 6,
  Y: 1 << 7,
  START: 1 << 8,
  SELECT: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
} as const;
export type ButtonName = keyof typeof BUTTONS;

export const EVENT_RESIZED = 1 << 0;
export const EVENT_DEVICE_RESET = 1 << 1;
export const EVENT_AUDIO_UNLOCKED = 1 << 2;
export const EVENT_FOCUS_LOST = 1 << 3;

export const FLAG_INTEGER_SCALE = 1 << 0;

export const DT_US = 16667;
export const MAX_TOUCHES = 4;

/** Byte offsets inside bgt_io_t. */
export const IO = {
  abi_version: 0,
  backend: 4,
  caps: 8,
  audio_sample_rate: 12,
  seed: 16,
  display_width: 20,
  display_height: 24,
  arg0: 28,
  logical_width: 32,
  logical_height: 36,
  flags: 40,
  arg1: 44,
  frame: 48,
  buttons: 52,
  buttons_pressed: 56,
  buttons_released: 60,
  keys: 64,
  keys_pressed: 96,
  pointer_x: 128,
  pointer_y: 132,
  pointer_buttons: 136,
  pointer_inside: 140,
  axes: 144,
  touch_count: 152,
  events: 156,
  touches: 160,
  SIZE: 224,
  TOUCH_SIZE: 16,
} as const;

// ---- command stream
export const CMD_MAGIC = 0x43544742;
export const CMD_VERSION = 1;
export const CMD_HEADER_SIZE = 16;
export const CMD_PREFIX_SIZE = 8;

export const OP = {
  CLEAR: 0x01,
  VIEWPORT: 0x02,
  SCISSOR: 0x03,
  TRANSFORM: 0x04,
  BLEND: 0x05,
  TEXTURE: 0x06,
  TEX_CREATE: 0x10,
  TEX_UPDATE: 0x11,
  TEX_DELETE: 0x12,
  SPRITES: 0x20,
  TRIANGLES: 0x21,
} as const;

export const SPRITE_SIZE = 36;
export const VERTEX_SIZE = 20;

export const BLEND_OPAQUE = 0;
export const BLEND_ALPHA = 1;
export const BLEND_ADD = 2;
export const BLEND_PREMULTIPLIED = 3;
export const BLEND_MODES = 4;

export const FILTER_NEAREST = 0;
export const FILTER_LINEAR = 1;
export const FORMAT_RGBA8 = 0;

export const LIMITS = {
  submitBytes: 8 * 1024 * 1024,
  commands: 65536,
  submitsPerFrame: 256,
  verticesPerFrame: 1572864,
  textures: 1024,
  textureDim: 4096,
  textureBytes: 256 * 1024 * 1024,
  logicalDim: 4096,
  assetHandles: 256,
  storageKeyBytes: 64,
  storageValueBytes: 65536,
  logBytes: 4096,
  debugStateBytes: 1 << 20,
  maxCatchUpUpdates: 4,
} as const;

export function errorName(code: number): string {
  return ERROR_NAMES[code] ?? `BGT_E_${code}`;
}
