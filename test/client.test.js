// -----------------------------------------------------------------------------
// The client against a fake RESOL device on 127.0.0.1 (the kit's HTTP server):
// the requests of a DL2 / DL3 and of a KM2 / DL2Plus, the refusals, the
// bounds in size and time, the errors (never the address nor a secret).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PATHS } from '../src/constants.js';
import { ResolClient, ResolError } from '../src/resol/client.js';
import { parseLive } from '../src/resol/model.js';
import { httpServer, reply } from './kit/index.mjs';
import { infoText, liveData } from './helpers/fixtures.js';

const PASSWORD = 'p&ss=w?rd #1';
const creds = (srv, extra = {}) => ({
  host: '127.0.0.1',
  port: srv.port,
  username: 'admin',
  password: PASSWORD,
  filter: '',
  ...extra,
});

const dl2 = (extra = {}) =>
  httpServer({
    routes: {
      [`GET ${PATHS.INFO}`]: reply(200, infoText({ product: 'DL2' })),
      [`GET ${PATHS.DLX}`]: liveData(),
      ...extra,
    },
  });

const km2 = (extra = {}) =>
  httpServer({
    routes: {
      [`GET ${PATHS.INFO}`]: reply(200, infoText({ product: 'KM2' })),
      [`POST ${PATHS.KM2}`]: (r) => {
        const [call] = r.json;
        if (call.method === 'login') {
          return call.params.password === PASSWORD
            ? [{ jsonrpc: '2.0', id: call.id, result: { authId: 'abc123' } }]
            : [{ jsonrpc: '2.0', id: call.id, error: { message: 'login failed' } }];
        }
        if (call.method === 'dataGetCurrentData' && call.params.authId === 'abc123') {
          const { language: _language, ...result } = liveData();
          return [{ jsonrpc: '2.0', id: call.id, result }];
        }
        return [{ jsonrpc: '2.0', id: call.id, error: { message: 'denied' } }];
      },
      ...extra,
    },
  });

const rejectsWith = async (promise, code) => {
  const err = await promise.then(
    () => assert.fail(`expected ${code}`),
    (e) => e,
  );
  assert.ok(err instanceof ResolError, String(err));
  assert.equal(err.code, code);
  assert.doesNotMatch(String(err.message), /127\.0\.0\.1|p&ss/);
  return err;
};

test('DL2 / DL3: the information, then the live data with the credentials in the query', async (t) => {
  const srv = await dl2();
  t.after(() => srv.close());
  const client = new ResolClient();
  const { info, data } = await client.read(creds(srv, { filter: 'flt-1' }));
  assert.equal(info.product, 'dl2');
  assert.equal(info.serial, '001e66000abc');
  assert.equal(parseLive(data).packets.length, 1);
  assert.deepEqual(
    srv.requests.map((r) => `${r.method} ${r.path}`),
    [`GET ${PATHS.INFO}`, `GET ${PATHS.DLX}`],
  );
  assert.deepEqual(srv.requests[1].query, {
    sessionAuthUsername: 'admin',
    sessionAuthPassword: PASSWORD,
    filter: 'flt-1',
  });
  assert.equal(srv.requests[0].query.sessionAuthPassword, undefined, 'never to the information');
});

test('DL2 without a password (a guest, the json-live-data-server): no credentials sent', async (t) => {
  const srv = await dl2();
  t.after(() => srv.close());
  await new ResolClient().read(creds(srv, { password: '' }));
  assert.deepEqual(srv.requests[1].query, {});
});

test('KM2 / DL2Plus: JSON-RPC log-in, then dataGetCurrentData with its authId', async (t) => {
  const srv = await km2();
  t.after(() => srv.close());
  const { info, data } = await new ResolClient().read(creds(srv));
  assert.equal(info.product, 'km2');
  assert.equal(parseLive(data).packets.length, 1);
  const [, login, current] = srv.requests;
  assert.deepEqual(login.json, [
    {
      id: '1',
      jsonrpc: '2.0',
      method: 'login',
      params: { username: 'admin', password: PASSWORD },
    },
  ]);
  assert.equal(login.headers['content-type'], 'application/json');
  assert.deepEqual(current.json[0].params, { authId: 'abc123' });
});

test('KM2 without a password: nothing but the information is asked', async (t) => {
  const srv = await km2();
  t.after(() => srv.close());
  await rejectsWith(new ResolClient().read(creds(srv, { password: '' })), 'password_needed');
  assert.equal(srv.requests.length, 1);
});

test('refused: an error to the log-in, or HTTP 401 / 403', async (t) => {
  const srv = await km2();
  t.after(() => srv.close());
  await rejectsWith(new ResolClient().read(creds(srv, { password: 'wrong' })), 'refused');
  assert.equal(srv.requests.length, 2, 'no data asked after a refused log-in');
  for (const status of [401, 403]) {
    const dl = await dl2({ [`GET ${PATHS.DLX}`]: reply(status, 'no') });
    t.after(() => dl.close());
    await rejectsWith(new ResolClient().read(creds(dl)), 'refused');
  }
});

test('KM2: the data refused after a log-in accepted is no refusal', async (t) => {
  const srv = await km2();
  t.after(() => srv.close());
  srv.routes[`POST ${PATHS.KM2}`] = (r) =>
    r.json[0].method === 'login'
      ? [{ id: '1', result: { authId: 'abc123' } }]
      : [{ id: '1', error: { message: 'x' } }];
  await rejectsWith(new ResolClient().read(creds(srv)), 'denied');
});

test('an unknown filter (InvalidFilterID) is no refusal; another status is "http"', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.DLX}`]: reply(500, 'InvalidFilterID') });
  t.after(() => srv.close());
  await rejectsWith(new ResolClient().read(creds(srv, { filter: 'x' })), 'filter');
  srv.routes[`GET ${PATHS.DLX}`] = reply(502, 'bad gateway');
  const err = await rejectsWith(new ResolClient().read(creds(srv)), 'http');
  assert.equal(err.status, 502);
});

test('not a RESOL data logger: 404, an answer without product or serial, a KM1', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.INFO}`]: reply(404, 'not found') });
  t.after(() => srv.close());
  await rejectsWith(new ResolClient().read(creds(srv)), 'not_resol');
  srv.routes[`GET ${PATHS.INFO}`] = reply(200, '<html>router</html>');
  await rejectsWith(new ResolClient().read(creds(srv)), 'not_resol');
  srv.routes[`GET ${PATHS.INFO}`] = reply(200, infoText({ product: 'KM1' }));
  const err = await rejectsWith(new ResolClient().read(creds(srv)), 'unsupported');
  assert.equal(err.product, 'km1');
  assert.equal(srv.count(`GET ${PATHS.DLX}`), 0, 'nothing else asked');
});

test('not JSON, or not an object: protocol', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.DLX}`]: reply(200, 'hello') });
  t.after(() => srv.close());
  await rejectsWith(new ResolClient().read(creds(srv)), 'protocol');
  srv.routes[`GET ${PATHS.DLX}`] = [1, 2];
  await rejectsWith(new ResolClient().read(creds(srv)), 'protocol');
});

test('an answer too large is cut while read; a Content-Length too large before', async (t) => {
  const srv = await dl2();
  t.after(() => srv.close());
  srv.bigBody = 3 * 1024 * 1024;
  await rejectsWith(new ResolClient().read(creds(srv)), 'size');
  let written = 0;
  const liar = createServer((req, res) => {
    res.writeHead(200, { 'content-length': String(50 * 1024 * 1024) });
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const pump = () => {
      while (written < 50 * 1024 * 1024 && res.write(chunk)) written += chunk.length;
    };
    res.on('drain', pump);
    pump();
  });
  await new Promise((resolve) => liar.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    liar.closeAllConnections();
    liar.close();
  });
  await rejectsWith(new ResolClient().read({ ...creds(srv), port: liar.address().port }), 'size');
  assert.ok(written < 10 * 1024 * 1024, `stopped early: ${written} bytes`);
});

test('no answer: timeout of the request, and of the whole read', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.DLX}`]: 'silent' });
  t.after(() => srv.close());
  const started = performance.now();
  await rejectsWith(new ResolClient({ requestTimeout: 200 }).read(creds(srv)), 'timeout');
  assert.ok(performance.now() - started < 2000);
  await rejectsWith(
    new ResolClient({ requestTimeout: 5000, readTimeout: 200 }).read(creds(srv)),
    'timeout',
  );
});

test('one read at a time; abort() cuts it', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.DLX}`]: 'silent' });
  t.after(() => srv.close());
  const client = new ResolClient();
  const running = client.read(creds(srv));
  await rejectsWith(client.read(creds(srv)), 'busy');
  await new Promise((resolve) => setTimeout(resolve, 50));
  client.abort();
  await rejectsWith(running, 'aborted');
  // Free again.
  srv.routes[`GET ${PATHS.DLX}`] = liveData();
  await client.read(creds(srv));
});

test('unreachable: a port that refuses', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  await rejectsWith(
    new ResolClient().read({ host: '127.0.0.1', port, username: 'a', password: 'b' }),
    'unreachable',
  );
});

test('a dropped connection is "closed"; a reply that is not HTTP is "protocol"', async (t) => {
  const srv = await dl2({ [`GET ${PATHS.DLX}`]: 'drop' });
  t.after(() => srv.close());
  const err = await new ResolClient().read(creds(srv)).catch((e) => e);
  assert.ok(['closed', 'unreachable'].includes(err.code), err.code);
});
