// -----------------------------------------------------------------------------
// The only network access: one read of a RESOL KM2, DL2, DL2Plus or DL3 over
// its local HTTP API, one request at a time (requests ported from
// hass-Deltasol-KM2, MIT, see THIRD_PARTY_NOTICES.md):
//
// 1. GET /cgi-bin/get_resol_device_information: the product and the serial
//    number (the identity of every read);
// 2. KM2 and DL2Plus: POST /cgi-bin/resol-webservice, a JSON-RPC `login`
//    (user name and password of the web interface), then
//    `dataGetCurrentData` with the authId it gives;
//    DL2 and DL3: GET /dlx/download/live, with `sessionAuthUsername` and
//    `sessionAuthPassword` when a password is set (the API of the data
//    logger takes them in the query) and the `filter` of the configuration.
//
// READ-ONLY: nothing else is ever sent (no setting, no write). Every answer is
// bounded in size (refused from its Content-Length before reading, cut when
// it goes beyond) and in time (each request, and the whole read). The errors
// are our own codes (ResolError): never the address, the path (it may hold
// the password), a text of the device nor a secret.
// -----------------------------------------------------------------------------

import http from 'node:http';
import {
  MAX_DATA_BYTES,
  MAX_INFO_BYTES,
  MAX_LOGIN_BYTES,
  PATHS,
  PRODUCTS,
  READ_TIMEOUT,
  REQUEST_TIMEOUT,
} from '../constants.js';
import { parseInfo } from './model.js';

/**
 * A failed read. `code`:
 * - `unreachable`, `timeout`, `closed`: no (complete) answer;
 * - `not_resol`: no get_resol_device_information (wrong address, a KM1, a
 *   VBus/LAN adapter without the json-live-data-server);
 * - `unsupported`: a RESOL product this integration does not read (`product`);
 * - `protocol`: an answer that is not the API expected;
 * - `password_needed`: a KM2 / DL2Plus and no password in the configuration
 *   (nothing sent to it);
 * - `refused`: the user name or the password refused (HTTP 401 / 403 to the
 *   log-in or the live data, or an error answered to the JSON-RPC log-in but
 *   the standard protocol errors -32700 and -32600 to -32603);
 * - `denied`: the log-in accepted, the data refused;
 * - `filter`: the DL2 / DL3 does not know the filter (InvalidFilterID);
 * - `http`: another HTTP status (`status`);
 * - `size`: an answer too large;
 * - `busy`: a read is already running (never two at once);
 * - `aborted`: stopped by `abort()`.
 */
export class ResolError extends Error {
  constructor(code, { status, product } = {}) {
    super(code);
    this.name = 'ResolError';
    this.code = code;
    this.status = status;
    this.product = product;
  }
}

const NETWORK = {
  ECONNREFUSED: 'unreachable',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  ENOTFOUND: 'unreachable',
  EAI_AGAIN: 'unreachable',
  ETIMEDOUT: 'timeout',
  ECONNRESET: 'closed',
  EPIPE: 'closed',
  HPE_INVALID_CONSTANT: 'protocol',
};

/** A socket error -> ResolError, from its code only (Node's own message holds the address). */
export function networkError(err) {
  if (err instanceof ResolError) return err;
  if (err?.name === 'AbortError') return new ResolError('aborted');
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code.startsWith('HPE_')) return new ResolError('protocol');
  return new ResolError(NETWORK[code] ?? 'unreachable');
}

/**
 * One HTTP request: resolves `{ status, body }` (body: a Buffer, at most
 * `maxBytes`) whatever the status. Settles once; cut by `signal` and by
 * `timeout`.
 */
export function httpRequest(
  { host, port, method = 'GET', path, headers = {}, body, maxBytes, timeout = REQUEST_TIMEOUT },
  signal,
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    let timer;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const fail = (err) => {
      done(reject, err);
      req?.destroy();
    };
    const onAbort = () => fail(new ResolError('aborted'));
    if (signal?.aborted) {
      reject(new ResolError('aborted'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
    try {
      req = http.request(
        {
          host,
          port,
          method,
          path,
          headers: {
            Accept: 'application/json, text/plain',
            Connection: 'close',
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
              : {}),
            ...headers,
          },
          agent: false,
        },
        (res) => {
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > maxBytes) {
            fail(new ResolError('size'));
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              fail(new ResolError('size'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            done(resolve, { status: res.statusCode, body: Buffer.concat(chunks) }),
          );
          res.on('aborted', () => fail(new ResolError('closed')));
          res.on('error', (err) => fail(networkError(err)));
        },
      );
    } catch {
      done(reject, new ResolError('unreachable'));
      return;
    }
    timer = setTimeout(() => fail(new ResolError('timeout')), timeout);
    req.on('error', (err) => fail(networkError(err)));
    req.end(payload);
  });
}

/** JSON of an answer body, or a `protocol` error. */
function jsonOf(body) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new ResolError('protocol');
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The first reply of a JSON-RPC answer (a batch of one, or a plain reply). */
function firstReply(answer) {
  const reply = Array.isArray(answer) ? answer[0] : answer;
  if (!isObject(reply)) throw new ResolError('protocol');
  return reply;
}

/** An authId: a short printable token (never logged). */
// eslint-disable-next-line no-control-regex
const AUTH_ID = /^[^\u0000-\u0020\u007f]{1,256}$/;

export class ResolClient {
  constructor({
    request = httpRequest,
    requestTimeout = REQUEST_TIMEOUT,
    readTimeout = READ_TIMEOUT,
  } = {}) {
    this.request = request;
    this.requestTimeout = requestTimeout;
    this.readTimeout = readTimeout;
    this.controller = undefined;
  }

  /** Cuts the read running, if any (one connection at a time: a stop ends it). */
  abort() {
    this.controller?.abort();
  }

  /**
   * One read. `credentials`: `{ host, port, username, password, filter }`.
   * Resolves `{ info, data }`: the device information (src/resol/model.js
   * parseInfo) and the live data as answered (parsed by the app).
   */
  async read(credentials) {
    if (this.controller) {
      throw new ResolError('busy');
    }
    const controller = new AbortController();
    this.controller = controller;
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      controller.abort();
    }, this.readTimeout);
    try {
      return await this.session(credentials, controller.signal);
    } catch (err) {
      const error = networkError(err);
      // Cut by the bound of the whole read: no answer in time.
      throw error.code === 'aborted' && late ? new ResolError('timeout') : error;
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async session({ host, port, username, password, filter }, signal) {
    const call = (options) =>
      this.request({ host, port, timeout: this.requestTimeout, ...options }, signal);
    const infoAnswer = await call({ path: PATHS.INFO, maxBytes: MAX_INFO_BYTES });
    if (infoAnswer.status === 404) throw new ResolError('not_resol');
    // No credential goes with this request: a 401 / 403 here is no refusal (review r1, m2).
    if (infoAnswer.status !== 200) throw new ResolError('http', { status: infoAnswer.status });
    const info = parseInfo(infoAnswer.body.toString('utf8'));
    if (!info) throw new ResolError('not_resol');
    const kind = Object.hasOwn(PRODUCTS, info.product) ? PRODUCTS[info.product] : undefined;
    if (!kind) throw new ResolError('unsupported', { product: info.product });
    const data =
      kind === 'km2'
        ? await this.km2(call, { username, password })
        : await this.dlx(call, { username, password, filter });
    return { info, data };
  }

  /** KM2 / DL2Plus: JSON-RPC log-in, then the current data. */
  async km2(call, { username, password }) {
    if (!password) throw new ResolError('password_needed');
    const rpc = (method, params) =>
      call({
        method: 'POST',
        path: PATHS.KM2,
        body: JSON.stringify([{ id: '1', jsonrpc: '2.0', method, params }]),
        maxBytes: method === 'login' ? MAX_LOGIN_BYTES : MAX_DATA_BYTES,
      });
    const login = await rpc('login', { username, password });
    if (login.status === 401 || login.status === 403) throw new ResolError('refused');
    if (login.status !== 200) throw new ResolError('http', { status: login.status });
    const loginReply = firstReply(jsonOf(login.body));
    if (loginReply.error !== undefined && loginReply.error !== null) {
      // The JSON-RPC errors of the protocol itself (parse error, invalid
      // request, unknown method, invalid params, internal error) are no
      // refusal (review r1, m3); any other error to the log-in is.
      const code = loginReply.error?.code;
      if (Number.isInteger(code) && (code === -32700 || (code <= -32600 && code >= -32603))) {
        throw new ResolError('protocol');
      }
      throw new ResolError('refused');
    }
    const authId = loginReply.result?.authId;
    if (typeof authId !== 'string' || !AUTH_ID.test(authId)) {
      throw new ResolError('protocol');
    }
    const answer = await rpc('dataGetCurrentData', { authId });
    if (answer.status === 401 || answer.status === 403) throw new ResolError('denied');
    if (answer.status !== 200) throw new ResolError('http', { status: answer.status });
    const reply = firstReply(jsonOf(answer.body));
    if (reply.error !== undefined && reply.error !== null) throw new ResolError('denied');
    if (!isObject(reply.result)) throw new ResolError('protocol');
    return reply.result;
  }

  /** DL2 / DL3: the live data, the credentials in the query when a password is set. */
  async dlx(call, { username, password, filter }) {
    const query = new URLSearchParams();
    if (password) {
      query.set('sessionAuthUsername', username);
      query.set('sessionAuthPassword', password);
    }
    if (filter) query.set('filter', filter);
    const search = query.toString();
    const answer = await call({
      path: search ? `${PATHS.DLX}?${search}` : PATHS.DLX,
      maxBytes: MAX_DATA_BYTES,
    });
    if (answer.status === 401 || answer.status === 403) throw new ResolError('refused');
    if (answer.status === 500 && answer.body.includes('InvalidFilterID')) {
      throw new ResolError('filter');
    }
    if (answer.status !== 200) throw new ResolError('http', { status: answer.status });
    const data = jsonOf(answer.body);
    if (!isObject(data)) throw new ResolError('protocol');
    return data;
  }
}
