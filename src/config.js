// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The password is a secret: it is never logged, shown, written to /data nor
// put in an error; it only goes to the configured address, in the log-in of a
// KM2 / DL2Plus or in the request of a DL2 / DL3 (the API of the device).
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, POLL_DEFAULT, POLL_MAX, POLL_MIN } from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** The user name of the web interface of the KM2 and the data loggers when none is typed. */
export const DEFAULT_USERNAME = 'admin';

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port (80 when absent). A pasted http:// URL is reduced to its host
 * and port; https:// is refused (the devices answer in plain HTTP on the home
 * network, and the password would not go where the user thinks).
 * @returns {{ address: string, host: string, port: number } | { error: 'invalid' | 'https' } | { empty: true }}
 *   `address` is always `host:port` (the host of an IPv6 address in brackets).
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { empty: true };
  }
  if (text.length > 300) {
    return { error: 'invalid' };
  }
  if (/^https:\/\//i.test(text)) {
    return { error: 'https' };
  }
  text = text.replace(/^http:\/\//i, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return { error: 'invalid' };
  }
  text = text.replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(bracketed[1].toLowerCase(), bracketed[2], true);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return withPort(text.toLowerCase(), undefined, true);
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  if (
    host === '0.0.0.0' ||
    host === '255.255.255.255' ||
    /^(22[4-9]|23\d|24\d|25[0-5])\./.test(host)
  ) {
    // Neither "any address" nor a multicast or broadcast range: never a device.
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2], false);
}

function withPort(host, port, ipv6) {
  const number = port === undefined ? DEFAULT_PORT : Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: `${ipv6 ? `[${host}]` : host}:${number}`, host, port: number };
}

/** Any C0 control character or DEL: never in a name, a secret nor a filter. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A text of the form: a string, else ''. */
const textOf = (raw) => (typeof raw === 'string' ? raw : '');

/** The user name: trimmed, "admin" when empty, 64 characters at most, no control character. */
function usernameOf(raw) {
  const value = textOf(raw).trim();
  if (value === '') return { value: DEFAULT_USERNAME };
  return value.length <= 64 && !CONTROL.test(value) ? { value } : { invalid: true };
}

/** The password: never trimmed (a space may be part of it), 128 characters at most; '' = none. */
function passwordOf(raw) {
  const value = textOf(raw);
  if (value === '') return { value: '' };
  return value.length <= 128 && !CONTROL.test(value) ? { value } : { invalid: true };
}

/** The filter of a DL2 / DL3 (its id, as the data logger shows it): letters, digits, - and _. */
function filterOf(raw) {
  const value = textOf(raw).trim();
  if (value === '') return { value: '' };
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? { value } : { invalid: true };
}

/** The reading interval (s): a number from 60 to 900, else 60. */
function pollOf(raw) {
  const value = typeof raw === 'string' && /^\d{1,6}$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return POLL_DEFAULT;
  }
  return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(value)));
}

/**
 * `{ address, host, port, username, password, filter, pollInterval, problem }`.
 * The user name, the password and the filter are undefined when the form has
 * a problem: 'address_missing', 'address_invalid', 'address_https',
 * 'username_invalid', 'password_invalid', 'filter_invalid' or undefined. An
 * empty password is no problem (a data logger may let a guest read; a KM2
 * then says it needs one, src/resol/client.js).
 */
export function normalizeConfig(raw = {}) {
  const parsed = parseAddress(textOf(raw?.address));
  const username = usernameOf(raw?.username);
  const password = passwordOf(raw?.password);
  const filter = filterOf(raw?.filter);
  let problem;
  if (parsed.empty) problem = 'address_missing';
  else if (parsed.error === 'https') problem = 'address_https';
  else if (parsed.error) problem = 'address_invalid';
  else if (username.invalid) problem = 'username_invalid';
  else if (password.invalid) problem = 'password_invalid';
  else if (filter.invalid) problem = 'filter_invalid';
  return {
    address: parsed.address,
    host: parsed.host,
    port: parsed.port,
    username: problem ? undefined : username.value,
    password: problem ? undefined : password.value,
    filter: problem ? undefined : filter.value,
    pollInterval: pollOf(raw?.poll_interval),
    problem,
  };
}
