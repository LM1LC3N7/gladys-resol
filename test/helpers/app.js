// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a fake client (the client itself is
// tested against a fake device on 127.0.0.1 in test/client.test.js) and the
// test clock of the kit: every read of the clock moves it (1 µs), timers fire
// on `clock.advance(ms)`.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ResolApp } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { ResolError } from '../../src/resol/client.js';
import { parseInfo, parseLive } from '../../src/resol/model.js';
import { createMemoryStore } from '../../src/store.js';
import { testClock } from '../kit/clock.mjs';
import { DELTASOL, SERIAL, infoText, liveData } from './fixtures.js';

export const SELECTOR = 'resol';
export const PACKET = DELTASOL.id.toLowerCase();
export const DEVICE = `ext:${SELECTOR}:resol:${SERIAL}_${PACKET}`;
export const F = (key) => `${DEVICE}:${key}`;
export const PASSWORD = 'Sup3r-S3cret!';
export const CONFIG = { address: '192.168.1.70', username: 'admin', password: PASSWORD };
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const POLL = 60 * SECOND;
/** 2026-10-24 10:00 UTC. */
export const START = Date.UTC(2026, 9, 24, 10, 0);

/** Feature keys of the DeltaSol packet. */
export const K = {
  T1: '000_2_0_c',
  T2: '002_2_0_c',
  T3: '004_2_0_c',
  PUMP: '008_1_0_pct',
  HOURS: '010_4_0_h_total',
  HEAT: '020_4_0_kwh_total',
  HEAT_TODAY: '024_4_0_kwh',
  PRESSURE: '030_2_0_bar',
  TIMER: '044_4_0_s',
};

export function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The clock of the last setup: the time stamps of the answers follow it (a live device). */
let currentClock;

/**
 * A read answer: `{ info, data }`. `packets`/`at`: liveData (`at` by default
 * the time of the clock, as a device sending its packets); `info`: infoText
 * options.
 */
export const answer = ({ packets, at, info } = {}) => ({
  info: parseInfo(infoText(info)),
  data: liveData({ packets, at: at ?? Math.floor((currentClock?.now() ?? START) / 1000) }),
});

/** A fake client: `script(n, call)` gives each answer (or throws a ResolError). */
export function createClient(script) {
  const calls = [];
  const client = {
    calls,
    aborts: 0,
    async read(credentials) {
      calls.push({ credentials });
      return script(calls.length, { credentials });
    },
    abort() {
      client.aborts += 1;
    },
  };
  return client;
}

export const fail = (code) => {
  throw new ResolError(code);
};

/** The device of the DeltaSol packet as the user created it from the discovered one. */
export function created({ last = {}, packet = DELTASOL } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const live = parseLive(liveData({ packets: [packet] }));
  const device = buildDevice(gladys, {
    serial: SERIAL,
    packetId: packet.id.toLowerCase(),
    name: 'RESOL DeltaSol MX [Regler]',
    info: { product: 'dl2', address: '192.168.1.70:80' },
    packet: live.packets[0],
  });
  for (const [key, { value, at }] of Object.entries(last)) {
    const feature = device.features.find((f) => f.external_id === F(key));
    feature.last_value = value;
    feature.last_value_changed = new Date(at).toISOString();
  }
  return device;
}

export async function setup({
  config = CONFIG,
  script = () => answer(),
  devices = [],
  store = createMemoryStore(),
  clock = testClock({ start: START }),
  wire = true,
} = {}) {
  currentClock = clock;
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const logger = createLogger();
  const client = createClient((n, call) => script(n, call, clock));
  const app = new ResolApp({
    gladys,
    logger,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    client,
  });
  if (wire) registerHandlers(gladys, app, logger);
  /** `ms` later (timers fired on the way), every read done. */
  const advance = async (ms = POLL) => {
    await clock.advance(ms);
    await app.idle();
  };
  return { app, gladys, clock, logger, client, advance, store };
}

export const status = (gladys) => gladys.fake.connectionStatus;
export const last = (gladys, key) => gladys.fake.lastState(F(key));
export const text = (message) => `${message?.en} ${message?.fr}`;
