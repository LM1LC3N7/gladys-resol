# gladys-resol

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**RESOL** solar and heating controllers (DeltaSol and the other devices of the
VBus), read locally through the HTTP API of a **KM2**, **DL2**, **DL2Plus** or
**DL3**. Read-only. Not affiliated with RESOL.

**Never tested with a real device.** Feedback welcome.

- One device per controller or module on the VBus, with the names of its VBus
  specification file (VSF).
- Temperatures, pressures, pump speeds, flows, powers and the other values
  with a unit.
- Lifetime heat quantities (kWh), operating hours (h, also from the operating
  seconds) and total volumes (l, m³), each guarded: never 0, never a drop nor
  an implausible jump without a two-click acceptance. Counter names read word
  by word as the VSF writes them (`Wmz1_ValueToday_Wh`), counters split in
  Wh / kWh / MWh put back together.
- KM1 and VBus/LAN adapters through the resol-vbus `json-live-data-server`.
- No cloud, one read at a time, never faster than the interval (except right
  after a new address or new credentials are saved).

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint && npm run format:check
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules,
[TODO.md](TODO.md) for the decisions and what is left to check on a real
system.

## License

Apache-2.0 (see `LICENSE`). Requests ported from
[hass-Deltasol-KM2](https://github.com/dm82m/hass-Deltasol-KM2) (MIT); see
`THIRD_PARTY_NOTICES.md`.
