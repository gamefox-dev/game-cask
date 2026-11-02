// @bgt-examples: none
import { expect, it } from 'vitest';
// @ts-expect-error plain ESM internal generated-code adapter
import { registryRows } from '../../tools/build/chunks.mjs';
const table = (row: string) => `ignored body\nconst x86_lifted_entry_t x86_lifted_module_0000[]={\n${row}\n};\n`;
it('chunk registries preserve native step symbols and i386 continuation owners with exact signatures', () => {
  expect(registryRows(table('{0x01001000u,F_01001000,0x01001100u,N_01001000},'))).toEqual([
    { addr: 0x01001000, row: '{0x01001000u,F_01001000,0x01001100u,N_01001000},',
      declarations: ['void F_01001000(void);', 'void N_01001000(uint32_t);'] },
  ]);
  expect(registryRows(table('{0x00401009u,F_00401000,0x00000000u,0},'))).toEqual([
    { addr: 0x00401009, row: '{0x00401009u,F_00401000,0x00000000u,0},', declarations: ['void F_00401000(void);'] },
  ]);
  expect(registryRows(table(''))).toEqual([]);
});
it.each([
  '{0x1000u,F_1000,0x1100u},', '{0x1000u,F_1000,0x1100u,N_2000},',
  '{0x1000u,F_1000,0x1100u,N_1000}', '{0x1000u,F_1000,0x1100u,N_1000,0},',
  '{0x1000u,F_1000,0x1100u,foreign},', '{0x1000u,F_1000,0x1100u,0},junk',
  '{0x1000u,F_1000,0x1100u,N_1000},\nmalformed',
])('rejects malformed registry rather than dropping it: %s', (row) => {
  expect(() => registryRows(table(row))).toThrow('malformed lifted registry row');
});
it('rejects missing registry framing', () => { expect(() => registryRows('body')).toThrow('lifter registry format changed'); });
