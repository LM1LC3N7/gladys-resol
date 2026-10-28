import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress } from '../src/config.js';

test('addresses: host, port 80 by default, pasted http URL, IPv6; never https, credentials nor broadcast', () => {
  assert.equal(parseAddress('192.168.1.70').address, '192.168.1.70:80');
  assert.equal(parseAddress('http://DL2.local:8080/dlx/').address, 'dl2.local:8080');
  assert.equal(parseAddress('[fe80::1]:80').address, '[fe80::1]:80');
  assert.equal(parseAddress('fe80::1').address, '[fe80::1]:80');
  assert.deepEqual(parseAddress(''), { empty: true });
  assert.deepEqual(parseAddress('https://192.168.1.70'), { error: 'https' });
  for (const bad of [
    'u:p@host',
    'a b',
    'host:0',
    'host:70000',
    '0.0.0.0',
    '255.255.255.255',
    '239.1.2.3',
    'ftp://host',
  ]) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
});

test('the form: user name "admin" when empty, password optional and never trimmed', () => {
  const c = normalizeConfig({ address: '10.0.0.5', password: ' pass ' });
  assert.equal(c.username, 'admin');
  assert.equal(c.password, ' pass ');
  assert.equal(c.filter, '');
  assert.equal(c.problem, undefined);
  assert.equal(c.pollInterval, 60);
  assert.equal(normalizeConfig({ address: '10.0.0.5' }).password, '', 'a guest');
  assert.equal(
    normalizeConfig({ address: '10.0.0.5', password: 'a\rb' }).problem,
    'password_invalid',
  );
  assert.equal(
    normalizeConfig({ address: '10.0.0.5', username: 'a\nb', password: 'p' }).problem,
    'username_invalid',
  );
  assert.equal(normalizeConfig({ address: '10.0.0.5', filter: 'a&b=c' }).problem, 'filter_invalid');
  assert.equal(normalizeConfig({ address: '10.0.0.5', filter: ' 3 ' }).filter, '3');
  assert.equal(normalizeConfig({ address: 'https://10.0.0.5' }).problem, 'address_https');
  assert.equal(normalizeConfig({}).problem, 'address_missing');
  // No secret kept when the form has a problem.
  assert.equal(normalizeConfig({ address: 'u:p@h', password: 'p' }).password, undefined);
});

test('the interval: 60 to 900 s', () => {
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: '120' }).pollInterval, 120);
  assert.equal(normalizeConfig({ poll_interval: 9999 }).pollInterval, 900);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 60);
});

test('the configuration never reads a key prefixed with gladys_', () => {
  const c = normalizeConfig({ gladys_address: '10.0.0.5', gladys_password: 'p' });
  assert.equal(c.problem, 'address_missing');
});
