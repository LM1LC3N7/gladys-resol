// -----------------------------------------------------------------------------
// The integration itself: the RESOL KM2 / DL2 / DL2Plus / DL3 of the
// configuration (address, user name, password, filter), read every 60 s by
// default (device information, then the live data), its VBus devices (one per
// packet), the lifetime counters checked by their guards, the refusal of the
// log-in kept in /data, the test and accept buttons. index.js and
// src/handlers.js only wire the SDK handlers to it. (Structure of
// gladys-openems, approved in lot 17.)
//
// READ-ONLY: only the requests of src/resol/client.js (device information,
// log-in, live data); nothing of the controller is ever set (no onSetValue).
//
// Pace: nothing reads the device faster than the interval: not the timer, not
// the test button, not Discovery, not a (re)connection to Gladys, not a save
// of an unchanged configuration, not a restart of the container (the instant
// of the last read is kept in /data, written at most once a minute). A new
// address or new log-in fields may be read at once. One read at a time,
// whatever asks (a read running is never doubled); a stop cuts it.
//
// Refused (HTTP 401 / 403, or an error answered to the JSON-RPC log-in): a
// FINAL stop kept in /data, never tried again by itself; only a change of the
// form, or a click on the test button (one try per click, never faster than
// the interval), tries again; the refusal is erased only by a successful
// read. Any other failure (unreachable, no answer, odd answer, unknown
// filter, KM2 without password) is no refusal: tried again later.
//
// A read belongs to its generation (each start/stop opens a new one): a read
// that ends after a restart or a new configuration publishes nothing and sets
// no status. Identity: every read asks the serial number first; the values
// only go to the devices of that serial number (their external ids hold it).
// A VBus packet whose time stamp stopped moving for 15 min (the controller no
// longer sends it) is no longer published.
//
// Clocks: `monotonic` paces the reads, so that a wall clock set back never
// stops them. The guards of the counters run on the SESSION clock: the wall
// clock read once at the start of the process plus the monotonic time since
// (`sessionNow`), so that NTP moving the wall clock by hours never widens nor
// narrows their margin. The wall clock itself only dates what /data keeps for
// a restart. Each decision reads each clock once. A monotonic instant belongs
// to its process: none is kept in /data, a new process (a restarted
// container) starts its monotonic clock near 0, and what crosses a restart
// (the last read, the dates of the guards) is a wall date in /data, turned
// into a deadline or a date of this process when loaded; no deadline is ever
// told by its sign.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  ATTEMPT_SAVE_EVERY,
  CONFIG_RETRY,
  COUNTER_LIMITS,
  EXTERNAL_ID_TYPE,
  FRESH_INTERVALS,
  MAX_DEVICES,
  PACKET_MAX_AGE,
  PACKET_STALE_AFTER,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STATES_PER_MINUTE,
  TEST_ANSWER_WITHIN,
  TICK,
} from './constants.js';
import { buildDevice, counterKindOf, ids, publishedFields, valueOf } from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { ResolClient } from './resol/client.js';
import { cleanText, parseLive } from './resol/model.js';
import { MAX_PACKETS, createFileStore, fingerprint, readState } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const MINUTE = 60_000;

/** The value Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const raw = feature?.last_value;
  // Strict: null, '' and a boolean are unknown, never 0 nor 1.
  if (!(typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== ''))) {
    return undefined;
  }
  const value = Number(raw);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return Number.isFinite(value) && value > 0 && Number.isFinite(at) ? { value, at } : undefined;
}

/** A memory-only digest of the log-in fields (never written anywhere). */
const digestOf = ({ address, username, password }) =>
  createHash('sha256')
    .update([address, username, password].map(String).join('\u0000'))
    .digest('hex');

export class ResolApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'resol' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    client,
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    /** The session clock: wall at the start of the process + monotonic elapsed since. */
    this.wallStart = now();
    this.monoStart = monotonic();
    this.client = client ?? new ResolClient();
    this.store = store;
    this.loadStore();
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** The digest of the log-in fields of the last start (memory only). */
    this.knownDigest = undefined;
    /** Monotonic time of the last read started, in this process. */
    this.lastAttemptMono = undefined;
    /** Unreachable / odd answer: failures in a row, the monotonic time of the next try. */
    this.failures = 0;
    this.retryAtMono = undefined;
    this.lastError = undefined;
    /** The last good read: `{ info, live }`, its monotonic and wall times. */
    this.values = undefined;
    this.valuesAt = undefined;
    this.readAt = undefined;
    this.otherSerial = false;
    this.saveFailed = false;
    /** By counter feature external id: IndexGuard. */
    this.guards = new Map();
    /** The first click of "Accept the held counter": `{ at, listedAt, list }`, in memory only. */
    this.pendingAccept = undefined;
    this.publishedDevices = undefined;
    /** The states sent in the last minute: `[{ at, count }]`, monotonic (STATES_PER_MINUTE). */
    this.sent = [];
    /** By feature external id: `{ state, at }` (monotonic) last sent. */
    this.lastSent = new Map();
    /** By counter feature external id: the hold last logged (`direction:from`). */
    this.loggedHolds = new Map();
    this.timer = undefined;
    this.busy = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
    /** getConfig() in `connected`: the attempt running, its failures, its timer. */
    this.configAttempt = 0;
    this.configFailures = 0;
    this.configTimer = undefined;
  }

  /** The session clock (ms since epoch): never moved by a wall clock set by NTP. */
  sessionNow() {
    return this.wallStart + (this.monotonic() - this.monoStart);
  }

  /**
   * Reads /data. A file that cannot be read is never taken as empty: nothing
   * is written over it (saveState) and no counter is published until a later
   * start reads it.
   */
  loadStore() {
    const loaded = this.store.load();
    this.storeUnreadable = Boolean(loaded?.unreadable);
    if (this.storeUnreadable) {
      this.logger.warn('RESOL: the state file in /data cannot be read: left as it is');
    }
    /** What /data keeps (src/store.js readState). */
    this.kept = readState(loaded?.data, this.now());
    /** The instant of the last read as written in /data (written at most once a minute). */
    this.savedAttemptAt = this.kept.lastAttemptAt;
    /**
     * After a restart of the container: the first read waits the interval and
     * the minute the last read may have come after the one written.
     * `restartMono` is the monotonic deadline of that minute, taken once here
     * on THIS process's clock; often below 0 (a new process starts its
     * monotonic clock near 0): a plain number, never tested by its sign;
     * `undefined` is "no wait".
     */
    const mono = this.monotonic();
    const now = this.now();
    this.restartMono =
      this.kept.lastAttemptAt > 0
        ? mono - Math.max(0, now - this.kept.lastAttemptAt) + ATTEMPT_SAVE_EVERY
        : undefined;
    // The packets seen before the restart: when their time stamp last moved,
    // on this process's clock (a frozen packet stays stale after a restart).
    this.packetSeen = new Map(
      Object.entries(this.kept.packets).map(([key, { at, changedAt }]) => [
        key,
        { at, mono: mono - Math.max(0, now - changedAt) },
      ]),
    );
  }

  /** Wall minus session clock, now: /data keeps the dates of the guards on the wall clock. */
  wallOffset() {
    return this.now() - this.sessionNow();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `connected` (the first connection and each reconnection): the
   * configuration asked from Gladys, again and again while it fails (5 s,
   * 15 s, 30 s, then every minute, without end), then a start.
   */
  async connectedVia(getConfig) {
    this.cancelConfigRetry();
    const attempt = ++this.configAttempt;
    let raw;
    try {
      raw = await getConfig();
    } catch (err) {
      if (attempt !== this.configAttempt) return;
      const wait = CONFIG_RETRY[Math.min(this.configFailures, CONFIG_RETRY.length - 1)];
      this.configFailures += 1;
      this.logger.warn(
        `RESOL: reading the configuration from Gladys failed (${err?.name ?? 'Error'}); again in ${Math.round(wait / 1000)} s`,
      );
      this.lastStatus = undefined;
      await this.setStatus(false, T.configRetry(wait));
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        if (attempt === this.configAttempt) {
          this.connectedVia(getConfig).catch((e) =>
            this.logger.error(`RESOL: start failed (${e?.name ?? 'Error'})`),
          );
        }
      }, wait);
      return;
    }
    if (attempt !== this.configAttempt) return;
    this.configFailures = 0;
    await this.start(raw);
  }

  cancelConfigRetry() {
    if (this.configTimer !== undefined) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
  }

  /** `fresh`: the user saved the form (not a reconnection). It accepts no counter held back. */
  start(raw = {}, { fresh = false } = {}) {
    if (fresh) {
      // A save wins over a getConfig() still being retried.
      this.configAttempt += 1;
      this.cancelConfigRetry();
    }
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    this.configAttempt += 1;
    this.cancelConfigRetry();
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** The fields of the read (with the address), or undefined. */
  credentials() {
    const { address, host, port, username, password, filter, problem } = this.config;
    return problem ? undefined : { address, host, port, username, password, filter };
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    if (this.storeUnreadable) {
      // Read again: maybe readable now (never taken as empty meanwhile).
      this.loadStore();
      this.guards.clear();
    }
    this.config = normalizeConfig(raw);
    const { address } = this.config;
    let changed = false;
    if (address && address !== this.kept.address) {
      // Another address: its pace and refusal start afresh (the devices and
      // their counters stay: they belong to the serial number).
      Object.assign(this.kept, { address, lastAttemptAt: 0, refusal: null });
      this.savedAttemptAt = 0;
      this.restartMono = undefined;
      this.forgetPace();
      this.values = undefined;
      changed = true;
    }
    const credentials = this.credentials();
    if (credentials) {
      const digest = digestOf(credentials);
      const fp = fingerprint(this.kept.salt, address, credentials);
      const stopFp = this.kept.refusal?.fp;
      const other =
        this.knownDigest !== undefined
          ? this.knownDigest !== digest
          : stopFp !== undefined && stopFp !== fp;
      this.knownDigest = digest;
      if (other) {
        // New log-in fields: tried at once, the refusal forgotten.
        this.kept.refusal = null;
        this.restartMono = undefined;
        this.forgetPace();
        changed = true;
      }
    }
    await this.saveState({ force: changed });
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    if (!fresh) {
      // A (re)connection: every value again at the next read (none now).
      this.gladys.forgetPublishedStates?.();
      this.lastSent.clear();
    }
    await this.discover();
    await this.updateStatus({ starting: true });
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(() => this.run(generation, () => this.tick()), TICK);
    this.firstRun = this.run(generation, () => this.tick());
  }

  forgetPace() {
    this.lastAttemptMono = undefined;
    this.failures = 0;
    this.retryAtMono = undefined;
    this.lastError = undefined;
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    // The read running (if any) is cut: one connection at a time.
    this.client.abort?.();
    await this.busy;
    // /data written on a clean stop too (the last state of the counters).
    await this.saveState();
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return undefined;
    }
    try {
      return await job();
    } catch (err) {
      this.logger.error(`RESOL: unexpected error (${err?.name ?? 'Error'})`);
      return undefined;
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  // --- Devices ---------------------------------------------------------------------

  /** The devices of this integration the user created. */
  createdDevices() {
    const prefix = `${this.gladys.externalId(EXTERNAL_ID_TYPE)}:`;
    return (this.gladys.devices ?? []).filter((d) =>
      String(d.external_id ?? '').startsWith(prefix),
    );
  }

  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /** `{ serial, packetId }` of a created device (its params, else its external id). */
  identityOf(device) {
    const param = (name) => (device.params ?? []).find((p) => p.name === name)?.value;
    let serial = param('RESOL_SERIAL');
    let packetId = param('RESOL_PACKET');
    if (!serial || !packetId) {
      const prefix = `${this.gladys.externalId(EXTERNAL_ID_TYPE)}:`;
      const platform = String(device.external_id ?? '').slice(prefix.length);
      const cut = platform.indexOf('_');
      if (cut <= 0) return undefined;
      serial = platform.slice(0, cut);
      packetId = platform.slice(cut + 1);
    }
    return /^[0-9a-z]{4,32}$/.test(serial) && /^[0-9a-z_]{1,48}$/.test(packetId)
      ? { serial, packetId }
      : undefined;
  }

  /** The packets of the last read that have at least one published value. */
  packetsRead() {
    return (this.values?.live.packets ?? []).filter((p) => publishedFields(p).length > 0);
  }

  /** The names of the devices of a read: the source of the packet, made unique. */
  namesOf(packets) {
    const count = new Map();
    for (const p of packets) count.set(p.source, (count.get(p.source) ?? 0) + 1);
    return new Map(
      packets.map((p) => {
        const base = p.source || p.description || p.id;
        const name = count.get(p.source) > 1 ? `${base} (${p.destination || p.id})` : base;
        return [p.id, cleanText(`RESOL ${name}`, 100)];
      }),
    );
  }

  async discover({ force = false } = {}) {
    const devices = [];
    const listed = new Set();
    const info = this.values?.info;
    if (info) {
      const packets = this.packetsRead();
      const names = this.namesOf(packets);
      for (const packet of packets) {
        if (devices.length >= MAX_DEVICES) break;
        const external = ids(this.gladys, info.serial, packet.id);
        listed.add(external.device);
        devices.push(
          buildDevice(this.gladys, {
            serial: info.serial,
            packetId: packet.id,
            name: names.get(packet.id),
            info: { ...info, address: this.config.address },
            packet,
            created: this.createdDevice(external.device),
          }),
        );
      }
    }
    // A created device is always published again with all its features (a
    // device never loses one), even when the last read did not bring it.
    for (const created of this.createdDevices()) {
      if (listed.has(created.external_id)) continue;
      const identity = this.identityOf(created);
      if (!identity) continue;
      listed.add(created.external_id);
      devices.push(buildDevice(this.gladys, { ...identity, created }));
    }
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    this.publishedDevices = json;
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) =>
        this.logger.warn(`Publishing the RESOL devices failed (${err?.name ?? 'Error'})`),
      );
  }

  /** The Discover tab: the devices known, published again; never a request to the device. */
  async scan() {
    await this.discover({ force: true });
    await this.updateStatus();
  }

  isFresh(mono = this.monotonic()) {
    return (
      this.values !== undefined &&
      mono - this.valuesAt <= FRESH_INTERVALS * this.config.pollInterval * 1000
    );
  }

  /** A device just created: the values of the last read now (no new request). */
  async onDeviceCreated(device) {
    const prefix = `${this.gladys.externalId(EXTERNAL_ID_TYPE)}:`;
    if (!String(device?.external_id ?? '').startsWith(prefix)) {
      return;
    }
    // A new device: no reference of its counters yet (nor a state kept in
    // /data for a deleted device of the same id).
    for (const feature of device.features ?? []) {
      const id = feature.external_id;
      if (!counterKindOf(id)) continue;
      this.guards.delete(id);
      delete this.kept.counters[id];
    }
    await this.saveState({ force: true });
    await this.publishLast();
  }

  async onDeviceUpdated(device) {
    const prefix = `${this.gladys.externalId(EXTERNAL_ID_TYPE)}:`;
    if (String(device?.external_id ?? '').startsWith(prefix)) {
      await this.publishLast();
    }
  }

  /** The values of the last read (if fresh), never a new request. */
  async publishLast() {
    const generation = this.generation;
    if (!this.isFresh()) return;
    const prepared = this.afterSave(
      this.prepare(this.values, { counters: false }),
      await this.saveState(),
    );
    if (prepared && generation === this.generation) {
      await this.send(prepared);
      if (generation === this.generation) await this.updateStatus();
    }
  }

  // --- /data -------------------------------------------------------------------------

  /**
   * Keeps the state in /data when it changed; false when it could not (or
   * must not: an unreadable file is never written over). The instant of the
   * last read is written at most once a minute. A counter not loaded in
   * memory keeps what /data had.
   */
  async saveState({ force = false } = {}) {
    if (this.storeUnreadable) {
      return false;
    }
    const counters = Object.assign(Object.create(null), this.kept.counters);
    const offset = this.wallOffset();
    const toWall = (ref) =>
      ref && Number.isFinite(ref.at) ? { ...ref, at: ref.at + offset } : ref;
    for (const [id, guard] of this.guards) {
      const state = guard.state();
      counters[id] = { guard: { last: toWall(state.last), held: toWall(state.held) } };
    }
    this.kept.counters = counters;
    const now = this.now();
    const attempt =
      this.kept.lastAttemptAt !== this.savedAttemptAt &&
      (this.savedAttemptAt === 0 || now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY)
        ? this.kept.lastAttemptAt
        : this.savedAttemptAt;
    const state = {
      salt: this.kept.salt,
      address: this.kept.address,
      lastAttemptAt: attempt,
      refusal: this.kept.refusal,
      info: this.kept.info,
      counters,
      packets: this.kept.packets,
    };
    const key = JSON.stringify(state);
    if (!force && key === this.savedKey && !this.saveFailed) {
      return true;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      this.savedAttemptAt = attempt;
      this.saveFailed = false;
      return true;
    } catch (err) {
      if (!this.saveFailed) {
        this.logger.warn(`Saving the RESOL state in /data failed (${err?.code ?? 'error'})`);
      }
      this.saveFailed = true;
      return false;
    }
  }

  /**
   * The states to send after a save: without the counters when /data could
   * not be written, so Gladys never gets a counter /data does not know; the
   * other values go.
   */
  afterSave(states, saved) {
    if (!states || saved) return states;
    const kept = states.filter((s) => !counterKindOf(s.device_feature_external_id));
    return kept.length > 0 ? kept : undefined;
  }

  // --- Reads -------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollInterval * 1000;
  }

  /** The wait after a failure: never faster than a read, doubled up to 15 min. */
  retryWait(failures) {
    const first = Math.max(RETRY_MIN, this.intervalMs());
    return Math.min(first * 2 ** failures, Math.max(RETRY_MAX, first));
  }

  /**
   * The earliest instant (wall clock) of the next read, whatever asks for it,
   * from ONE reading of each clock (`now`, `mono`); Infinity while the log-in
   * is refused (only the test button tries then, `manual`).
   */
  nextReadAt({ manual = false, now = this.now(), mono = this.monotonic() } = {}) {
    const at = [now];
    if (this.lastAttemptMono !== undefined) {
      // Never sooner than the interval (the timer looks every 5 s).
      at.push(now + this.lastAttemptMono + this.intervalMs() - mono);
    }
    if (!manual && this.retryAtMono !== undefined && this.retryAtMono > mono) {
      at.push(now + this.retryAtMono - mono);
    }
    if (this.restartMono !== undefined) {
      at.push(now + this.restartMono + this.intervalMs() - mono);
    }
    if (!manual && this.kept.refusal) at.push(Infinity);
    return Math.max(...at);
  }

  due({ manual = false } = {}) {
    if (!this.credentials()) return false;
    const now = this.now();
    const mono = this.monotonic();
    return this.nextReadAt({ manual, now, mono }) <= now;
  }

  /**
   * One look: a read when one is due. A read still running is never doubled,
   * whatever its generation (a reconnection during a read starts no other).
   */
  tick({ manual = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    if (!this.due({ manual })) {
      return undefined;
    }
    const generation = this.generation;
    this.busy = this.read(generation).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read(generation) {
    const credentials = this.credentials();
    const digest = digestOf(credentials);
    const alive = () => generation === this.generation;
    // Recorded first: neither a reconnection, a save nor a restart reads sooner.
    this.lastAttemptMono = this.monotonic();
    this.restartMono = undefined;
    this.kept.lastAttemptAt = this.now();
    await this.saveState();
    let answer;
    try {
      answer = await this.client.read(credentials);
    } catch (err) {
      await this.failed(err, { credentials, digest, alive });
      return;
    }
    if (!alive()) {
      // Late: an old configuration or a restart. Nothing published, no status.
      return;
    }
    const live = parseLive(answer.data);
    if (!live) {
      await this.failed({ code: 'protocol' }, { credentials, digest, alive });
      return;
    }
    this.failures = 0;
    this.retryAtMono = undefined;
    this.lastError = undefined;
    // The fingerprint of a refused log-in goes with the first success.
    this.kept.refusal = null;
    const { info } = answer;
    this.otherSerial = Boolean(this.kept.info?.serial && this.kept.info.serial !== info.serial);
    if (this.otherSerial) {
      this.logger.warn(
        'RESOL: another serial number answers at this address: its own devices are in Discovery',
      );
    }
    this.kept.info = { serial: info.serial, product: info.product, version: info.version };
    const mono = this.monotonic();
    this.trackPackets(info.serial, live, mono);
    this.values = { info, live };
    this.valuesAt = mono;
    this.readAt = this.now();
    const states = this.prepare(this.values, { counters: true });
    // Saved BEFORE Gladys gets the values; a counter only goes once /data
    // holds it (a failed write sends the other values only).
    const prepared = this.afterSave(states, await this.saveState());
    if (!alive()) return;
    if (prepared) await this.send(prepared);
    if (!alive()) return;
    await this.discover();
    if (!alive()) return;
    await this.updateStatus();
  }

  /** Notes when the time stamp of each packet last moved (monotonic). */
  trackPackets(serial, live, mono) {
    const now = this.now();
    for (const packet of live.packets) {
      const key = `${serial}_${packet.id}`;
      const seen = this.packetSeen.get(key);
      if (packet.at === undefined) {
        this.packetSeen.delete(key);
        delete this.kept.packets[key];
      } else if (!seen || seen.at !== packet.at) {
        this.packetSeen.set(key, { at: packet.at, mono });
        this.kept.packets[key] = { at: packet.at, changedAt: now };
      }
    }
    // /data keeps the most recent MAX_PACKETS.
    const keys = Object.keys(this.kept.packets);
    if (keys.length > MAX_PACKETS) {
      keys
        .sort((a, b) => this.kept.packets[a].changedAt - this.kept.packets[b].changedAt)
        .slice(0, keys.length - MAX_PACKETS)
        .forEach((key) => delete this.kept.packets[key]);
    }
  }

  /**
   * Whether a packet is stale: its time stamp has not moved for 15 min, or it
   * is 15 min older than the answer (both on the clock of the data logger).
   */
  isStale(serial, packet, live, mono) {
    if (packet.at === undefined) return false;
    const seen = this.packetSeen.get(`${serial}_${packet.id}`);
    if (seen && mono - seen.mono > PACKET_STALE_AFTER) return true;
    return live.at !== undefined && live.at - packet.at > PACKET_MAX_AGE;
  }

  async failed(err, { credentials, digest, alive }) {
    const code = err?.code ?? 'error';
    // A late failure of another configuration is dropped; a refusal of the
    // same address and log-in fields is still kept.
    const current = this.credentials();
    const same = current !== undefined && digestOf(current) === digest;
    if (!alive() && !same) return;
    if (code === 'aborted') return;
    // Our own words only (ResolError codes): never a byte of the device, never a secret.
    this.logger.warn(`RESOL read of ${credentials.address} failed: ${code}`);
    if (code === 'refused') {
      this.kept.refusal = {
        code: 'refused',
        fp: fingerprint(this.kept.salt, credentials.address, credentials),
      };
    } else {
      this.retryAtMono = this.monotonic() + this.retryWait(this.failures);
      this.failures += 1;
    }
    this.lastError = err;
    await this.saveState();
    if (alive()) {
      await this.updateStatus();
    }
  }

  /** The guard of a counter of a created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = this.kept.counters[id];
      // The guard lives on the session clock (never the wall clock).
      const sessionNow = this.sessionNow();
      // /data holds wall dates (saveState): back to the session clock.
      const offset = this.now() - sessionNow;
      const toSession = (ref) =>
        ref && Number.isFinite(ref.at) ? { ...ref, at: ref.at - offset } : ref;
      // A date "in the future" (a wall clock set back across a restart) is now:
      // the margin of the next rise never shrinks to nothing.
      const clamp = (ref) =>
        ref && Number.isFinite(ref.at) ? { ...ref, at: Math.min(ref.at, sessionNow) } : ref;
      const guardState = saved?.guard
        ? { ...saved.guard, last: clamp(toSession(saved.guard.last)) }
        : saved?.guard;
      this.guards.set(
        id,
        new IndexGuard(
          clamp(toSession(lastValueOf(created, id))),
          guardState,
          sessionNow,
          COUNTER_LIMITS[counterKindOf(id)],
        ),
      );
    }
    return this.guards.get(id);
  }

  /**
   * The states of a read, the counters through their guards (not sent yet:
   * `send` does it, after /data is saved), for the features of the created
   * devices of the serial read only. `counters`: a new read (the counters are
   * taken); otherwise (a device just created) the last accepted values of the
   * counters held only. Counters first.
   */
  prepare(values, { counters }) {
    const { info, live } = values;
    const sessionNow = this.sessionNow();
    const mono = this.monotonic();
    const first = [];
    const rest = [];
    for (const packet of live.packets) {
      const external = ids(this.gladys, info.serial, packet.id);
      const created = this.createdDevice(external.device);
      if (!created) continue;
      if (this.isStale(info.serial, packet, live, mono)) continue;
      const features = new Set((created.features ?? []).map((f) => f.external_id));
      for (const { field, kind } of publishedFields(packet)) {
        const id = external.feature(kind.key);
        if (!features.has(id)) continue;
        const value = valueOf(field, kind);
        if (!kind.counter) {
          if (value !== undefined) rest.push({ device_feature_external_id: id, state: value });
          continue;
        }
        const guard = this.guardOf(created, id);
        if (!counters || value === undefined) {
          const last = guard.held ? guard.last?.value : undefined;
          if (last > 0) first.push({ device_feature_external_id: id, state: last });
          continue;
        }
        const plausible = guard.accept(value, sessionNow);
        const held = guard.held ? `${guard.held.direction}:${guard.held.from}` : undefined;
        if (held && this.loggedHolds.get(id) !== held) {
          this.logger.warn(
            `RESOL counter ${kind.key} ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held counter" button takes it`,
          );
        }
        if (held) this.loggedHolds.set(id, held);
        else this.loggedHolds.delete(id);
        // While a value is held, the last accepted one is sent again.
        const out = plausible ? value : guard.held ? guard.last?.value : undefined;
        // Never 0 (the guard never lets 0 through, checked again here).
        if (typeof out === 'number' && out > 0) {
          first.push({ device_feature_external_id: id, state: out });
        }
      }
    }
    const states = [...first, ...rest];
    return states.length > 0 ? states : undefined;
  }

  /**
   * The states, within STATES_PER_MINUTE over any 60 s: only the values
   * changed (or unchanged for STATE_HEARTBEAT) count; beyond the room left,
   * the rest waits for the next read (counters first). The room is taken
   * BEFORE the publication (two publications at once never both pass).
   */
  async send(states) {
    const mono = this.monotonic();
    const changed = states.filter((s) => {
      const last = this.lastSent.get(s.device_feature_external_id);
      return !last || last.state !== s.state || mono - last.at >= STATE_HEARTBEAT;
    });
    this.sent = this.sent.filter((s) => mono - s.at < MINUTE);
    const used = this.sent.reduce((sum, s) => sum + s.count, 0);
    const batch = changed.slice(0, Math.max(0, STATES_PER_MINUTE - used));
    if (batch.length < changed.length) {
      this.logger.debug('RESOL: some values kept for the next read (states per minute)');
    }
    if (batch.length === 0) return;
    const entry = { at: mono, count: batch.length };
    this.sent.push(entry);
    try {
      const result = await this.gladys.publishChangedStates(batch, { heartbeat: STATE_HEARTBEAT });
      if (Number.isInteger(result?.count) && result.count >= 0 && result.count <= batch.length) {
        entry.count = result.count;
      }
      for (const s of batch) {
        this.lastSent.set(s.device_feature_external_id, { state: s.state, at: mono });
      }
    } catch (err) {
      this.logger.warn(`Publishing the RESOL values failed (${err?.name ?? 'Error'})`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  /** Every counter held back on the created devices: `{ id, name, kind, direction, from, to }`. */
  heldList() {
    const list = [];
    for (const created of this.createdDevices()) {
      for (const feature of created.features ?? []) {
        const id = feature.external_id;
        const kind = counterKindOf(id);
        if (!kind) continue;
        const held = this.guardOf(created, id).held;
        if (held) {
          const name = cleanText(feature.name, 100) || id.split(':').at(-1);
          list.push({ id, name, kind, ...held });
        }
      }
    }
    return list;
  }

  async updateStatus({ starting = false } = {}) {
    const { problem, address } = this.config;
    if (problem) {
      await this.setStatus(false, T.problem[problem]);
      return;
    }
    const now = this.now();
    const mono = this.monotonic();
    if (this.kept.refusal) {
      await this.setStatus(false, T.refused(address, this.config.password === ''));
      return;
    }
    if (this.lastError) {
      const wait = this.retryAtMono === undefined ? 0 : Math.max(0, this.retryAtMono - mono);
      await this.setStatus(false, T.failing(address, this.lastError, wait));
      return;
    }
    if (!this.values) {
      const at = this.nextReadAt({ now, mono });
      if (starting && at <= now) {
        await this.setStatus(false, T.connecting);
      } else {
        // After a restart, a device read before (no refusal, no error) is
        // shown connected until its next read.
        await this.setStatus(Boolean(this.kept.info), T.waiting(at));
      }
      return;
    }
    const { info, live } = this.values;
    const packets = this.packetsRead();
    const stale = packets.filter((p) => this.isStale(info.serial, p, live, mono)).length;
    const notes = [];
    if (packets.length === 0) notes.push(T.notes.noPacket);
    else if (!packets.some((p) => this.createdDevice(ids(this.gladys, info.serial, p.id).device))) {
      notes.push(T.notes.noDevice);
    }
    if (stale > 0) notes.push(T.notes.stale(stale));
    if (this.otherSerial) notes.push(T.notes.otherSerial);
    if (this.storeUnreadable) notes.push(T.notes.storeUnreadable);
    else if (this.saveFailed) notes.push(T.notes.storeFailed);
    const held = this.heldList();
    if (held.length > 0) notes.push(T.notes.held(held));
    await this.setStatus(true, T.ok(info, packets.length - stale, notes));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held counter", in two clicks: the first lists every counter
   * held (nothing is accepted), the second, from 3 s to 5 min later, accepts
   * exactly what the first listed, and only when it still shows that value
   * (or, for a jump, what may have come since: src/guard.js). A drop is a
   * reset or a new controller: once accepted, the counter goes on from the
   * new value. A save of the form never accepts.
   */
  async acceptHeldCounter() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.sessionNow();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (!pending || elapsed > ACCEPT_CONFIRM_WITHIN || elapsed < ACCEPT_CONFIRM_AFTER) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list };
      return T.accept.confirm(list, ACCEPT_CONFIRM_WITHIN);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      // The value listed, or what the counter may have added since (both directions).
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        held.to >= entry.to &&
        held.to - entry.to <= margin;
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    for (const { id, direction } of accepted) {
      this.logger.info(
        `RESOL counter ${id.split(':').at(-1)} ${direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
    }
    await this.saveState();
    // Published at the next read (never a read sooner than the interval).
    const taken = new Set(accepted.map((h) => h.id));
    const stillHeld = this.heldList().some((h) => !taken.has(h.id));
    return T.accept.done(accepted, changed, stillHeld);
  }

  /**
   * The test button: a read when one is due (the interval passed; a refused
   * log-in may be tried again then, once per click), else what is known and
   * when the next read can be. Never a read the pace forbids.
   */
  async testConnection() {
    const { problem, address } = this.config;
    if (problem) {
      return T.problem[problem];
    }
    const generation = this.generation;
    const job = this.busy ?? this.tick({ manual: true });
    if (job) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('late'), TEST_ANSWER_WITHIN);
      });
      try {
        if ((await Promise.race([job.then(() => 'done'), late])) === 'late') {
          return T.test.slow;
        }
      } finally {
        this.timers.clearTimeout(timer);
      }
    }
    if (generation !== this.generation) {
      return T.test.slow;
    }
    const lines = [];
    const mono = this.monotonic();
    const fresh = this.isFresh(mono);
    if (this.kept.refusal) {
      lines.push(
        T.test.failed(address, {
          code: this.config.password === '' ? 'password_asked' : 'refused',
        }),
      );
    } else if (this.lastError) {
      lines.push(T.test.failed(address, this.lastError));
    } else if (fresh) {
      lines.push(T.test.ok(address, this.values.info, this.packetsRead().length));
    }
    if (fresh && this.readAt !== undefined) lines.push(T.test.lastRead(this.readAt));
    if (!job) lines.push(T.test.notNow(this.nextReadAt({ manual: true, mono })));
    return T.test.lines(lines);
  }
}
