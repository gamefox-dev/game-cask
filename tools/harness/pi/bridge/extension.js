// Host imports are resolved by pi, not installed into this workspace or the user's global config.
import { Type } from '@earendil-works/pi-ai';
import { bridgeExtension } from './extension-core.mjs';

export default function (pi) { bridgeExtension(pi, Type); }
