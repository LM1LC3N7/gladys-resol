// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake client and the test
// clock of the kit (it moves at each read): the devices, the values, the pace,
// the refusal, the failures, the identity, the freshness and /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { testClock } from './kit/clock.mjs';
import { DELTASOL, SERIAL, deltasol } from './helpers/fixtures.js';
import {
  CONFIG,
  DEVICE,
  F,
  HOUR,
  K,
  MINUTE,
  PASSWORD,
  POLL,
  START,
  answer,
  created,
  fail,
  last,
  setup,
  status,
} from './helpers/app.js';

test('nothing configured, or a field invalid: the status says so, nothing is read', async () => {
  for (const [config, words] of [
    [{}, /adresse IP du KM2/],
    [{ ...CONFIG, address: 'u:p@x' }, /adresse n’est pas valide/],
    [{ ...CONFIG, address: 'https://192.168.1.70' }, /https/],
    [{ ...CONFIG, address: '255.255.255.255' }, /adresse n’est pas valide/],
    [{ ...CONFIG, password: 'a\nb' }, /mot de passe n’est pas valide/],
    [{ ...CONFIG, filter: 'a b' }, /filtre n’est pas valide/],
  ]) {
    const { app, gladys, client } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, words);
    assert.equal(client.calls.length, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), words);
    await app.stop();
  }
});

test('the first read: one device per VBus packet in Discovery, no value before it is created', async () => {
  const { app, gladys, client, advance } = await setup();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].credentials.username, 'admin');
  assert.equal(client.calls[0].credentials.password, PASSWORD);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'RESOL DeltaSol MX [Regler]');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    K.T1,
    K.T2,
    K.T3,
    K.PUMP,
    K.HOURS,
    K.HEAT,
    K.HEAT_TODAY,
    K.PRESSURE,
    K.TIMER,
  ]);
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Créez ses appareils/);
  // Created: the values of the last read at once, without a new request.
  await gladys.fake.deviceCreated(device);
  assert.equal(client.calls.length, 1);
  assert.equal(last(gladys, K.T1), 62.4);
  assert.equal(last(gladys, K.T2), 45.1);
  assert.equal(last(gladys, K.T3), undefined, '888.8 °C is an open sensor line');
  assert.equal(last(gladys, K.PUMP), 70);
  assert.equal(last(gladys, K.HEAT_TODAY), 3.2);
  assert.equal(last(gladys, K.PRESSURE), 1.8);
  // The lifetime counters go through their guard at the next read.
  assert.equal(last(gladys, K.HEAT), undefined);
  assert.equal(last(gladys, K.HOURS), undefined);
  await advance(POLL + 5000);
  assert.equal(client.calls.length, 2);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  assert.equal(last(gladys, K.HOURS), 1234);
  assert.ok(!gladys.fake.publishedEnergyConsumption?.length);
  await app.stop();
});

test('a lifetime counter never publishes 0 nor a drop; the user accepts it in two clicks', async () => {
  let heat = 4_567_890;
  const { app, gladys, advance, logger } = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '020_4_0': heat })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), 4567.89);
  heat = 0;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89, 'never 0');
  heat = 1000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89, 'a drop is held, the last value sent again');
  assert.match(status(gladys).message.fr, /Compteur « Heat quantity \(kWh, lifetime\) » : baisse/);
  assert.ok(logger.lines.some((l) => /drop held back/.test(l)));
  // The drop stays held whatever the time.
  await advance(6 * HOUR);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  // First click lists, the second (3 s to 5 min later) accepts exactly that.
  const first = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(first.fr, /Un second clic accepte exactement ces valeurs/);
  assert.match(first.fr, /4567\.89 kWh → 1 kWh/);
  const second = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(second.fr, /Un second clic/, 'too soon: listed again');
  await advance(10 * 1000);
  const third = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(third.fr, /Accepté : Heat quantity \(kWh, lifetime\) 1 kWh/);
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 1);
  heat = 2000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 2);
  await app.stop();
});

test('a jump of a counter is held; a jump of operating hours beyond 1 h per hour too', async () => {
  let hours = 1234;
  let heat = 4_567_890;
  const { app, gladys, advance } = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '010_4_0': hours, '020_4_0': heat })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  hours = 1236;
  heat = 4_570_000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HOURS), 1236, 'within the slack of 2 h');
  assert.equal(last(gladys, K.HEAT), 4570);
  hours = 1300;
  heat = 9_000_000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HOURS), 1236, 'held');
  assert.equal(last(gladys, K.HEAT), 4570, 'held');
  assert.match(status(gladys).message.fr, /saut de 1236 h à 1300 h/);
  assert.match(status(gladys).message.fr, /saut de 4570 kWh à 9000 kWh/);
  await app.stop();
});

test('a counter of a period (today) may return to 0: a plain value', async () => {
  let today = 3200;
  const { app, gladys, advance } = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '024_4_0': today })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT_TODAY), 3.2);
  today = 0;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT_TODAY), 0);
  await app.stop();
});

test('a missing value (raw 0 with an empty text) is never a measure 0', async () => {
  const { app, gladys } = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '000_2_0': null, '008_1_0': null })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.T1), undefined);
  assert.equal(last(gladys, K.PUMP), undefined);
  assert.equal(last(gladys, K.T2), 45.1);
  await app.stop();
});

test('never faster than the interval: timer, test button, Discovery, reconnection, restart', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  const { app, gladys, client, advance } = await setup({ store, clock });
  await gladys.fake.emit?.('connected');
  await app.start(CONFIG);
  await app.idle();
  const before = client.calls.length;
  await gladys.fake.action(ACTIONS.TEST);
  await gladys.fake.scan?.();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(client.calls.length, before, 'no read sooner than the interval');
  await advance(30 * 1000);
  assert.equal(client.calls.length, before);
  await advance(35 * 1000);
  assert.equal(client.calls.length, before + 1);
  await app.stop();
  // A restart of the container: the first read waits the interval and a minute.
  const again = await setup({ store, clock });
  await again.app.start(CONFIG);
  await again.app.idle();
  assert.equal(again.client.calls.length, 0);
  await again.advance(POLL + MINUTE + 5000);
  assert.equal(again.client.calls.length, 1);
  await again.app.stop();
});

test('refused: a final stop kept in /data; only new fields or the test button try again', async () => {
  const store = createMemoryStore();
  let refuse = true;
  const { app, gladys, client, advance } = await setup({
    store,
    script: () => (refuse ? fail('refused') : answer()),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(client.calls.length, 1);
  assert.match(status(gladys).message.fr, /refuse l’identifiant ou le mot de passe/);
  assert.equal(JSON.stringify(store.data).includes(PASSWORD), false, 'no secret in /data');
  await advance(6 * HOUR);
  assert.equal(client.calls.length, 1, 'never tried again by itself');
  // The test button: one try per click.
  await gladys.fake.action(ACTIONS.TEST);
  assert.equal(client.calls.length, 2);
  // New fields: tried at once.
  refuse = false;
  await app.start({ ...CONFIG, password: 'other' }, { fresh: true });
  await app.idle();
  assert.equal(client.calls.length, 3);
  assert.equal(status(gladys).connected, true);
  assert.equal(store.data.refusal, null);
  await app.stop();
});

test('a failure is no refusal: tried again, never faster than the interval', async () => {
  let failing = true;
  const { app, gladys, client, advance } = await setup({
    script: () => (failing ? fail('unreachable') : answer()),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.fr, /injoignable/);
  await advance(30 * 1000);
  assert.equal(client.calls.length, 1);
  failing = false;
  await advance(POLL);
  assert.equal(client.calls.length, 2);
  assert.equal(status(gladys).connected, true);
  await app.stop();
});

test('getConfig() failing in `connected`: asked again without end, then the start', async () => {
  const { app, gladys, client, clock } = await setup();
  let failures = 2;
  const getConfig = async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('boom');
    }
    return CONFIG;
  };
  await app.connectedVia(getConfig);
  assert.match(status(gladys).message.fr, /configuration n’a pas pu être lue/);
  assert.equal(client.calls.length, 0);
  await clock.advance(5 * 1000);
  assert.match(status(gladys).message.fr, /nouvel essai dans 15 s/);
  await clock.advance(15 * 1000);
  await app.idle();
  assert.equal(client.calls.length, 1);
  assert.equal(status(gladys).connected, true);
  await app.stop();
});

test('a stale packet (its time stamp frozen for 15 min) is no longer published', async () => {
  let at = 1_800_000_000;
  let packetAt = at;
  let t1 = 60;
  const { app, gladys, advance } = await setup({
    devices: [created()],
    script: () => answer({ at, packets: [deltasol({ '000_2_0': t1 }, { at: packetAt })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.T1), 60);
  // The controller stopped sending: the data logger keeps its last packet.
  for (let i = 0; i < 20; i += 1) {
    at += 60;
    t1 += 0.1;
    await advance(POLL + 5000);
  }
  const frozen = last(gladys, K.T1);
  assert.ok(frozen < 61.6, `published until it was 15 min old only: ${frozen}`);
  for (let i = 0; i < 3; i += 1) {
    at += 60;
    t1 += 0.1;
    await advance(POLL + 5000);
  }
  assert.equal(last(gladys, K.T1), frozen, 'no longer published');
  assert.match(status(gladys).message.fr, /sans nouvelle depuis 15 min/);
  packetAt = at;
  await advance(POLL + 5000);
  assert.ok(last(gladys, K.T1) > 62, 'a packet that moves again is published again');
  await app.stop();
});

test('another serial number at the address: its own devices, the old ones get nothing', async () => {
  let serial = SERIAL;
  const { app, gladys, advance } = await setup({
    devices: [created()],
    script: () => answer({ info: { serial: serial.toUpperCase() } }),
  });
  await app.start(CONFIG);
  await app.idle();
  const count = gladys.fake.states.length;
  serial = '001e66999999';
  await advance(POLL + 5000);
  assert.equal(gladys.fake.states.length, count);
  assert.match(status(gladys).message.fr, /autre numéro de série/);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes(DEVICE), 'the created device stays in Discovery');
  assert.ok(ids.some((id) => id.includes('001e66999999')));
  await app.stop();
});

test('/data not writable: the counters are not sent, the other values are', async () => {
  const store = createMemoryStore({}, { failSave: true });
  const { app, gladys } = await setup({ store, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), undefined);
  assert.equal(last(gladys, K.T1), 62.4);
  assert.match(status(gladys).message.fr, /ne peut pas être écrit/);
  await app.stop();
});

test('/data unreadable: left as it is, no counter published', async () => {
  const store = createMemoryStore({ salt: 'x' }, { unreadable: true });
  const { app, gladys } = await setup({ store, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), undefined);
  assert.equal(store.saves, 0);
  assert.match(status(gladys).message.fr, /illisible/);
  await app.stop();
});

test('a held counter stays held across a restart (kept in /data)', async () => {
  const store = createMemoryStore();
  const clock = testClock({ start: START });
  let heat = 4_567_890;
  const script = () => answer({ packets: [deltasol({ '020_4_0': heat })] });
  const one = await setup({ store, clock, devices: [created()], script });
  await one.app.start(CONFIG);
  await one.app.idle();
  heat = 1000;
  await one.advance(POLL + 5000);
  await one.app.stop();
  const two = await setup({ store, clock, devices: [created()], script });
  await two.app.start(CONFIG);
  await two.app.idle();
  await two.advance(POLL + MINUTE + 5000);
  assert.equal(two.client.calls.length, 1);
  assert.equal(last(two.gladys, K.HEAT), 4567.89);
  assert.match(status(two.gladys).message.fr, /baisse de 4567\.89 kWh à 1 kWh/);
  await two.app.stop();
});

test('the features of a created device are all published again (never one lost)', async () => {
  const device = created();
  device.features.push({
    ...device.features[0],
    external_id: F('099_2_0_c'),
    name: 'Old sensor',
  });
  const { app, gladys } = await setup({ devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  const published = gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  assert.ok(published.features.some((f) => f.external_id === F('099_2_0_c')));
  assert.equal(published.features.length, DELTASOL.fields.length);
  await app.stop();
});

test('the password never appears in the logs, the statuses nor /data', async () => {
  const store = createMemoryStore();
  let n = 0;
  const { app, gladys, logger, advance } = await setup({
    store,
    script: () => {
      n += 1;
      if (n === 1) fail('unreachable');
      if (n === 2) fail('refused');
      return answer();
    },
  });
  const statuses = [];
  const original = gladys.setConnectionStatus.bind(gladys);
  gladys.setConnectionStatus = (connected, message) => {
    statuses.push(JSON.stringify(message ?? ''));
    return original(connected, message);
  };
  await app.start(CONFIG);
  await app.idle();
  await advance(2 * MINUTE);
  await gladys.fake.action(ACTIONS.TEST);
  await advance(POLL + 5000);
  const everything = [...logger.lines, ...statuses, JSON.stringify(store.data)].join('\n');
  assert.ok(statuses.length >= 2);
  assert.doesNotMatch(everything, /Sup3r-S3cret/);
  await app.stop();
});

test('a device created long after the last read gets nothing stale', async () => {
  let failing = false;
  const { app, gladys, advance } = await setup({
    script: () => (failing ? fail('timeout') : answer()),
  });
  await app.start(CONFIG);
  await app.idle();
  failing = true;
  await advance(10 * MINUTE);
  const [device] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(device);
  assert.equal(gladys.fake.states.length, 0, 'the values of 10 min ago are not current');
  await app.stop();
});

test('a reconnection to Gladys publishes nothing old: the values come with the next read', async () => {
  const { app, gladys, client, advance } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const count = gladys.fake.states.length;
  assert.ok(count > 0);
  await app.connectedVia(async () => CONFIG);
  await app.idle();
  assert.equal(gladys.fake.states.length, count, 'nothing sent at the reconnection');
  assert.equal(client.calls.length, 1, 'no read sooner than the interval');
  await advance(POLL + 5000);
  assert.ok(gladys.fake.states.length > count, 'everything again at the next read');
  await app.stop();
});

test('the guard runs on the session clock: NTP moving the wall clock never widens its margin', async () => {
  const base = testClock({ start: START });
  let jump = 0;
  const clock = { ...base, now: () => base.now() + jump, advance: (ms) => base.advance(ms) };
  let heat = 4_567_890;
  const { app, gladys, advance } = await setup({
    clock,
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '020_4_0': heat })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), 4567.89);
  // The wall clock jumps 10 h ahead (NTP after a late start): 200 kW × 10 h
  // would cover 2,000 kWh; a minute went by, so 1,000 kWh is a jump.
  jump = 10 * HOUR;
  heat = 5_567_890;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  assert.match(status(gladys).message.fr, /saut de 4567\.89 kWh à 5567\.89 kWh/);
  await app.stop();
});

test('configurations saved one after the other apply one by one, the last one wins', async () => {
  const { app, client } = await setup();
  const one = app.start({ ...CONFIG, address: '192.168.1.71' }, { fresh: true });
  const two = app.start({ ...CONFIG, address: '192.168.1.72' }, { fresh: true });
  await Promise.all([one, two]);
  await app.idle();
  assert.equal(app.config.address, '192.168.1.72:80');
  assert.equal(client.calls.at(-1).credentials.address, '192.168.1.72:80');
  await app.stop();
});

test('an unknown filter is no refusal: the test button tries the new filter after the interval', async () => {
  const { app, gladys, client, advance } = await setup({
    script: (n, { credentials }) => (credentials.filter === 'bad' ? fail('filter') : answer()),
  });
  await app.start({ ...CONFIG, filter: 'bad' });
  await app.idle();
  assert.match(status(gladys).message.fr, /ne connaît pas ce filtre/);
  assert.equal(app.kept.refusal, null);
  await app.start({ ...CONFIG, filter: 'good' }, { fresh: true });
  await app.idle();
  assert.equal(client.calls.length, 1, 'never faster than the interval');
  await advance(POLL);
  await gladys.fake.action(ACTIONS.TEST);
  assert.equal(client.calls.length, 2);
  assert.equal(status(gladys).connected, true);
  await app.stop();
});

test('a KM2 without a password says so and is tried again later, never refused', async () => {
  const { app, gladys, client, advance } = await setup({
    config: { address: '192.168.1.70' },
    script: () => fail('password_needed'),
  });
  await app.start({ address: '192.168.1.70' });
  await app.idle();
  assert.match(status(gladys).message.fr, /a besoin de l’identifiant et du mot de passe/);
  assert.equal(app.kept.refusal, null);
  await advance(2 * MINUTE + 5000);
  assert.equal(client.calls.length, 2);
  await app.stop();
});

test('many values: never more than 270 states in any 60 s', async () => {
  const fields = Array.from({ length: 150 }, (_, i) => ({
    id: `${String(i).padStart(3, '0')}_2_0`,
    name: `Temperature ${i}`,
    unit: 'DegreesCelsius',
    value: 20,
  }));
  const packets = [0, 1, 2].map((p) => ({
    id: `00_0010_7e1${p}_0100`,
    source: `DeltaSol ${p}`,
    fields,
  }));
  let v = 20;
  const devices = packets.map((packet) => {
    const device = created({ packet });
    device.external_id = `ext:resol:resol:${SERIAL}_${packet.id}`;
    for (const f of device.features) {
      f.external_id = `${device.external_id}:${f.external_id.split(':').at(-1)}`;
    }
    return device;
  });
  const { app, gladys, advance } = await setup({
    devices,
    script: () => {
      v += 0.1;
      return answer({
        packets: packets.map((p) => ({ ...p, fields: fields.map((f) => ({ ...f, value: v })) })),
      });
    },
  });
  const sent = [];
  const original = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = (states, options) => {
    sent.push({ at: app.monotonic(), count: states.length });
    return original(states, options);
  };
  await app.start(CONFIG);
  await app.idle();
  for (let i = 0; i < 4; i += 1) await advance(POLL + 5000);
  for (const s of sent) {
    const window = sent.filter((o) => o.at > s.at - MINUTE && o.at <= s.at);
    assert.ok(window.reduce((sum, o) => sum + o.count, 0) <= 270);
  }
  assert.ok(sent.reduce((sum, o) => sum + o.count, 0) >= 270 * 2, 'and the rest goes later');
  await app.stop();
});

test('a packet frozen with the whole answer (the data logger lost the VBus) stops after 15 min', async () => {
  const at = 1_800_000_000;
  let t1 = 60;
  const { app, gladys, advance } = await setup({
    devices: [created()],
    script: () => answer({ at, packets: [deltasol({ '000_2_0': t1 })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  for (let i = 0; i < 20; i += 1) {
    t1 += 0.1;
    await advance(POLL + 5000);
  }
  const frozen = last(gladys, K.T1);
  assert.ok(frozen < 61.6, `published for 15 min only: ${frozen}`);
  await app.stop();
});

test('a counter is never published at 0, even past a guard that would let it through', async () => {
  const { app, gladys } = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '020_4_0': 0 })] }),
  });
  // A second barrier after the guard: a guard broken to accept anything.
  app.guards.set(F(K.HEAT), { accept: () => true, held: undefined, state: () => ({}) });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), undefined);
  assert.equal(last(gladys, K.T1), 62.4);
  await app.stop();
});
