// -----------------------------------------------------------------------------
// The Gladys devices of a RESOL system and their states. Pure.
//
// One device per VBus packet of the live data (in practice one per controller
// or module on the bus: DeltaSol, heat meter, data logger inputs), as
// hass-Deltasol-KM2 groups them. External id (forever):
// `resol:<serial>_<packet id>` (src/constants.js), the serial number of the
// KM2 / DL2 / DL3 and the packet id, lower-cased. Feature key (forever):
// `<field id>_<unit key>`: the field id of the packet and the kind of value
// (UNITS below), so that a value whose unit or kind changed (a new VSF) is
// another feature, never a history mixing two units.
//
// Names: those of the device (its VSF, its language), never guessed; the unit
// is added to the name of a plain sensor.
//
// Energy rules of the Gladys core and of this project:
// - the heat quantities of a solar or heating controller are HEAT, not
//   electricity: never an `energy-sensor` nor an index of the energy
//   monitoring (they would be counted as electricity consumed or produced);
//   they are plain sensors in kWh, the unit in the name;
// - every lifetime counter (energy, operating hours) goes through the guard
//   (src/guard.js, src/app.js): never 0, never a drop nor a jump without the
//   user; the counters of a period (today, week, month, year: they return to
//   0 by design) are plain sensors, recognized by their name in the languages
//   of the VSF (PERIODIC below), a name not recognized being taken as a
//   lifetime counter (held at its reset, never published as a drop);
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C for temperature-sensor, bar, hPa
//   and psi for pressure-sensor, none for unknown (the unit is in the name).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { COUNTER_MAX, EXTERNAL_ID_TYPE, MAX_FEATURES } from './constants.js';

/** The external ids of the VBus packet `packetId` of the device `serial`. */
export const ids = (gladys, serial, packetId) =>
  gladys.externalIds(EXTERNAL_ID_TYPE, `${serial}_${packetId}`);

const temperature = { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, unit: U.CELSIUS };
const pressure = (unit) => ({ category: C.PRESSURE_SENSOR, type: T.SENSOR.DECIMAL, unit });

/**
 * The units read, by the VBus unit code (resol-vbus specification), with the
 * text the data loggers show as a fallback when no unit code is given:
 * `key` (forever, in the feature key), `factor` to the unit published,
 * `offset` (°F), `label` (in the name of a plain sensor), `spec` (category,
 * type, unit of a typed sensor), `min`/`max` (a value outside is no measure:
 * 888.8 °C is an open sensor line, -888.8 °C a short circuit), `digits`, and
 * `counter`: 'energy' or 'hours' for a lifetime counter. A unit not listed
 * here (none, CO₂ savings, unknown) is not published.
 */
export const UNITS = {
  DegreesCelsius: { key: 'c', text: ['°C'], spec: temperature, min: -60, max: 300, digits: 1 },
  DegreesFahrenheit: {
    key: 'f2c',
    text: ['°F'],
    spec: temperature,
    factor: 5 / 9,
    offset: -32,
    min: -60,
    max: 300,
    digits: 2,
  },
  DegreesKelvin: { key: 'k', text: ['K'], label: 'K', min: -400, max: 400, digits: 1 },
  Bars: { key: 'bar', text: ['bar'], spec: pressure(U.BAR), min: 0, max: 100, digits: 2 },
  Hectopascals: {
    key: 'hpa',
    text: ['hPa'],
    spec: pressure(U.HECTO_PASCAL),
    min: 0,
    max: 2000,
    digits: 1,
  },
  PoundsForcePerSquareInch: {
    key: 'psi',
    text: ['psi'],
    spec: pressure(U.PSI),
    min: 0,
    max: 1500,
    digits: 1,
  },
  Percent: { key: 'pct', text: ['%'], label: '%', min: 0, max: 100, digits: 1 },
  Watts: { key: 'w', text: ['W'], label: 'W', min: -1e7, max: 1e7, digits: 0 },
  Kilowatts: { key: 'kw', text: ['kW'], label: 'kW', min: -1e4, max: 1e4, digits: 3 },
  WattHours: { key: 'kwh', text: ['Wh'], factor: 1 / 1000, energy: true },
  KilowattHours: { key: 'kwh', text: ['kWh'], factor: 1, energy: true },
  MegawattHours: { key: 'kwh', text: ['MWh'], factor: 1000, energy: true },
  Btus: { key: 'kwh', text: ['BTU'], factor: 0.00029307107017, energy: true },
  KiloBtus: { key: 'kwh', text: ['MBTU'], factor: 0.29307107017, energy: true },
  MegaBtus: { key: 'kwh', text: ['MMBTU'], factor: 293.07107017, energy: true },
  Hours: { key: 'h', text: ['h'], factor: 1, hours: true },
  LitersPerHour: { key: 'lh', text: ['l/h'], label: 'l/h', min: 0, max: 1e6, digits: 1 },
  LitersPerMinute: { key: 'lmin', text: ['l/min'], label: 'l/min', min: 0, max: 1e5, digits: 2 },
  CubicMetersPerHour: { key: 'm3h', text: ['m³/h'], label: 'm³/h', min: 0, max: 1e4, digits: 3 },
  GallonsPerHour: {
    key: 'galh2lh',
    text: ['gal/h'],
    label: 'l/h',
    factor: 3.785411784,
    min: 0,
    max: 1e6,
    digits: 1,
  },
  GallonsPerMinute: {
    key: 'galmin2lmin',
    text: ['gal/min'],
    label: 'l/min',
    factor: 3.785411784,
    min: 0,
    max: 1e5,
    digits: 2,
  },
  Liters: { key: 'l', text: ['l'], label: 'l', min: 0, max: 1e9, digits: 1 },
  CubicMeters: { key: 'm3', text: ['m³'], label: 'm³', min: 0, max: 1e7, digits: 3 },
  Gallons: {
    key: 'gal2l',
    text: ['gal'],
    label: 'l',
    factor: 3.785411784,
    min: 0,
    max: 1e9,
    digits: 1,
  },
  Volts: { key: 'v', text: ['V'], label: 'V', min: -1000, max: 1000, digits: 2 },
  Milliamperes: { key: 'ma', text: ['mA'], label: 'mA', min: -1000, max: 1000, digits: 2 },
  Ohms: { key: 'ohm', text: ['Ω', 'Ohm'], label: 'Ω', min: 0, max: 1e7, digits: 1 },
  Hertz: { key: 'hz', text: ['Hz'], label: 'Hz', min: 0, max: 1e5, digits: 1 },
  MetersPerSecond: { key: 'ms', text: ['m/s'], label: 'm/s', min: 0, max: 200, digits: 2 },
  WattsPerSquareMeter: { key: 'wm2', text: ['W/m²'], label: 'W/m²', min: 0, max: 2000, digits: 0 },
  Seconds: { key: 's', text: ['s'], label: 's', min: 0, max: 1e9, digits: 0 },
  Minutes: { key: 'min', text: ['min'], label: 'min', min: 0, max: 1e8, digits: 0 },
  Days: { key: 'd', text: ['d'], label: 'd', min: 0, max: 1e6, digits: 0 },
  KilogramsPerHour: { key: 'kgh', text: ['kg/h'], label: 'kg/h', min: 0, max: 1e6, digits: 1 },
  KilogramsPerCubicMeter: {
    key: 'kgm3',
    text: ['kg/m³'],
    label: 'kg/m³',
    min: 0,
    max: 1e5,
    digits: 1,
  },
  SquareMeters: { key: 'm2', text: ['m²'], label: 'm²', min: 0, max: 1e5, digits: 2 },
  DegreesAngular: { key: 'deg', text: ['°'], label: '°', min: -360, max: 360, digits: 1 },
};

/** The unit of a field: by its code, else by its text; undefined when not published. */
export function unitOf(field) {
  if (field.unitCode && Object.hasOwn(UNITS, field.unitCode)) return UNITS[field.unitCode];
  if (field.unitCode) return undefined;
  const text = field.unitText;
  if (!text) return undefined;
  return Object.values(UNITS).find((u) => u.text.includes(text));
}

/**
 * The words of a counter of a period (it returns to 0 by design), in the
 * languages of the VBus specification (en, de, fr, it, nl, es): today,
 * yesterday, day, week, month, year...
 */
const PERIODIC =
  /\b(today|yesterday|daily|day|week(ly)?|month(ly)?|year(ly)?|heute|gestern|tag(es)?|woche|monat|jahr(es)?|aujourd|hier|jour(nali[eè]re)?|semaine|mois|ann[ée]e|oggi|ieri|giorno|settimana|mese|anno|vandaag|gisteren|dag|maand|jaar|hoy|ayer|d[ií]a|semana|mes|a[ñn]o)\b/iu;

export const isPeriodic = (name) => PERIODIC.test(String(name ?? '').normalize('NFC'));

/**
 * What a field of the live data becomes: `{ key, counter, spec, min, max,
 * digits, convert }`, `counter` 'energy' | 'hours' | undefined, or undefined
 * when it is not published (no unit, a unit not listed).
 */
export function kindOf(field) {
  const unit = unitOf(field);
  if (!unit) return undefined;
  const factor = unit.factor ?? 1;
  const offset = unit.offset ?? 0;
  const convert = (value) => (value + offset) * factor;
  if (unit.energy || unit.hours) {
    const periodic = isPeriodic(field.name);
    const label = unit.energy ? 'kWh' : 'h';
    return {
      key: `${field.id}_${unit.key}${periodic ? '' : '_total'}`,
      counter: periodic ? undefined : unit.energy ? 'energy' : 'hours',
      label: periodic ? label : unit.energy ? 'kWh, lifetime' : 'h, lifetime',
      min: 0,
      max: COUNTER_MAX,
      digits: unit.energy ? 3 : 2,
      convert,
    };
  }
  return {
    key: `${field.id}_${unit.key}`,
    spec: unit.spec,
    label: unit.label,
    min: unit.min,
    max: unit.max,
    digits: unit.digits,
    convert,
  };
}

/** The feature of a field (`kind`: kindOf). */
export function featureOf(external, field, kind) {
  const spec = kind.spec ?? { category: C.UNKNOWN, type: T.SENSOR.DECIMAL };
  return {
    name: kind.spec ? field.name : cleanName(`${field.name} (${kind.label})`),
    external_id: external.feature(kind.key),
    ...spec,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: kind.min,
    max: kind.max,
  };
}

const cleanName = (name) => [...name].slice(0, 100).join('');

/** The features of a packet that are published: `[{ field, kind }]`, MAX_FEATURES at most. */
export function publishedFields(packet) {
  const out = [];
  const keys = new Set();
  for (const field of packet.fields) {
    const kind = kindOf(field);
    if (!kind || keys.has(kind.key)) continue;
    keys.add(kind.key);
    out.push({ field, kind });
    if (out.length >= MAX_FEATURES) break;
  }
  return out;
}

/** The fields kept from a created feature, when it is published again without a new read. */
const KEPT = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'read_only',
  'has_feedback',
  'keep_history',
  'min',
  'max',
];

const keptFeature = (feature) =>
  Object.fromEntries(KEPT.filter((k) => feature[k] !== undefined).map((k) => [k, feature[k]]));

/**
 * The device of a packet. `info`: the device information (src/resol/model.js
 * parseInfo) and `address`; `packet`: the packet of the last read, or
 * undefined; `created`: the device the user created, if any (its features are
 * all published again: a device never loses one, "Update" in Discovery would
 * drop its history). `name`: the name of the device.
 */
export function buildDevice(gladys, { serial, packetId, name, info = {}, packet, created }) {
  const external = ids(gladys, serial, packetId);
  const features = [];
  const seen = new Set();
  for (const { field, kind } of packet ? publishedFields(packet) : []) {
    const feature = featureOf(external, field, kind);
    seen.add(feature.external_id);
    features.push(feature);
  }
  for (const feature of created?.features ?? []) {
    if (!seen.has(feature.external_id)) {
      seen.add(feature.external_id);
      features.push(keptFeature(feature));
    }
  }
  const param = (key, value) => ({ name: key, value: String(value ?? '') });
  return {
    name: name ?? created?.name ?? `RESOL ${packetId}`,
    external_id: external.device,
    features,
    params: [
      param('RESOL_SERIAL', serial),
      param('RESOL_PACKET', packetId),
      param('RESOL_PRODUCT', info.product),
      param('RESOL_VERSION', info.version),
      param('RESOL_ADDRESS', info.address),
    ],
  };
}

export const round = (value, digits) => {
  const r = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * The value of a field to publish (`kind`: kindOf), or undefined when it is
 * no measure: unknown, outside the bounds of its unit, not finite.
 */
export function valueOf(field, kind) {
  if (typeof field.value !== 'number' || !Number.isFinite(field.value)) return undefined;
  const v = round(kind.convert(field.value), kind.digits);
  if (!Number.isFinite(v) || v < kind.min || v > kind.max) return undefined;
  return v;
}
