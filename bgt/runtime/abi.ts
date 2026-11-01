// Mirror of bgt/include/bgt.h and bgt_cmd.h. tests/unit/abi-layout.test.ts
// compiles a C probe against the headers and checks these values match.

export const ABI_VERSION = (0 << 16) | (3 << 8);

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
export const CAP_RENDER_TARGETS = 1 << 8;
export const CAP_YIELD = 1 << 9;
export const CAP_READBACK = 1 << 10;
export const CAP_STREAM_FILES = 1 << 11;

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
export const EVENT_TARGETS_LOST = 1 << 4;

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
  TARGET: 0x07,
  TEX_CREATE: 0x10,
  TEX_UPDATE: 0x11,
  TEX_DELETE: 0x12,
  SPRITES: 0x20,
  TRIANGLES: 0x21,
  READBACK: 0x30,
} as const;

export const SPRITE_SIZE = 36;
export const VERTEX_SIZE = 20;

export const BLEND_OPAQUE = 0;
export const BLEND_ALPHA = 1;
export const BLEND_ADD = 2;
export const BLEND_PREMULTIPLIED = 3;
export const BLEND_INVERT = 4;
export const BLEND_MULTIPLY = 5;
export const BLEND_MODES = 6;

export const FILTER_NEAREST = 0;
export const FILTER_LINEAR = 1;
export const FORMAT_RGBA8 = 0;
export const TEX_RENDER_TARGET = 1 << 8;

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
  peekBytes: 65536,
  maxCatchUpUpdates: 4,
} as const;

export function errorName(code: number): string {
  return ERROR_NAMES[code] ?? `BGT_E_${code}`;
}

// ---- v0.3 GPU layer (§13); all offsets and lengths are bytes.
export const CAP_GPU = 1 << 12;
export const CAP_ENTROPY = 1 << 13; /* LANE-K1 */
export const GPU_OP = {
  BUFFER_CREATE: 0x40,
  BUFFER_UPDATE: 0x41,
  BUFFER_DELETE: 0x42,
  TEXTURE_CREATE: 0x43,
  TEXTURE_UPDATE: 0x44,
  TEXTURE_DELETE: 0x45,
  SAMPLER_CREATE: 0x46,
  SAMPLER_DELETE: 0x47,
  SHADER_CREATE: 0x48,
  SHADER_DELETE: 0x49,
  PIPELINE_CREATE: 0x4a,
  PIPELINE_DELETE: 0x4b,
  PASS_BEGIN: 0x4c,
  PASS_END: 0x4d,
  PIPELINE: 0x4e,
  VIEWPORT: 0x4f,
  SCISSOR: 0x50,
  STENCIL_REF: 0x51,
  BLEND_CONSTANT: 0x52,
  VERTEX_BUFFER: 0x53,
  INDEX_BUFFER: 0x54,
  UNIFORM_BUFFER: 0x55,
  TEXTURE: 0x56,
  DRAW: 0x57,
  DRAW_INDEXED: 0x58,
  TEXTURE_CREATE_EX: 0x59,
  TEXTURE_UPDATE_EX: 0x5a,
  SAMPLER_CREATE_EX: 0x5b,
  TEXTURE_READBACK: 0x5c,
  TEXTURE_GENERATE_MIPS: 0x5d,
} as const;
export const GPU = {
  BUFFER_VERTEX: 1,
  BUFFER_INDEX: 2,
  BUFFER_UNIFORM: 4,
  TEXTURE_SAMPLED: 1,
  TEXTURE_ATTACHMENT: 2,
  FORMAT_RGBA8: 0,
  FORMAT_RGBA8_SRGB: 1,
  FORMAT_R8: 2,
  FORMAT_RG8: 3,
  FORMAT_RGBA16F: 4,
  FORMAT_DEPTH24_STENCIL8: 5,
  FORMAT_DEPTH32F: 6,
  FORMAT_RGB10A2: 7,
  FORMAT_R16F: 8,
  FORMAT_RG16F: 9,
  FORMAT_R32F: 10,
  FORMAT_RG32F: 11,
  FORMAT_RGBA32F: 12,
  DIM_2D: 0,
  DIM_3D: 1,
  DIM_2D_ARRAY: 2,
  FORMAT_NONE: 4294967295,
  FILTER_NEAREST: 0,
  FILTER_LINEAR: 1,
  MIP_NONE: 0,
  MIP_NEAREST: 1,
  MIP_LINEAR: 2,
  WRAP_CLAMP: 0,
  WRAP_REPEAT: 1,
  WRAP_MIRROR: 2,
  COMPARE_NEVER: 0,
  COMPARE_LESS: 1,
  COMPARE_EQUAL: 2,
  COMPARE_LEQUAL: 3,
  COMPARE_GREATER: 4,
  COMPARE_NOT_EQUAL: 5,
  COMPARE_GEQUAL: 6,
  COMPARE_ALWAYS: 7,
  STENCIL_KEEP: 0,
  STENCIL_ZERO: 1,
  STENCIL_REPLACE: 2,
  STENCIL_INCREMENT_CLAMP: 3,
  STENCIL_DECREMENT_CLAMP: 4,
  STENCIL_INVERT: 5,
  STENCIL_INCREMENT_WRAP: 6,
  STENCIL_DECREMENT_WRAP: 7,
  STAGE_VERTEX: 1,
  STAGE_FRAGMENT: 2,
  STAGE_COMBINED: 3,
  LANG_WGSL: 0,
  LANG_GLSL330: 1,
  LANG_GLSLES300: 2,
  TOPOLOGY_POINTS: 0,
  TOPOLOGY_LINES: 1,
  TOPOLOGY_LINE_STRIP: 2,
  TOPOLOGY_TRIANGLES: 3,
  TOPOLOGY_TRIANGLE_STRIP: 4,
  CULL_NONE: 0,
  CULL_FRONT: 1,
  CULL_BACK: 2,
  FRONT_CCW: 0,
  FRONT_CW: 1,
  BLEND_ZERO: 0,
  BLEND_ONE: 1,
  BLEND_SRC_COLOR: 2,
  BLEND_ONE_MINUS_SRC_COLOR: 3,
  BLEND_DST_COLOR: 4,
  BLEND_ONE_MINUS_DST_COLOR: 5,
  BLEND_SRC_ALPHA: 6,
  BLEND_ONE_MINUS_SRC_ALPHA: 7,
  BLEND_DST_ALPHA: 8,
  BLEND_ONE_MINUS_DST_ALPHA: 9,
  BLEND_CONSTANT: 10,
  BLEND_ONE_MINUS_CONSTANT: 11,
  BLEND_ADD: 0,
  BLEND_SUBTRACT: 1,
  BLEND_REVERSE_SUBTRACT: 2,
  BLEND_MIN: 3,
  BLEND_MAX: 4,
  VERTEX_FLOAT: 0,
  VERTEX_FLOAT2: 1,
  VERTEX_FLOAT3: 2,
  VERTEX_FLOAT4: 3,
  VERTEX_UNORM8X4: 4,
  VERTEX_SINT: 5,
  VERTEX_SINT2: 6,
  VERTEX_SINT3: 7,
  VERTEX_SINT4: 8,
  VERTEX_UINT: 9,
  VERTEX_UINT2: 10,
  VERTEX_UINT3: 11,
  VERTEX_UINT4: 12,
  STEP_VERTEX: 0,
  STEP_INSTANCE: 1,
  INDEX_UINT16: 0,
  INDEX_UINT32: 1,
  LOAD_LOAD: 0,
  LOAD_CLEAR: 1,
} as const;
export const GPU_LAYOUT = {
  buffer_create: 20,
  buffer_update: 16,
  buffer_delete: 4,
  texture_create: 24,
  texture_update: 32,
  texture_delete: 4,
  sampler_create: 32,
  sampler_delete: 4,
  shader_create: 24,
  shader_delete: 4,
  pipeline_delete: 4,
  pipeline: 4,
  viewport: 24,
  scissor: 16,
  stencil_ref: 4,
  blend_constant: 16,
  vertex_buffer: 16,
  index_buffer: 16,
  uniform_buffer: 16,
  texture: 12,
  draw: 16,
  draw_indexed: 20,
  texture_create_ex: 32,
  texture_update_ex: 40,
  sampler_create_ex: 44,
  texture_readback: 36,
  texture_generate_mips: 8,
  pipeline_create: 104,
  vertex_layout: 8,
  attribute: 16,
  color_target: 36,
  pass_begin: 28,
  color_attachment: 28,
} as const;
export const GPU_PIPELINE_FIELDS = [
  'handle',
  'vertex_shader',
  'fragment_shader',
  'topology',
  'cull',
  'front_face',
  'depth_format',
  'depth_test',
  'depth_write',
  'depth_compare',
  'stencil_enable',
  'stencil_read_mask',
  'stencil_write_mask',
  'front_compare',
  'front_fail',
  'front_depth_fail',
  'front_pass',
  'back_compare',
  'back_fail',
  'back_depth_fail',
  'back_pass',
  'uniform_mask',
  'texture_mask',
  'buffer_count',
  'attribute_count',
  'color_count',
] as const;
export const GPU_LIMITS = {
  handles: 1023, budget: 256 * 1024 * 1024, bufferSize: 64 * 1024 * 1024,
  textureDimension: 4096, vertexBuffers: 8, attributes: 16, slots: 8, colorAttachments: 4,
  uniformAlignment: 256, uniformRange: 65536, stride: 2048, shaderBytes: 1024 * 1024,
  volumeDimension: 256, arrayLayers: 256,
} as const;
export const GPU_LIMITS_SIZE = 80;
export const GPU_LIMITS_OFFSETS = {
  gpu_supported: 16, max_gpu_handles: 20, gpu_budget_bytes: 24, max_buffer_bytes: 28,
  max_vertex_buffers: 32, max_attributes: 36, max_binding_slots: 40, max_color_attachments: 44,
  uniform_offset_alignment: 48, max_uniform_range: 52, max_vertex_stride: 56, max_shader_bytes: 60,
  shader_languages: 64, max_mip_levels: 68, max_instances: 72, reserved: 76,
} as const;
