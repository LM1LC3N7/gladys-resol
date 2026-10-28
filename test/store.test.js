import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore, fingerprint, readState } from '../src/store.js';

test('the file store: absent is empty, unreadable or broken is NOT empty, writes are atomic', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'resol-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(store.load(), { data: {} });
  await store.save({ a: 1 });
  assert.deepEqual(store.load(), { data: { a: 1 } });
  await writeFile(file, '{broken');
  assert.deepEqual(store.load(), { unreadable: true });
  await writeFile(file, '[1]');
  assert.deepEqual(store.load(), { unreadable: true });
  if (process.getuid?.() !== 0) {
    await writeFile(file, '{"a":2}');
    await chmod(file, 0o000);
    assert.deepEqual(store.load(), { unreadable: true });
    await chmod(file, 0o600);
  }
  assert.equal(JSON.parse(await readFile(file, 'utf8')).a, 2);
});

test('readState: sanitized, never in the future, no prototype, only counter ids', () => {
  const now = Date.UTC(2026, 9, 24);
  const state = readState(
    {
      address: '10.0.0.5:80',
      lastAttemptAt: now + 1e9,
      refusal: { code: 'refused', fp: 'ab' },
      info: { serial: '001e66000abc', product: 'dl2', version: '2.1.0', other: 'x' },
      counters: {
        'ext:resol:resol:001e66000abc_00_0010_7e11_0100:020_4_0_kwh_total': { guard: {} },
        __proto__: { guard: {} },
        'ext:resol:resol:001e66000abc_00_0010_7e11_0100:../x': {},
      },
    },
    now,
  );
  assert.equal(state.lastAttemptAt, now);
  assert.deepEqual(state.refusal, { code: 'refused', fp: 'ab' });
  assert.deepEqual(state.info, { serial: '001e66000abc', product: 'dl2', version: '2.1.0' });
  assert.deepEqual(Object.keys(state.counters), [
    'ext:resol:resol:001e66000abc_00_0010_7e11_0100:020_4_0_kwh_total',
  ]);
  assert.equal(readState({ info: { serial: '../x', product: 'dl2' } }, now).info, null);
  assert.equal(Object.getPrototypeOf(state.counters), null);
  assert.equal(
    readState({ refusal: { code: 'refused', fp: 'ab' } }, now).refusal,
    null,
    'no address',
  );
  assert.equal(readState({ address: 'a', refusal: { code: 'x', fp: 'ab' } }, now).refusal, null);
});

test('the fingerprint of a refusal: 8 bits, salted, many passwords share it', () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const fp = fingerprint(salt, 'a:80', { username: 'admin', password: 'user' });
  assert.match(fp, /^[0-9a-f]{2}$/);
  // A brute force soon finds another password with the same fingerprint (1 in 256).
  let other;
  for (let i = 0; i < 4000 && other === undefined; i += 1) {
    if (fingerprint(salt, 'a:80', { username: 'admin', password: `p${i}` }) === fp) other = i;
  }
  assert.notEqual(other, undefined);
});

test('readState: the packets seen, a date in the future taken as old', () => {
  const now = Date.UTC(2026, 9, 24);
  const state = readState(
    {
      packets: {
        '001e66000abc_00_0010_7e11_0100': { at: 5, changedAt: now - 1000 },
        '001e66000abc_00_0010_7e12_0100': { at: 5, changedAt: now + 1000 },
        'bad:key': { at: 5, changedAt: now },
        '001e66000abc_00_0010_7e13_0100': { at: 'x', changedAt: now },
      },
    },
    now,
  );
  assert.deepEqual(
    { ...state.packets },
    {
      '001e66000abc_00_0010_7e11_0100': { at: 5, changedAt: now - 1000 },
      '001e66000abc_00_0010_7e12_0100': { at: 5, changedAt: 0 },
    },
  );
});
