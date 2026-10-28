// -----------------------------------------------------------------------------
// Answers of a RESOL device, as documented (resol-vbus,
// docs/dlx-data-download-api.md) and as the json-live-data-server of
// resol-vbus emulates a DL2 (get_resol_device_information).
// -----------------------------------------------------------------------------

export const SERIAL = '001e66000abc';

export const infoText = ({
  product = 'DL2',
  serial = SERIAL.toUpperCase(),
  version = '2.1.0',
} = {}) =>
  [
    'vendor = "RESOL"',
    `product = "${product}"`,
    `serial = "${serial}"`,
    `version = "${version}"`,
    'build = "201311280853"',
    `name = "${product}-${serial}"`,
    'features = "vbus,dl2"',
  ].join('\n');

const UNIT_TEXT = {
  DegreesCelsius: ' °C',
  WattHours: ' Wh',
  KilowattHours: ' kWh',
  Hours: ' h',
  Percent: '%',
  Bars: ' bar',
  LitersPerHour: ' l/h',
  Watts: ' W',
  Seconds: ' s',
  None: '',
};

/** The DeltaSol packet of the examples: temperatures, pump speed, hours, heat quantity. */
export const DELTASOL = {
  id: '00_0010_7E11_0100',
  source: 'DeltaSol MX [Regler]',
  fields: [
    { id: '000_2_0', name: 'Temperature sensor 1', unit: 'DegreesCelsius', value: 62.4 },
    { id: '002_2_0', name: 'Temperature sensor 2', unit: 'DegreesCelsius', value: 45.1 },
    { id: '004_2_0', name: 'Temperature sensor 3', unit: 'DegreesCelsius', value: 888.8 },
    { id: '008_1_0', name: 'Pump speed relay 1', unit: 'Percent', value: 70 },
    { id: '010_4_0', name: 'Operating hours relay 1', unit: 'Hours', value: 1234 },
    { id: '020_4_0', name: 'Heat quantity', unit: 'WattHours', value: 4_567_890 },
    { id: '024_4_0', name: 'Heat quantity today', unit: 'WattHours', value: 3_200 },
    { id: '030_2_0', name: 'System pressure', unit: 'Bars', value: 1.8 },
    { id: '040_4_0', name: 'Error mask', unit: 'None', value: 0 },
    { id: '044_4_0', name: 'Timer 1.1', unit: 'Seconds', value: 600 },
  ],
};

/**
 * A live data answer. `packets`: `[{ id, source, destination, fields:
 * [{ id, name, unit (code), value, text }], at }]`; `at`: the time stamp of
 * the answer (s). A field `value: null` is written as resol-vbus does: raw 0,
 * empty text.
 */
export function liveData({ packets = [DELTASOL], at = 1_800_000_000 } = {}) {
  return {
    language: 'en',
    headers: packets.map((p) => ({
      id: p.id,
      description: `VBus 0: ${p.source}`,
      channel: 0,
      destination_address: 16,
      source_address: 32273,
      protocol_version: 16,
      command: 256,
      info: 0,
      destination_name: p.destination ?? 'DFA',
      source_name: p.source,
      fields: p.fields.map((f) => ({
        id: f.id,
        name: f.name,
        unit: UNIT_TEXT[f.unit] ?? '',
        unit_code: f.unit,
      })),
    })),
    headerset_stats: { headerset_count: 1, min_timestamp: at, max_timestamp: at },
    headersets: [
      {
        timestamp: at,
        packets: packets.map((p, headerIndex) => ({
          header_index: headerIndex,
          timestamp: p.at ?? at,
          field_values: p.fields.map((f, fieldIndex) => ({
            field_index: fieldIndex,
            raw_value: f.value === null ? 0 : f.value,
            value: f.value === null ? '' : (f.text ?? String(f.value)),
          })),
        })),
      },
    ],
  };
}

/** The DeltaSol packet with some values changed: `{ fieldId: value }`. */
export const deltasol = (values = {}, extra = {}) => ({
  ...DELTASOL,
  ...extra,
  fields: DELTASOL.fields.map((f) => (f.id in values ? { ...f, value: values[f.id] } : f)),
});
