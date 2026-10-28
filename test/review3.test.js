// -----------------------------------------------------------------------------
// The points of review r3 (_lots/lot18/reviews/resol-r3.md): the VSF table
// searched with the address masks of its packet templates, as resol-vbus does
// (I-C: DeltaSol MX [HQM #1] is 0x7E31, covered by the template 0x7E30 /
// 0xFFF0), the address of a packet read from the numbers of its header (m2),
// and a split counter whose lower piece reads 1000 or more (m1).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNITS,
  addressOfPacket,
  counterOf,
  joinedFields,
  kindOf,
  publishedFields,
  templateOf,
} from '../src/devices.js';
import { addressOfId, parseLive } from '../src/resol/model.js';
import { VSF_COUNTERS } from '../src/vsf-table.js';
import { liveData, SERIAL } from './helpers/fixtures.js';
import { CONFIG, POLL, answer, created, setup } from './helpers/app.js';

const FIELDS = JSON.parse(
  readFileSync(new URL('./fixtures/vsf-fields.json', import.meta.url), 'utf8'),
);
const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const pid = (d, s, c) => `00_${hex(d)}_${hex(s)}_${hex(c)}`;

/** The addresses a mask covers: all of them up to 16, else a sample (a mask 0 covers 65536). */
function covered(address, mask) {
  const base = address & mask;
  const free = ~mask & 0xffff;
  if (free < 16) {
    const out = [];
    for (let a = 0; a <= 0xffff && out.length < 16; a += 1) if ((a & mask) === base) out.push(a);
    return out;
  }
  return [...new Set([address, base, base | free, 0x0010, 0x0015, 0x7e11])].filter(
    (a) => (a & mask) === base,
  );
}

test('every counter field of the VSF, at every address its masks cover: the same key and class in en, de, fr', () => {
  assert.ok(FIELDS.length > 600, `${FIELDS.length} fields`);
  let checked = 0;
  let masked = 0;
  for (const f of FIELDS) {
    const [dst, src, cmd] = f.packet.split('_').map((h) => Number.parseInt(h, 16));
    const dmask = Number.parseInt(f.dmask, 16);
    const smask = Number.parseInt(f.smask, 16);
    for (const d of covered(dst, dmask)) {
      for (const s of covered(src, smask)) {
        const packetId = pid(d, s, cmd);
        const keys = ['en', 'de', 'fr'].map(
          (lang) => kindOf({ id: f.id, name: f[lang] ?? '', unitCode: f.unit }, packetId)?.key,
        );
        assert.equal(new Set(keys).size, 1, `${packetId} ${f.id} ${f.en}: ${keys.join(' / ')}`);
        const counter = counterOf({ id: f.id, name: f.fr ?? '' }, UNITS[f.unit], packetId) ?? null;
        assert.equal(counter, f.counter, `${packetId} ${f.id} ${f.en}`);
        checked += 1;
        if (d !== dst || s !== src) masked += 1;
      }
    }
  }
  assert.ok(masked > 1000, `${masked} fields at an address covered by a mask (${checked} in all)`);
});

test('the table: every template found at its own address (no template hides another)', () => {
  for (const [dst, dmask, src, smask, cmd] of VSF_COUNTERS) {
    const t = templateOf({ destination: dst, source: src, command: cmd });
    assert.deepEqual(
      [t.dst, t.dmask, t.src, t.smask, t.cmd],
      [dst, dmask, src, smask, cmd],
      pid(dst, src, cmd),
    );
  }
});

/** The heat quantity module of each family the review names, its 1st and its last address. */
const FAMILIES = [
  ['DeltaSol MX [HQM #1]', 0x7e31],
  ['DeltaSol MX [HQM #15]', 0x7e3f],
  ['DeltaSol MX Plus [WMZ #1]', 0x1931],
  ['DeltaTherm HC max [HQM #1]', 0x1731],
  ['COSMO Multi [WMZ #1]', 0x1f31],
  ['Citrin SLR XT [WMZ #1]', 0x3631],
];

test('2nd module and next ones (HQM #1...): the monthly "Quantité de chaleur" is no lifetime counter', () => {
  for (const [name, source] of FAMILIES) {
    const id = pid(0x0010, source, 0x0100);
    const live = parseLive(
      liveData({
        packets: [
          {
            id,
            source: name,
            fields: [
              { id: '000_4_0', name: 'Quantité de chaleur', unit: 'WattHours', value: 7_000_000 },
              { id: '020_4_0', name: 'Quantité de chaleur', unit: 'WattHours', value: 150_000 },
            ],
          },
        ],
      }),
    );
    const keys = publishedFields(live.packets[0]).map((e) => e.kind.key);
    assert.deepEqual(keys, ['000_4_0_kwh_total', '020_4_0_kwh'], name);
    for (const fieldName of ['Heat quantity month', 'Wärmemenge Monat']) {
      const kind = kindOf({ id: '020_4_0', name: fieldName, unitCode: 'WattHours' }, id);
      assert.equal(kind.key, '020_4_0_kwh', `${name} ${fieldName}`);
    }
  }
});

test('masks: an address outside them, another destination or command is not the template', () => {
  const month = { id: '020_4_0', name: 'Quantité de chaleur', unitCode: 'WattHours' };
  // 0x7E40: outside 0x7E30 / 0xFFF0; the words of the name (unknown = lifetime).
  assert.equal(templateOf({ destination: 0x0010, source: 0x7e40, command: 0x0100 }), undefined);
  assert.equal(kindOf(month, '00_0010_7E40_0100').key, '020_4_0_kwh_total');
  // Another destination (mask 0xFFFF), another command.
  assert.equal(templateOf({ destination: 0x0011, source: 0x7e31, command: 0x0100 }), undefined);
  assert.equal(templateOf({ destination: 0x0010, source: 0x7e31, command: 0x0200 }), undefined);
  // A destination mask 0: any destination (template 0x0000 / 0x0000, 0x112E).
  for (const destination of [0x0000, 0x0010, 0x0015]) {
    const t = templateOf({ destination, source: 0x112e, command: 0x0100 });
    assert.equal(t?.src, 0x112e, hex(destination));
  }
  // A source mask 0xFFFE (0x7316 and 0x7317), 0xFFFC (0x1064 to 0x1067).
  assert.equal(templateOf({ destination: 0x0010, source: 0x7317, command: 0x0100 })?.src, 0x7316);
  assert.equal(templateOf({ destination: 0x0010, source: 0x7318, command: 0x0100 }), undefined);
  assert.equal(templateOf({ destination: 0x0010, source: 0x1067, command: 0x0100 })?.src, 0x1064);
  assert.equal(templateOf({ destination: 0x0010, source: 0x1068, command: 0x0100 }), undefined);
  assert.equal(templateOf(undefined), undefined);
});

test('the address of a packet: the numbers of its header, else its id', () => {
  assert.deepEqual(addressOfId('00_0010_7E31_0100'), {
    destination: 0x0010,
    source: 0x7e31,
    command: 0x0100,
  });
  assert.deepEqual(addressOfId('01_0010_7e31_10_0100'), {
    destination: 0x0010,
    source: 0x7e31,
    command: 0x0100,
  });
  for (const bad of [
    '00_0010_7E31_20_0100',
    '00_0010_7E31',
    'x',
    '00_0010_7E3_0100',
    '00_0010_7E31_0100_00',
    '000_0010_7E31_0100',
    '',
    null,
  ]) {
    assert.equal(addressOfId(bad), undefined, String(bad));
  }
  const fields = [{ id: '020_4_0', name: 'Quantité de chaleur', unit: 'WattHours', value: 1 }];
  const read = (numbers) =>
    parseLive(liveData({ packets: [{ id: '00_0010_7E40_0100', source: 'x', fields, numbers }] }))
      .packets[0];
  // The numbers win over the id: 0x7E31 is the template 0x7E30 / 0xFFF0.
  const byNumbers = read({ destination: 0x0010, source: 0x7e31, command: 0x0100 });
  assert.deepEqual(byNumbers.address, { destination: 0x0010, source: 0x7e31, command: 0x0100 });
  assert.equal(publishedFields(byNumbers)[0].kind.key, '020_4_0_kwh');
  // Without them, or not numbers of 16 bits: the id (0x7E40, no template: the words).
  for (const numbers of [
    null,
    { destination: 0x0010, source: '7E31', command: 0x0100 },
    { destination: 0x0010, source: 0x17e31, command: 0x0100 },
    { destination: 0x0010, source: 0x7e31, command: -1 },
    { destination: 0x0010, source: 0x7e31, command: 1.5 },
    { destination: undefined, source: 0x7e31, command: 0x0100 },
  ]) {
    const packet = read(numbers);
    assert.deepEqual(
      packet.address,
      { destination: 0x0010, source: 0x7e40, command: 0x0100 },
      JSON.stringify(numbers),
    );
    assert.equal(publishedFields(packet)[0].kind.key, '020_4_0_kwh_total');
  }
  // A packet as given to kindOf: its address, else its id.
  assert.deepEqual(addressOfPacket({ id: '00_0010_7E31_0100' }), addressOfId('00_0010_7E31_0100'));
  assert.equal(addressOfPacket({ id: 'x' }), undefined);
  assert.equal(addressOfPacket(undefined), undefined);
});

test('DeltaSol MX [HQM #1] in French: the monthly counter published at the change of month', async () => {
  const HQM1 = {
    id: '00_0010_7E31_0100',
    source: 'DeltaSol MX [HQM #1]',
    fields: [
      { id: '000_4_0', name: 'Quantité de chaleur', unit: 'WattHours', value: 7_000_000 },
      { id: '020_4_0', name: 'Quantité de chaleur', unit: 'WattHours', value: 150_000 },
    ],
  };
  let month = 150_000;
  const { app, gladys, advance } = await setup({
    devices: [created({ packet: HQM1 })],
    script: () =>
      answer({
        packets: [{ ...HQM1, fields: [HQM1.fields[0], { ...HQM1.fields[1], value: month }] }],
      }),
  });
  const F = (key) => `ext:resol:resol:${SERIAL}_${HQM1.id.toLowerCase()}:${key}`;
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('020_4_0_kwh')), 150);
  assert.equal(gladys.fake.lastState(F('000_4_0_kwh_total')), 7000);
  month = 3_000;
  await advance(POLL + 5000);
  assert.equal(gladys.fake.lastState(F('020_4_0_kwh')), 3, 'not held: a counter of a month');
  assert.equal(gladys.fake.lastState(F('020_4_0_kwh_total')), undefined);
  await app.stop();
});

const packet = (id, fields) => ({
  id,
  fields: fields.map(([fid, name, unitCode, value]) => ({
    id: fid,
    name,
    unitCode,
    unitText: '',
    value,
  })),
});

test('a lower piece at 1000 or more: the same counter in two units, published apart', () => {
  // 0x105b: "kWh" and "MWh", 4 bytes each.
  const pieces = (kwh) =>
    packet('00_0010_105B_0100', [
      ['016_4_0', 'kWh', 'KilowattHours', kwh],
      ['020_4_0', 'MWh', 'MegawattHours', 1],
    ]);
  assert.deepEqual(
    publishedFields(pieces(999)).map((e) => e.kind.key),
    ['016_4_0_sum_kwh_total'],
  );
  assert.equal(joinedFields(pieces(999))[0].value, 1999);
  const apart = publishedFields(pieces(1000));
  assert.deepEqual(
    apart.map((e) => e.kind.key),
    ['016_4_0_kwh_total', '020_4_0_kwh_total'],
  );
  // 0x7774: "Current1" in Wh and in kWh, the same counter.
  const current = packet('00_0010_7774_0100', [
    ['072_4_0', 'Current1', 'WattHours', 12_500_000],
    ['076_4_0', 'Current1', 'KilowattHours', 12_500],
  ]);
  assert.deepEqual(
    joinedFields(current).map((f) => [f.id, f.value]),
    [
      ['072_4_0', 12_500_000],
      ['076_4_0', 12_500],
    ],
  );
  // The highest piece may read 1000 or more (1200 MWh): still pieces.
  const big = packet('00_0010_3011_0100', [
    ['028_2_0', 'Heat quantity kWh', 'KilowattHours', 5],
    ['030_2_0', 'Heat quantity MWh', 'KilowattHours', 1200],
  ]);
  assert.equal(joinedFields(big)[0].value, 1_200_005);
  // Apart, a named piece takes the unit of its name (the VSF gives the MWh one the code kWh).
  const broken = packet('00_0010_3011_0100', [
    ['028_2_0', 'Heat quantity kWh', 'KilowattHours', 1000],
    ['030_2_0', 'Heat quantity MWh', 'KilowattHours', 5],
  ]);
  const out = publishedFields(broken).map(({ field, kind }) => [
    kind.key,
    kind.convert(field.value),
  ]);
  assert.deepEqual(out, [
    ['028_2_0_kwh_total', 1000],
    ['030_2_0_kwh_total', 5000],
  ]);
  // An unknown lower piece: still pieces, the sum unknown.
  assert.equal(joinedFields(pieces(undefined))[0].value, undefined);
});
