// -----------------------------------------------------------------------------
// The answers of the device read strictly (src/resol/model.js) and what they
// become in Gladys (src/devices.js): units, bounds, lifetime and period
// counters, names of the device, ids; the rules of the core for
// `supported_options` applied to everything published.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MAX_FIELDS, MAX_HEADERS } from '../src/constants.js';
import {
  UNITS,
  buildDevice,
  isPeriodic,
  kindOf,
  publishedFields,
  valueOf,
} from '../src/devices.js';
import { cleanText, parseInfo, parseLive } from '../src/resol/model.js';
import { DELTASOL, SERIAL, deltasol, infoText, liveData } from './helpers/fixtures.js';

const gladys = createFakeGladys({ selector: 'resol' });

test('parseInfo: product and serial lower-cased; without them, not a RESOL data logger', () => {
  assert.deepEqual(parseInfo(infoText({ product: 'DL3', version: '2.2.1' })), {
    vendor: 'RESOL',
    product: 'dl3',
    serial: SERIAL,
    version: '2.2.1',
    build: '201311280853',
    name: `DL3-${SERIAL.toUpperCase()}`,
    features: 'vbus,dl2',
  });
  assert.equal(parseInfo('vendor = "RESOL"\nproduct = "DL2"'), undefined, 'no serial');
  assert.equal(parseInfo(infoText({ serial: '../x' })), undefined);
  assert.equal(parseInfo(infoText({ product: 'DL 2' })), undefined);
  assert.equal(parseInfo('<html></html>'), undefined);
  assert.equal(parseInfo(undefined), undefined);
});

test('parseLive: the packets, their fields and values, by header_index and field_index', () => {
  const live = parseLive(liveData({ at: 1_800_000_000 }));
  assert.equal(live.at, 1_800_000_000_000);
  const [packet] = live.packets;
  assert.equal(packet.id, '00_0010_7e11_0100');
  assert.equal(packet.source, 'DeltaSol MX [Regler]');
  assert.equal(packet.destination, 'DFA');
  assert.equal(packet.at, 1_800_000_000_000);
  assert.equal(packet.fields.length, DELTASOL.fields.length);
  assert.deepEqual(packet.fields[0], {
    id: '000_2_0',
    name: 'Temperature sensor 1',
    unitCode: 'DegreesCelsius',
    unitText: '°C',
    value: 62.4,
  });
  // Values in another order: matched by their indexes, never by position.
  const data = liveData();
  data.headersets[0].packets[0].field_values.reverse();
  assert.equal(parseLive(data).packets[0].fields[0].value, 62.4);
  // Without indexes: by position (the format of hass-Deltasol-KM2).
  const bare = liveData();
  for (const fv of bare.headersets[0].packets[0].field_values) delete fv.field_index;
  delete bare.headersets[0].packets[0].header_index;
  assert.equal(parseLive(bare).packets[0].fields[1].value, 45.1);
});

test('parseLive: a missing value (raw 0, empty text), a text, a non-number are unknown', () => {
  const data = liveData({ packets: [deltasol({ '000_2_0': null })] });
  const values = data.headersets[0].packets[0].field_values;
  values[1].raw_value = '45.1';
  values[3].raw_value = Number.NaN;
  values[4].value = '   ';
  const [packet] = parseLive(data).packets;
  assert.equal(packet.fields[0].value, undefined, 'raw 0 with an empty text');
  assert.equal(packet.fields[1].value, undefined, 'a string is no number');
  assert.equal(packet.fields[3].value, undefined);
  assert.equal(packet.fields[4].value, undefined);
  assert.equal(packet.fields[2].value, 888.8, 'kept here, refused by its bounds later');
});

test('parseLive: not the format, or hostile: undefined or bounded, no prototype pollution', () => {
  assert.equal(parseLive(null), undefined);
  assert.equal(parseLive({ headers: {}, headersets: [] }), undefined);
  assert.equal(parseLive([]), undefined);
  const many = liveData({
    packets: Array.from({ length: MAX_HEADERS + 10 }, (_, i) => ({
      ...DELTASOL,
      id: `00_0010_${String(i).padStart(4, '0')}_0100`,
    })),
  });
  assert.equal(parseLive(many).packets.length, MAX_HEADERS);
  const wide = liveData({
    packets: [
      {
        ...DELTASOL,
        fields: Array.from({ length: MAX_FIELDS + 50 }, (_, i) => ({
          id: `${String(i).padStart(3, '0')}_2_0`,
          name: `T${i}`,
          unit: 'DegreesCelsius',
          value: 20,
        })),
      },
    ],
  });
  assert.equal(parseLive(wide).packets[0].fields.length, MAX_FIELDS);
  const evil = liveData();
  evil.headers[0].fields.push({ id: '__proto__', name: 'x', unit_code: 'Watts' });
  evil.headers[0].fields.push({ id: '../etc', name: 'x', unit_code: 'Watts' });
  evil.headers[0].fields.push({ id: '000_2_0', name: 'dup', unit_code: 'Watts' });
  evil.headers.push({ ...evil.headers[0], id: 'a:b' });
  const parsed = parseLive(evil);
  assert.equal(parsed.packets.length, 1);
  assert.deepEqual(
    parsed.packets[0].fields.map((f) => f.id).filter((id) => !/^\d{3}_\d_0$/.test(id)),
    ['__proto__'],
  );
  assert.equal({}.polluted, undefined);
});

test('cleanText: no control character, spaces collapsed, bounded', () => {
  assert.equal(cleanText('  Temp\u0000 \nsensor  1 '), 'Temp sensor 1');
  assert.equal(cleanText('x'.repeat(200)).length, 80);
  assert.equal(cleanText(42), '');
});

test('units: °C typed with bounds (888.8 is an open line), the rest plain with the unit in the name', () => {
  const [packet] = parseLive(liveData()).packets;
  const byId = Object.fromEntries(publishedFields(packet).map((e) => [e.field.id, e]));
  assert.equal(byId['040_4_0'], undefined, 'no unit: not published');
  const t3 = byId['004_2_0'];
  assert.equal(valueOf(t3.field, t3.kind), undefined);
  assert.equal(valueOf({ value: -888.8 }, t3.kind), undefined);
  assert.equal(valueOf({ value: 0 }, t3.kind), 0, '0 °C is a temperature');
  const f = kindOf({ id: 'x', name: 'T', unitCode: 'DegreesFahrenheit' });
  assert.equal(valueOf({ value: 212 }, f), 100);
  assert.equal(valueOf({ value: 1631.84 }, f), undefined, '888.8 °C in °F');
  const gal = kindOf({ id: 'x', name: 'Flow', unitCode: 'GallonsPerHour' });
  assert.equal(valueOf({ value: 1 }, gal), 3.8);
  assert.equal(kindOf({ id: 'x', name: 'CO2', unitCode: 'KilogramsCO2Gas' }), undefined);
  assert.equal(kindOf({ id: 'x', name: 'Y', unitCode: 'Unknown' }), undefined);
  // No unit code (an older firmware): the unit text.
  assert.equal(kindOf({ id: 'x', name: 'T', unitCode: '', unitText: '°C' }).key, 'x_c');
  assert.equal(kindOf({ id: 'x', name: 'Q', unitCode: '', unitText: 'Wh' }).counter, 'energy');
  assert.equal(kindOf({ id: 'x', name: 'Q', unitCode: '', unitText: '' }), undefined);
});

test('energy and hours: lifetime counters in kWh / h, those of a period plain', () => {
  const heat = kindOf({ id: '020_4_0', name: 'Heat quantity', unitCode: 'WattHours' });
  assert.equal(heat.counter, 'energy');
  assert.equal(heat.key, '020_4_0_kwh_total');
  assert.equal(valueOf({ value: 4_567_890 }, heat), 4567.89);
  const mwh = kindOf({ id: 'a', name: 'Wärmemenge', unitCode: 'MegawattHours' });
  assert.equal(valueOf({ value: 1.5 }, mwh), 1500);
  const hours = kindOf({ id: '010_4_0', name: 'Betriebsstunden Relais 1', unitCode: 'Hours' });
  assert.equal(hours.counter, 'hours');
  assert.equal(hours.key, '010_4_0_h_total');
  for (const name of [
    'Heat quantity today',
    'Heat quantity week',
    'Heat quantity month',
    'Wärmemenge heute',
    'Wärmemenge Woche',
    'Wärmemenge Monat',
    'Quantité de chaleur aujourd’hui',
    'Quantité de chaleur semaine',
    'Energia oggi',
    'Warmtehoeveelheid vandaag',
    'Energía año',
  ]) {
    assert.ok(isPeriodic(name), name);
    const kind = kindOf({ id: 'x', name, unitCode: 'WattHours' });
    assert.equal(kind.counter, undefined, name);
    assert.equal(kind.key, 'x_kwh');
  }
  for (const name of ['Heat quantity', 'Wärmemenge', 'Operating hours relay 1', 'Solar yield']) {
    assert.ok(!isPeriodic(name), name);
  }
});

test('every unit listed has a key, bounds or a counter, digits; keys never collide', () => {
  for (const [code, unit] of Object.entries(UNITS)) {
    assert.match(unit.key, /^[a-z0-9]{1,12}$/, code);
    assert.ok(unit.text.length > 0, code);
    if (!unit.energy && !unit.hours) {
      assert.ok(unit.min < unit.max && Number.isInteger(unit.digits), code);
      assert.ok(unit.spec || unit.label, code);
    }
  }
});

// The core's rules for `supported_options` (server/utils/normalizeSupportedOptions.js),
// copied so that GitHub CI, which has no Gladys clone, applies them too. The core
// refuses the WHOLE publication when one option breaks them; the SDK's fake Gladys
// never checks them.
const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;
const OPTION_KEYS = ['id', 'value', 'label', 'sort_order'];
function checkOptions(options, where, allowStringValues) {
  assert.ok(Array.isArray(options) && options.length > 0, `${where}: options`);
  for (const [i, option] of options.entries()) {
    const at = `${where}[${i}]`;
    assert.equal(typeof option.label, 'string', `${at}.label must be a string`);
    assert.ok(option.label.trim().length > 0, `${at}.label is blank`);
    assert.equal(option.label, option.label.trim(), `${at}.label has surrounding whitespace`);
    assert.ok(
      Number.isInteger(option.value) ||
        (allowStringValues && typeof option.value === 'string' && option.value.trim() !== ''),
      `${at}.value`,
    );
    assert.deepEqual(
      Object.keys(option).filter((k) => !OPTION_KEYS.includes(k)),
      [],
      `${at}: unknown key`,
    );
  }
  const values = options.map((o) => `${o.value}`);
  assert.equal(new Set(values).size, values.length, `${where}: duplicate values`);
  if (normalizeSupportedOptions) {
    assert.doesNotThrow(() => normalizeSupportedOptions(options, { allowStringValues }), where);
  }
}

test('supported_options: the rules of the core applied to every feature published (none has any)', () => {
  // The checker catches what the core refuses.
  assert.throws(() => checkOptions([{ value: 1, label: { en: 'x' } }], 'x', false));
  assert.throws(() => checkOptions([{ value: 1, label: ' x' }], 'x', false));
  assert.throws(() =>
    checkOptions(
      [
        { value: 1, label: 'a' },
        { value: 1, label: 'b' },
      ],
      'x',
      false,
    ),
  );
  const [packet] = parseLive(liveData()).packets;
  const device = buildDevice(gladys, { serial: SERIAL, packetId: packet.id, packet });
  let lists = 0;
  for (const feature of device.features) {
    if (feature.supported_options === undefined) continue;
    lists += 1;
    checkOptions(
      feature.supported_options,
      feature.external_id,
      feature.category === C.TEXT && feature.type === DEVICE_FEATURE_TYPES.TEXT.SELECT,
    );
  }
  assert.equal(lists, 0, 'read-only sensors: no select');
});

test('the device: ids of the serial and the packet, features read-only, units of the core', () => {
  const [packet] = parseLive(liveData()).packets;
  const device = buildDevice(gladys, {
    serial: SERIAL,
    packetId: packet.id,
    name: 'RESOL DeltaSol MX [Regler]',
    info: { product: 'dl2', version: '2.1.0', address: '192.168.1.70:80' },
    packet,
  });
  assert.equal(device.external_id, `ext:resol:resol:${SERIAL}_00_0010_7e11_0100`);
  assert.deepEqual(
    device.params.map((p) => p.name),
    ['RESOL_SERIAL', 'RESOL_PACKET', 'RESOL_PRODUCT', 'RESOL_VERSION', 'RESOL_ADDRESS'],
  );
  const allowed = {
    [C.TEMPERATURE_SENSOR]: [U.CELSIUS],
    [C.PRESSURE_SENSOR]: [U.BAR, U.HECTO_PASCAL, U.PSI],
    [C.UNKNOWN]: [undefined],
  };
  const ids = new Set();
  for (const f of device.features) {
    assert.ok(allowed[f.category]?.includes(f.unit), `${f.external_id}: ${f.category} ${f.unit}`);
    assert.equal(f.read_only, true);
    assert.equal(f.has_feedback, false);
    assert.ok(f.min < f.max);
    assert.ok(!ids.has(f.external_id));
    ids.add(f.external_id);
    assert.doesNotMatch(f.external_id.split(':').at(-1), /[.:]/);
  }
  const heat = device.features.find((f) => f.external_id.endsWith(':020_4_0_kwh_total'));
  assert.equal(heat.name, 'Heat quantity (kWh, lifetime)');
  assert.equal(heat.category, C.UNKNOWN, 'heat is never an energy of the energy monitoring');
  const t1 = device.features.find((f) => f.external_id.endsWith(':000_2_0_c'));
  assert.equal(t1.name, 'Temperature sensor 1');
  assert.equal(t1.category, C.TEMPERATURE_SENSOR);
  // A created device published again without a read keeps every feature.
  const again = buildDevice(gladys, { serial: SERIAL, packetId: packet.id, created: device });
  assert.deepEqual(
    again.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
  assert.equal(again.name, 'RESOL DeltaSol MX [Regler]');
});
