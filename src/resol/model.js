// -----------------------------------------------------------------------------
// The answers of a RESOL KM2 / DL2 / DL2Plus / DL3, read strictly. Pure.
//
// - get_resol_device_information: `key = "value"` lines (vendor, product,
//   serial, version, build, name, features), as hass-Deltasol-KM2 reads them;
// - the live data (DL2 / DL3 /dlx/download/live, KM2 dataGetCurrentData): the
//   DLx JSON format documented by RESOL and by resol-vbus
//   (docs/dlx-data-download-api.md): `headers` (one per VBus packet: its id,
//   source and destination devices, its `fields` with id, name and unit) and
//   `headersets[].packets[]` (`header_index`, `timestamp`, `field_values[]`
//   with `field_index`, `raw_value` and the text `value`).
//
// The names of the values are those of the device (its VBus specification
// file, VSF, in its language): never guessed here, only cleaned (no control
// character, 80 characters at most). A value is a number only when
// `raw_value` is a finite number AND its text `value`, when the device gives
// one, is not empty: resol-vbus writes a missing value as raw 0 with an empty
// text, which must never become a measure 0. Everything is bounded: packets,
// fields per packet, fields in all.
// -----------------------------------------------------------------------------

import { MAX_FIELDS, MAX_HEADERS, MAX_TOTAL_FIELDS } from '../constants.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** A text of the device, cleaned: no control character, spaces collapsed, `max` characters. */
export function cleanText(raw, max = 80) {
  if (typeof raw !== 'string') return '';
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, max).join('').trim();
}

const INFO_KEYS = ['vendor', 'product', 'serial', 'version', 'build', 'name', 'features'];

/**
 * get_resol_device_information -> `{ vendor, product, serial, version, build,
 * name, features }` (product and serial lower-cased), or undefined when the
 * product or the serial is missing or not of the expected form.
 */
export function parseInfo(text) {
  if (typeof text !== 'string') return undefined;
  const found = Object.create(null);
  for (const line of text.split(/\r?\n/).slice(0, 100)) {
    const match = /^\s*([a-z_]{1,20})\s*=\s*"([^"]{0,200})"\s*$/i.exec(line);
    if (match && INFO_KEYS.includes(match[1].toLowerCase()) && !(match[1] in found)) {
      found[match[1].toLowerCase()] = match[2];
    }
  }
  const product = String(found.product ?? '')
    .trim()
    .toLowerCase();
  const serial = String(found.serial ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(product) || !/^[0-9a-z]{4,32}$/.test(serial)) {
    return undefined;
  }
  const short = (key, max = 40) => cleanText(found[key], max) || undefined;
  return {
    vendor: short('vendor'),
    product,
    serial,
    version: short('version'),
    build: short('build'),
    name: short('name', 64),
    features: short('features', 64),
  };
}

/** A packet (header) id: letters, digits and _ (e.g. 00_0010_7E11_0100), lower-cased. */
const HEADER_ID = /^[0-9a-z_]{1,48}$/i;
/** A field id (e.g. 000_2_0), lower-cased. */
const FIELD_ID = /^[0-9a-z_]{1,32}$/i;

/** An index of a list: an integer from 0, else the fallback (the position). */
const indexOf = (raw, fallback) => (Number.isInteger(raw) && raw >= 0 ? raw : fallback);

/**
 * The live data -> `{ at, packets }`, or undefined when it is not the DLx
 * format. `at`: the time stamp of the answer (ms, clock of the device), when
 * given. `packets`: `[{ id, source, destination, description, at, fields }]`,
 * `fields`: `[{ id, name, unitCode, unitText, value }]`, `value` a finite
 * number or undefined (unknown).
 */
export function parseLive(data) {
  if (!isObject(data) || !Array.isArray(data.headers) || !Array.isArray(data.headersets)) {
    return undefined;
  }
  // The most recent header set (the live data holds one).
  let headerset;
  for (const set of data.headersets.slice(0, 16)) {
    if (!isObject(set) || !Array.isArray(set.packets)) continue;
    if (!headerset || (isNumber(set.timestamp) && !(set.timestamp <= headerset.timestamp))) {
      headerset = set;
    }
  }
  const packets = [];
  const byIndex = new Map();
  const seen = new Set();
  let total = 0;
  for (const [index, header] of data.headers.slice(0, MAX_HEADERS).entries()) {
    if (!isObject(header) || typeof header.id !== 'string' || !HEADER_ID.test(header.id)) continue;
    const id = header.id.toLowerCase();
    if (seen.has(id) || !Array.isArray(header.fields)) continue;
    seen.add(id);
    const fields = [];
    const fieldIds = new Set();
    for (const field of header.fields.slice(0, MAX_FIELDS)) {
      if (total >= MAX_TOTAL_FIELDS) break;
      total += 1;
      if (!isObject(field) || typeof field.id !== 'string' || !FIELD_ID.test(field.id)) {
        fields.push(undefined);
        continue;
      }
      const fieldId = field.id.toLowerCase();
      if (fieldIds.has(fieldId)) {
        fields.push(undefined);
        continue;
      }
      fieldIds.add(fieldId);
      fields.push({
        id: fieldId,
        name: cleanText(field.name) || `Value ${fieldId}`,
        unitCode: typeof field.unit_code === 'string' ? field.unit_code.trim().slice(0, 64) : '',
        unitText: cleanText(field.unit, 16),
        value: undefined,
      });
    }
    const packet = {
      id,
      source: cleanText(header.source_name, 60),
      destination: cleanText(header.destination_name, 60),
      description: cleanText(header.description, 80),
      at: undefined,
      fields,
    };
    packets.push(packet);
    byIndex.set(index, packet);
  }
  for (const [position, raw] of (headerset?.packets ?? []).slice(0, MAX_HEADERS).entries()) {
    if (!isObject(raw)) continue;
    const packet = byIndex.get(indexOf(raw.header_index, position));
    if (!packet || packet.filled) continue;
    packet.filled = true;
    if (isNumber(raw.timestamp) && raw.timestamp > 0) packet.at = raw.timestamp * 1000;
    const values = Array.isArray(raw.field_values) ? raw.field_values.slice(0, MAX_FIELDS) : [];
    for (const [i, fv] of values.entries()) {
      if (!isObject(fv)) continue;
      const field = packet.fields[indexOf(fv.field_index, i)];
      if (!field || field.value !== undefined) continue;
      const text = fv.value;
      // An empty text is a missing value (written as raw 0 by resol-vbus).
      if (typeof text === 'string' && text.trim() === '') continue;
      if (isNumber(fv.raw_value)) field.value = fv.raw_value;
    }
  }
  for (const packet of packets) {
    delete packet.filled;
    packet.fields = packet.fields.filter(Boolean);
  }
  return {
    at:
      isNumber(headerset?.timestamp) && headerset.timestamp > 0
        ? headerset.timestamp * 1000
        : undefined,
    packets,
  };
}
