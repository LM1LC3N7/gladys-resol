# TODO

## Before announcing

- [x] Review r1 (2026-10-28): REFUSÉ, 0 blocker, 4 important, 6 minor; fixed
      (`Fix r1 review`), to be checked by r2.
- [ ] Test on a real Gladys 5.1+ with a real KM2 or DL2 / DL3 and a DeltaSol:
      test button, device creation, the counters over a day (and a midnight).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real system (built without one)

- [ ] What a DL2 / DL3 answers to wrong credentials on `/dlx/download/live`
      (taken as a refusal: 401 / 403 only; anything else is retried).
- [ ] The JSON-RPC answer of a KM2 to a wrong password (taken as a refusal:
      an `error` object to `login`) and whether a KM2 keeps a session per
      log-in (one log-in per read, as hass-Deltasol-KM2).
- [ ] That the KM2 answer to `dataGetCurrentData` carries `unit_code`,
      `header_index`, `field_index` and the text `value` (the unit text and
      the positions are used when absent, as hass-Deltasol-KM2 does).
- [ ] The packet time stamps of a KM2 (a packet without one is never taken as
      stale).
- [ ] The names of the counters of a period in the languages of the VSF
      (all the en/de/fr names of the resol-vbus VSF are classified in
      `test/fixtures/vsf-names.json`; a name not recognized is taken as a
      lifetime counter: held at its reset, never published as a drop).
- [ ] The JSON-RPC error codes of a KM2 to a wrong password (the standard
      protocol errors -32700 and -32600 to -32603 are taken as no refusal).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-resol:0.1.0`); the
  Release workflow owns them from now on.
- **SDK**: `@gladysassistant/integration-sdk` 0.16.0, the latest published
  (registry checked on 2026-10-28). `gladys_version: ">=5.1.0"`, categories
  `climate` and `energy`; no `keywords` nor `countries` in the manifest (home
  market: DE, AT, CH, and the rest of Europe).
- **Reused project**: hass-Deltasol-KM2 (dm82m, MIT, 1.2.4, commit 55e610d of
  2026-10-14, LICENSE read: MIT, copyright 2021 Dirk Maucher), cloned
  read-only in `~/code/ref/lot18/hass-Deltasol-KM2`: product detection, KM2
  JSON-RPC, DLx live data, user `admin`, port 80, filter, one device per
  packet. Not ported: its YAML import, its diagnostics, its single-quoted
  JSON and unencoded query (fixed here). The DLx format checked against
  resol-vbus (MIT, `docs/dlx-data-download-api.md`, `src/dlx-json-converter.js`,
  the json-live-data-server), no code copied nor run.
- **KM1, VBus/LAN, VBus/USB**: only through the resol-vbus
  `json-live-data-server` (it presents itself as a DL2); said in the manifest,
  the docs and the status of a device that has no
  `get_resol_device_information`.
- **Heat is not electricity**: the heat quantities are plain sensors (kWh in
  the name), never `energy-sensor` nor an index of the energy monitoring.
- **Lifetime counters** (review r1, I1, I2): names read word by word
  (CamelCase, `_`); energy (Wh, kWh, MWh, BTU → kWh) whose name is not of a
  period (unknown = lifetime); hours (h) but the settings in hours (rise
  time, dt); operating seconds (by their words: operating, Betriebssekunden,
  fonctionnement, BSR/OSR/HFR...) turned into hours (`<id>_s2h_total`);
  total volumes (l, m³, gallons → l) but the maximums. Guard of
  gladys-openems with `rate`/`slack` (energy 200 kWh/h + 2 kWh, hours 1 h/h +
  2 h, volumes 20 m³/h + 100 l); two-click acceptance; an accepted value is a
  floor (a value below it is held again, review r1 m1). A counter split in Wh
  / kWh / MWh fields is dropped next to its total, else put back together
  (`<id of the first piece>_sum_kwh_total`).
- **Units**: only the units listed in `src/devices.js` are published;
  temperatures (°C, °F converted) and pressures are typed sensors, the rest
  plain with the unit in the name; no unit, CO₂ savings and unknown units are
  not published.
- **Freshness**: a packet whose device time stamp has not moved for 15 min
  (monotonic), or 15 min older than the answer, is no longer published; the
  time stamps and when they moved are kept in /data (64 packets at most), so
  that a packet frozen before a restart stays stale (a date in the future
  is taken as old: stale until the time stamp moves).
- **Refusal** (review r1, m2-m4): only a 401 / 403 to the log-in or to the
  live data, or a JSON-RPC error to the log-in other than the standard
  protocol errors; with no password set, the status says the device asks
  for one.
- **Password optional**: a DL2 / DL3 may let a guest read; a KM2 without a
  password is an error (retried), not a configuration problem, since the
  product is known only after the first request.
- **Reading interval**: 60 s by default, 60 to 900 s (hass-Deltasol-KM2:
  minimum 60 s).
