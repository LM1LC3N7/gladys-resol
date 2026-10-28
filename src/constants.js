// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, the external id rule, the feature keys of src/devices.js) is
// forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_counter' };

/**
 * The external id of a VBus device: `resol:<serial>_<header id>`, the serial
 * number of the KM2 / DL2 / DL2Plus / DL3 (cgi-bin/get_resol_device_information)
 * and the id of the VBus packet header (src/resol/model.js), lower-cased.
 */
export const EXTERNAL_ID_TYPE = 'resol';

// --- The HTTP API of the KM2 / DL2 / DL2Plus / DL3 ---------------------------------
export const DEFAULT_PORT = 80;
/** The products read, by the name `get_resol_device_information` gives (lower-cased). */
export const PRODUCTS = {
  km2: 'km2',
  dl2plus: 'km2',
  dl2: 'dlx',
  dl3: 'dlx',
};
export const PATHS = {
  INFO: '/cgi-bin/get_resol_device_information',
  KM2: '/cgi-bin/resol-webservice',
  DLX: '/dlx/download/live',
};
/** Each request (the device answers within a second or two on the home network). */
export const REQUEST_TIMEOUT = 10_000;
/** A whole read (information, log-in, data), whatever happens. */
export const READ_TIMEOUT = 25_000;
/** The answer of get_resol_device_information, at most. */
export const MAX_INFO_BYTES = 16 * 1024;
/** The answer of the log-in, at most. */
export const MAX_LOGIN_BYTES = 16 * 1024;
/** The live data, at most (a large DeltaSol MX system is below 300 KB). */
export const MAX_DATA_BYTES = 2 * 1024 * 1024;
/** The VBus packets (headers) of one answer, at most. */
export const MAX_HEADERS = 64;
/** The fields of one packet, at most. */
export const MAX_FIELDS = 256;
/** The fields of one answer, all packets together, at most. */
export const MAX_TOTAL_FIELDS = 4000;
/** The devices published, at most (one per VBus packet). */
export const MAX_DEVICES = 32;
/** The features of one device, at most. */
export const MAX_FEATURES = 150;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The reading interval of the form (s): 60 s by default, 60 to 900. */
export const POLL_DEFAULT = 60;
export const POLL_MIN = 60;
export const POLL_MAX = 900;
/** How often the integration looks whether a read is due (never a read by itself). */
export const TICK = 5 * SECOND;
/**
 * The instant of the last read is written to /data at most once a minute:
 * after a restart, the first read waits this long on top of the interval, so
 * that a container restarting in a loop never reads faster than the interval.
 */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** The states sent in any 60 s, at most (the core refuses a whole batch beyond 300). */
export const STATES_PER_MINUTE = 270;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** Unreachable: tried again after 1 min (never faster than a read), doubled up to 15 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 15 * MINUTE;
/** getConfig() failed: asked again after 5 s, 15 s, 30 s, then every minute, without end. */
export const CONFIG_RETRY = [5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE];
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** The second click of "Accept the held counter" counts from 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;
/** Values older than this many intervals are no longer published as current. */
export const FRESH_INTERVALS = 2;
/**
 * A VBus packet whose own time stamp has not moved for this long (on our
 * monotonic clock), or that is this much older than the answer it comes in
 * (both on the clock of the data logger), is stale: the controller no longer
 * sends it. Its values are no longer published.
 */
export const PACKET_STALE_AFTER = 15 * MINUTE;
export const PACKET_MAX_AGE = 15 * MINUTE;
export const ONE_HOUR = HOUR;

// --- Lifetime counters ------------------------------------------------------------------
/**
 * The margin of the guard of each kind of lifetime counter (src/guard.js), in
 * the unit of the counter per hour, plus a slack always accepted on top:
 * - energy (kWh): 200 kW covers the largest solar thermal systems a RESOL
 *   controller drives (about 300 m² of collectors); 2 kWh of slack covers a
 *   counter shown in whole kWh;
 * - hours (h, the operating seconds turned into hours): an hour counter runs
 *   one hour per hour at most; 2 h of slack covers a counter shown in whole
 *   hours;
 * - volumes (l, m³): 20 m³/h covers the flow of a large heat meter; 100 l
 *   (0.1 m³) of slack.
 */
export const COUNTER_LIMITS = {
  energy: { rate: 200, slack: 2 },
  hours: { rate: 1, slack: 2 },
  volume_l: { rate: 20_000, slack: 100 },
  volume_m3: { rate: 20, slack: 0.1 },
};
/** A lifetime counter above this (kWh or h) is a glitch. */
export const COUNTER_MAX = 1_000_000_000;
