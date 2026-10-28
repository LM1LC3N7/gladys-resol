// -----------------------------------------------------------------------------
// The points of review r1 (_lots/lot18/reviews/resol-r1.md): every counter
// name of the VSF classified, the counters in seconds and the volumes guarded,
// the pieces of a split counter put back together, a frozen packet kept stale
// across a restart, and one test per guard the mutants showed untested.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, COUNTER_LIMITS } from '../src/constants.js';
import {
  counterOf,
  isPeriodic,
  joinedFields,
  kindOf,
  publishedFields,
  wordsOf,
} from '../src/devices.js';
import { IndexGuard } from '../src/guard.js';
import { parseLive } from '../src/resol/model.js';
import { createMemoryStore, fingerprint } from '../src/store.js';
import { testClock } from './kit/clock.mjs';
import { DELTASOL, deltasol, liveData } from './helpers/fixtures.js';
import {
  CONFIG,
  F,
  HOUR,
  K,
  MINUTE,
  POLL,
  START,
  answer,
  created,
  fail,
  last,
  setup,
  status,
} from './helpers/app.js';

const VSF = JSON.parse(readFileSync(new URL('./fixtures/vsf-names.json', import.meta.url), 'utf8'));

test('every counter name of the VSF (en, de, fr) is classified as listed', () => {
  let n = 0;
  for (const [unitCode, names] of Object.entries(VSF)) {
    for (const [name, expected] of Object.entries(names)) {
      assert.equal(counterOf({ name, unitCode }) ?? null, expected, `${unitCode} ${name}`);
      n += 1;
    }
  }
  assert.ok(n > 600, `${n} names`);
});

test('the names the review listed: periods, settings, seconds and volumes', () => {
  assert.deepEqual(wordsOf('Wmz1_ValueToday_Wh'), ['wmz', '1', 'value', 'today', 'wh']);
  assert.deepEqual(wordsOf('Heat kWh'), ['heat', 'kwh']);
  for (const name of [
    'Wmz1_ValueToday_Wh',
    'Wmz1_ValueWeek_Wh',
    'Wmz1_WertHeute_Wh',
    "Wmz1_ValeurAujourd'hui_Wh",
    'ValueToday',
    'WertWoche',
    'ValeurSemaine',
    "Valeur (ahjourd'hui)",
    'Wärme Vorwoche',
    'Wärme Vormonat',
    'Wärme Vorjahr',
    'Heat pump runtime / 24 h',
    'Laufzeit WP / 24h',
  ]) {
    assert.ok(isPeriodic(name), name);
  }
  for (const name of ['Heat', 'Wmz1_Value_Wh', 'Wärme Gesamt', 'Heat quantity HQM 1']) {
    assert.ok(!isPeriodic(name), name);
    assert.equal(counterOf({ name, unitCode: 'WattHours' }), 'energy', name);
  }
  for (const name of ['Parameter Rise time', 'Parameter Anstiegszeit', 'dt estimated', 'dt meas']) {
    assert.equal(counterOf({ name, unitCode: 'Hours' }), undefined, name);
  }
  for (const name of [
    'Operating seconds relay 1',
    'Betriebssekunden R1',
    'Secondes de fonctionnement relais 1',
    'Operating hours in total',
    'Total operating time',
    'Master: Station operating seconds',
    'BSR 1',
  ]) {
    assert.equal(counterOf({ name, unitCode: 'Seconds' }), 'hours', name);
  }
  for (const name of ['Timer 1.1', 'Mixer runtime', 'Filter runtime today', 'Solar min. on/off']) {
    assert.equal(counterOf({ name, unitCode: 'Seconds' }), undefined, name);
  }
  assert.equal(counterOf({ name: 'Volume in total', unitCode: 'Liters' }), 'volume_l');
  assert.equal(counterOf({ name: 'Zapfmenge gesamt', unitCode: 'CubicMeters' }), 'volume_m3');
  assert.equal(
    counterOf({ name: 'Maximum draw-off quantity', unitCode: 'CubicMeters' }),
    undefined,
  );
  assert.equal(counterOf({ name: 'Volume today', unitCode: 'Liters' }), undefined);
  // Seconds of an operating time: published in hours, a key of their own.
  const s = kindOf({ id: '010_4_0', name: 'Operating seconds relay 1', unitCode: 'Seconds' });
  assert.equal(s.key, '010_4_0_s2h_total');
  assert.equal(s.convert(7200), 2);
});

const split = (fields) => parseLive(liveData({ packets: [{ ...DELTASOL, fields }] })).packets[0];

test('a counter split in Wh / kWh / MWh: dropped next to its total, else put back together', () => {
  const pieces = [
    { id: '100_2_0', name: 'Heat Wh', unit: 'WattHours', value: 500 },
    { id: '102_2_0', name: 'Heat kWh', unit: 'KilowattHours', value: 345 },
    { id: '104_2_0', name: 'Heat MWh', unit: 'MegawattHours', value: 12 },
  ];
  const withTotal = split([
    { id: '000_4_0', name: 'Heat', unit: 'WattHours', value: 12_345_500 },
    ...pieces,
  ]);
  assert.deepEqual(
    publishedFields(withTotal).map((e) => e.kind.key),
    ['000_4_0_kwh_total'],
  );
  const alone = split(pieces);
  const [joined] = joinedFields(alone);
  assert.equal(joined.id, '100_2_0_sum');
  assert.equal(joined.name, 'Heat');
  assert.equal(joined.value, 12_345.5);
  const [entry] = publishedFields(alone);
  assert.equal(entry.kind.key, '100_2_0_sum_kwh_total');
  assert.equal(entry.kind.counter, 'energy');
  // A piece unknown: the total is unknown.
  const missing = split([pieces[0], { ...pieces[1], value: null }, pieces[2]]);
  assert.equal(joinedFields(missing)[0].value, undefined);
  // Two fields named "kWh" / "MWh" (no base): put together too.
  const bare = split([
    { id: '000_2_0', name: 'kWh', unit: 'KilowattHours', value: 5 },
    { id: '002_2_0', name: 'MWh', unit: 'MegawattHours', value: 1 },
  ]);
  assert.equal(joinedFields(bare)[0].value, 1005);
  // A single field ending with its unit is a whole value.
  assert.equal(joinedFields(split([pieces[0]]))[0].id, '100_2_0');
});

const SECONDS = {
  ...DELTASOL,
  fields: [
    ...DELTASOL.fields,
    { id: '050_4_0', name: 'Operating seconds relay 1', unit: 'Seconds', value: 3_600_000 },
  ],
};

test('operating seconds: guarded as hours, never 0 nor a drop published', async () => {
  let seconds = 3_600_000;
  const { app, gladys, advance } = await setup({
    devices: [created({ packet: SECONDS })],
    script: () =>
      answer({
        packets: [
          {
            ...SECONDS,
            fields: SECONDS.fields.map((f) => (f.id === '050_4_0' ? { ...f, value: seconds } : f)),
          },
        ],
      }),
  });
  const key = '050_4_0_s2h_total';
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, key), 1000);
  seconds = 0;
  await advance(POLL + 5000);
  assert.equal(last(gladys, key), 1000, 'never 0');
  seconds = 1000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, key), 1000, 'a drop is held');
  assert.match(status(gladys).message.fr, /baisse de 1000 h à 0\.278 h/);
  await app.stop();
});

test('a packet frozen before a restart stays stale after it (time stamps in /data)', async () => {
  const store = createMemoryStore();
  const base = testClock({ start: START });
  const at = Math.floor(START / 1000);
  let t1 = 60;
  const script = () => answer({ at, packets: [deltasol({ '000_2_0': t1 })] });
  const one = await setup({ store, clock: base, devices: [created()], script });
  await one.app.start(CONFIG);
  await one.app.idle();
  for (let i = 0; i < 20; i += 1) {
    t1 += 0.1;
    await one.advance(POLL + 5000);
  }
  await one.app.stop();
  assert.ok(Object.keys(store.data.packets).length === 1);
  const two = await setup({ store, clock: base, devices: [created()], script });
  await two.app.start(CONFIG);
  await two.app.idle();
  await two.advance(POLL + MINUTE + 5000);
  assert.equal(two.client.calls.length, 1);
  assert.equal(last(two.gladys, K.T1), undefined, 'nothing stale published after the restart');
  assert.match(status(two.gladys).message.fr, /sans nouvelle depuis 15 min/);
  await two.app.stop();
});

test('a packet 15 min older than the answer is stale from the first read', async () => {
  const at = Math.floor(START / 1000);
  const { app, gladys } = await setup({
    devices: [created()],
    script: () => answer({ at, packets: [deltasol({}, { at: at - 20 * 60 })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.T1), undefined);
  await app.stop();
});

/** A setup where the heat counter is held: the drop to `held` Wh, or a jump. */
async function holding(first, then) {
  let heat = first;
  const ctx = await setup({
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '020_4_0': heat })] }),
  });
  await ctx.app.start(CONFIG);
  await ctx.app.idle();
  heat = then;
  await ctx.advance(POLL + 5000);
  return { ...ctx, set: (v) => (heat = v) };
}

const click = async (gladys) => (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message.fr;

test('two clicks: a second click more than 5 min after the first only lists again', async () => {
  const { app, gladys, advance } = await holding(4_567_890, 1000);
  assert.match(await click(gladys), /Un second clic/);
  await advance(6 * MINUTE);
  assert.match(await click(gladys), /Un second clic/, 'too late: listed again');
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  await app.stop();
});

test('two clicks: another drop since the first click is not accepted', async () => {
  const { app, gladys, advance, set } = await holding(4_567_890, 1000);
  assert.match(await click(gladys), /4567\.89 kWh → 1 kWh/);
  set(500);
  await advance(POLL + 5000);
  assert.match(await click(gladys), /Non accepté, la valeur a changé/);
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  await app.stop();
});

test('two clicks: a jump grown beyond the margin since the first click is not accepted', async () => {
  const { app, gladys, advance, set } = await holding(4_567_890, 9_000_000);
  assert.match(await click(gladys), /4567\.89 kWh → 9000 kWh/);
  set(20_000_000);
  await advance(POLL + 5000);
  assert.match(await click(gladys), /Non accepté/);
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  await app.stop();
});

test('two clicks: the value "from" changed since the first click (another hold) is not accepted', async () => {
  const { app, gladys, advance } = await holding(4_567_890, 1000);
  await click(gladys);
  // Another hold from another reference, same value held.
  const guard = app.guards.get(F(K.HEAT));
  guard.held = { ...guard.held, from: 4000 };
  await advance(10 * 1000);
  assert.match(await click(gladys), /Non accepté/);
  await app.stop();
});

test('an accepted drop is the new floor: a glitch below it is held again (m1)', async () => {
  const { app, gladys, advance, set } = await holding(4_567_890, 1000);
  await click(gladys);
  await advance(10 * 1000);
  assert.match(await click(gladys), /Accepté/);
  set(5);
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89, 'the glitch is not taken');
  assert.match(status(gladys).message.fr, /baisse de 4567\.89 kWh à 0\.005 kWh/);
  // The acceptance was for 1 kWh exactly (and what may come since): a value
  // outside it drops the acceptance, nothing is taken without a new one.
  set(1000);
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4567.89);
  await app.stop();
  const guard = new IndexGuard({ value: 10, at: 0 }, undefined, 0, COUNTER_LIMITS.energy);
  guard.accept(1, 0);
  guard.acceptHeld();
  assert.equal(guard.accept(0.5, 1000), false, 'below the value accepted: held');
  const again = new IndexGuard({ value: 10, at: 0 }, undefined, 0, COUNTER_LIMITS.energy);
  again.accept(1, 0);
  again.acceptHeld();
  assert.equal(again.accept(1.001, 1000), true, 'the value accepted is taken');
  assert.equal(again.accept(0.5, 2000), false, 'then a glitch below it is held');
});

test('the slack of the energy guard is 2 kWh', () => {
  const at = (v) =>
    new IndexGuard({ value: 1000, at: 0 }, undefined, 0, COUNTER_LIMITS.energy).accept(v, 0);
  assert.equal(at(1001.9), true);
  assert.equal(at(1002.5), false);
  const hours = (v) =>
    new IndexGuard({ value: 1000, at: 0 }, undefined, 0, COUNTER_LIMITS.hours).accept(v, 0);
  assert.equal(hours(1001.9), true);
  assert.equal(hours(1002.5), false);
});

test('a date of /data in the future is now: the margin then grows with time', async () => {
  const id = F(K.HEAT);
  const store = createMemoryStore({
    counters: { [id]: { guard: { last: { value: 4500, at: START + 10 * HOUR }, held: null } } },
  });
  let heat = 4_500_000;
  const { app, gladys, advance } = await setup({
    store,
    devices: [created()],
    script: () => answer({ packets: [deltasol({ '020_4_0': heat })] }),
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), 4500);
  // 100 kWh an hour later: within 200 kW, from a reference dated now (a
  // reference dated 10 h ahead would give 2 kWh of margin only).
  await advance(HOUR);
  heat = 4_600_000;
  await advance(POLL + 5000);
  assert.equal(last(gladys, K.HEAT), 4600);
  await app.stop();
});

test('the date Gladys gives goes to the session clock: a wall clock set back never widens the margin (m6)', async () => {
  const base = testClock({ start: START });
  let jump = 10 * HOUR;
  const clock = { ...base, now: () => base.now() + jump, advance: (ms) => base.advance(ms) };
  const { app, gladys } = await setup({
    clock,
    devices: [created({ last: { [K.HEAT]: { value: 4567.89, at: START - MINUTE } } })],
    script: () => answer({ packets: [deltasol({ '020_4_0': 5_567_890 })] }),
  });
  // Started with the wall clock 10 h ahead, then set right by NTP.
  jump = 0;
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, K.HEAT), 4567.89, 'a jump of 1000 kWh is held');
  assert.match(status(gladys).message.fr, /saut de 4567\.89 kWh à 5567\.89 kWh/);
  await app.stop();
});

test('a device created again forgets what /data held for its counters', async () => {
  const id = F(K.HEAT);
  const store = createMemoryStore({
    counters: {
      [id]: {
        guard: {
          last: { value: 9000, at: START - HOUR },
          held: { direction: 'down', from: 9000, to: 1, threshold: 1, at: START - HOUR },
        },
      },
    },
  });
  const { app, gladys } = await setup({ store });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(store.data.counters[id].guard.held.from, 9000);
  await gladys.fake.deviceCreated(created());
  assert.equal(store.data.counters[id]?.guard?.held ?? null, null);
  assert.equal(store.data.counters[id]?.guard?.last ?? null, null);
  assert.equal(app.heldList().length, 0);
  await app.stop();
});

test('a refusal kept in /data: the same form is not tried after a restart, another one is', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const address = '192.168.1.70:80';
  const fp = fingerprint(salt, address, { username: 'admin', password: CONFIG.password });
  const kept = { salt, address, refusal: { code: 'refused', fp }, lastAttemptAt: START - HOUR };
  const same = await setup({ store: createMemoryStore(kept) });
  await same.app.start(CONFIG);
  await same.app.idle();
  await same.advance(10 * MINUTE);
  assert.equal(same.client.calls.length, 0);
  assert.match(status(same.gladys).message.fr, /refuse l’identifiant ou le mot de passe/);
  await same.app.stop();
  // The form changed while the container was stopped: read at once.
  let other = 'Other-pass1';
  for (let i = 0; i < 300; i += 1) {
    if (fingerprint(salt, address, { username: 'admin', password: other }) !== fp) break;
    other = `Other-pass${i}`;
  }
  const changed = await setup({ store: createMemoryStore(kept) });
  await changed.app.start({ ...CONFIG, password: other });
  await changed.app.idle();
  assert.equal(changed.client.calls.length, 1);
  await changed.app.stop();
});

test('a refusal is lifted by a successful read: the reads go on by themselves', async () => {
  let refuse = true;
  const { app, gladys, client, advance } = await setup({
    script: () => (refuse ? fail('refused') : answer()),
  });
  await app.start(CONFIG);
  await app.idle();
  refuse = false;
  await advance(POLL + 5000);
  await gladys.fake.action(ACTIONS.TEST);
  assert.equal(client.calls.length, 2);
  await advance(POLL + 5000);
  assert.equal(client.calls.length, 3, 'read again without a click');
  assert.equal(status(gladys).connected, true);
  await app.stop();
});

test('refused without a password: the status says the device asks for one (m4)', async () => {
  const config = { address: '192.168.1.70' };
  const { app, gladys } = await setup({ config, script: () => fail('refused') });
  await app.start(config);
  await app.idle();
  assert.match(status(gladys).message.fr, /demande un identifiant et un mot de passe \(aucun/);
  const answerText = (await gladys.fake.action(ACTIONS.TEST)).data.message.fr;
  assert.match(answerText, /demande un identifiant et un mot de passe|Non interrogé/);
  await app.stop();
});
