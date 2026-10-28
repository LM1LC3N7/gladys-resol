// -----------------------------------------------------------------------------
// The points of review r2 (_lots/lot18/reviews/resol-r2.md): the counters
// split in pieces as the VSF describes them, and the class of every field of
// the VSF the same in English, German and French (the key of a feature never
// depends on the language of the data logger).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNITS, counterOf, joinedFields, kindOf, publishedFields } from '../src/devices.js';

const FIELDS = JSON.parse(
  readFileSync(new URL('./fixtures/vsf-fields.json', import.meta.url), 'utf8'),
);

test('every counter field of the VSF: the same key and class in en, de and fr', () => {
  assert.ok(FIELDS.length > 600, `${FIELDS.length} fields`);
  for (const f of FIELDS) {
    const packetId = `00_${f.packet}`;
    const keys = ['en', 'de', 'fr'].map(
      (lang) => kindOf({ id: f.id, name: f[lang] ?? '', unitCode: f.unit }, packetId)?.key,
    );
    assert.equal(new Set(keys).size, 1, `${f.packet} ${f.id} ${f.en}: ${keys.join(' / ')}`);
    const counter = counterOf({ id: f.id, name: f.fr ?? '' }, UNITS[f.unit], packetId) ?? null;
    assert.equal(counter, f.counter, `${f.packet} ${f.id} ${f.en}`);
  }
});

test('the cases of the review: the monthly "Quantité de chaleur", "W O3", the speed steps', () => {
  const month = { id: '020_4_0', name: 'Quantité de chaleur', unitCode: 'WattHours' };
  assert.equal(kindOf(month, '00_0010_7E30_0100').key, '020_4_0_kwh', 'DeltaSol MX [HQM #0], fr');
  const total = { id: '000_4_0', name: 'Quantité de chaleur', unitCode: 'WattHours' };
  assert.equal(kindOf(total, '00_0010_7E30_0100').key, '000_4_0_kwh_total');
  const w03 = { id: '104_4_0', name: 'W O3', unitCode: 'Seconds' };
  assert.equal(kindOf(w03, '00_0010_7541_0100').key, '104_4_0_s2h_total');
  // Unknown packet: the words of the name.
  assert.equal(kindOf(w03, '00_0010_9999_0100').key, '104_4_0_s');
  for (const name of ['Runtime 1 R1', 'Laufzeit 2 R5', 'Temps de fonc. 1 R3']) {
    assert.equal(counterOf({ name, unitCode: 'Seconds' }), undefined, name);
  }
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

test('HQM-L10 (0x3011): the MWh piece carries the unit code kWh; the factor is the one of its name', () => {
  const p = packet('00_0010_3011_0100', [
    ['028_2_0', 'Heat quantity kWh', 'KilowattHours', 300],
    ['030_2_0', 'Heat quantity MWh', 'KilowattHours', 5],
  ]);
  const [joined] = joinedFields(p);
  assert.equal(joined.value, 5300);
  assert.equal(joined.name, 'Heat quantity');
  assert.deepEqual(
    publishedFields(p).map((e) => e.kind.key),
    ['028_2_0_sum_kwh_total'],
  );
});

test('Oranier HK (0x2232): three "Heat" in Wh, kWh and MWh put back together', () => {
  const p = packet('00_0010_2232_0100', [
    ['006_2_0', 'Heat', 'WattHours', 250],
    ['008_2_0', 'Heat', 'KilowattHours', 40],
    ['010_2_0', 'Heat', 'MegawattHours', 2],
  ]);
  const out = joinedFields(p);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 2040.25);
  assert.equal(out[0].name, 'Heat');
  assert.equal(publishedFields(p)[0].kind.counter, 'energy');
});

test('0x105b: "kWh" and "MWh" named after their pieces; 0x1064: dropped next to the total', () => {
  const bare = packet('00_0010_105B_0100', [
    ['016_4_0', 'kWh', 'KilowattHours', 5],
    ['020_4_0', 'MWh', 'MegawattHours', 1],
  ]);
  const [joined] = joinedFields(bare);
  assert.equal(joined.name, 'kWh + MWh');
  assert.equal(joined.value, 1005);
  const withTotal = packet('00_0010_1064_0100', [
    ['006_2_0', 'Heat Wh', 'WattHours', 1],
    ['008_2_0', 'Heat kWh', 'KilowattHours', 2],
    ['010_2_0', 'Heat MWh', 'MegawattHours', 3],
    ['006_2_0_1', 'Heat', 'WattHours', 3_002_001],
  ]);
  assert.deepEqual(
    joinedFields(withTotal).map((f) => f.id),
    ['006_2_0_1'],
  );
  // 0x7774: "Current1" in Wh and in kWh.
  const current = packet('00_0010_7774_0100', [
    ['072_4_0', 'Current1', 'WattHours', 500],
    ['076_4_0', 'Current1', 'KilowattHours', 12],
    ['080_4_0', 'Current2', 'KilowattHours', 7],
  ]);
  assert.deepEqual(
    joinedFields(current).map((f) => [f.id, f.value]),
    [
      ['072_4_0_sum', 12.5],
      ['080_4_0', 7],
    ],
  );
});

test('counterOfNames: one name of a period or a setting vetoes; seconds need one operating name', async () => {
  const { counterOfNames } = await import('../src/devices.js');
  const wh = UNITS.WattHours;
  const s = UNITS.Seconds;
  assert.equal(
    counterOfNames(['Heat quantity month', 'Wärmemenge Monat', 'Quantité de chaleur'], wh),
    undefined,
  );
  assert.equal(
    counterOfNames(['Heat quantity', 'Wärmemenge', 'Quantité de chaleur'], wh),
    'energy',
  );
  assert.equal(
    counterOfNames(
      ['W O3', 'Betriebssekunden Ausgang PWM 3', 'Secondes de fonctionnement sortie PWM 3'],
      s,
    ),
    'hours',
  );
  assert.equal(counterOfNames(['W O3', 'W O3', 'W O3'], s), undefined);
  assert.equal(counterOfNames(['Operating seconds R1', 'Mixer runtime'], s), undefined);
  assert.equal(
    counterOfNames(['Runtime 1 R1', 'Laufzeit 1 R1', 'Temps de fonc. 1 R1'], s),
    undefined,
  );
  assert.equal(counterOfNames([], wh), undefined);
});
