// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout), the
// real client and a fake DL2 on 127.0.0.1 (the kit's HTTP server): the reads
// really start at the interval, measured on the method that decides. The time
// is sped up 20 times (60 s of the interval are 3 s), but it is the real
// clock: it moves between any two reads of it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ResolApp } from '../src/app.js';
import { PATHS } from '../src/constants.js';
import { ResolClient } from '../src/resol/client.js';
import { createMemoryStore } from '../src/store.js';
import { httpServer, measurePeriod, realClock, reply, spyOn } from './kit/index.mjs';
import { infoText, liveData } from './helpers/fixtures.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('real clock x20: reads at 0, the interval, twice the interval; never two at once', async (t) => {
  let open = 0;
  let maxOpen = 0;
  const srv = await httpServer({
    latencyMs: 5,
    routes: {
      [`GET ${PATHS.INFO}`]: reply(200, infoText()),
      [`GET ${PATHS.DLX}`]: async () => {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        await new Promise((resolve) => setTimeout(resolve, 20));
        open -= 1;
        return liveData({ at: Math.floor(Date.now() / 1000) });
      },
    },
  });
  t.after(() => srv.close());
  const clock = realClock({ speed: 20 });
  t.after(() => clock.close());
  const gladys = createFakeGladys({ selector: 'resol', config: {} });
  await gladys.connect();
  const app = new ResolApp({
    gladys,
    logger: quiet,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    client: new ResolClient(),
  });
  // `read` dates a read once it is decided (its requests follow).
  const spy = spyOn(app, 'read', clock);
  let gaps;
  try {
    await app.start({ address: `127.0.0.1:${srv.port}`, password: 'secret' });
    gaps = await measurePeriod(spy, { count: 3, period: 60_000, timeoutMs: 20_000 });
  } finally {
    await app.stop();
    await app.idle();
  }
  assert.equal(gaps.length, 2);
  assert.ok(clock.timersSet < 200, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(maxOpen, 1);
  assert.ok(srv.count(`GET ${PATHS.DLX}`) >= 2);
  // Each read asks the identity first (the stop may cut the last one after it).
  const info = srv.count(`GET ${PATHS.INFO}`);
  const data = srv.count(`GET ${PATHS.DLX}`);
  assert.ok(info >= data && info - data <= 1, `${info} / ${data}`);
});
