# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## hass-Deltasol-KM2 (dm82m/hass-Deltasol-KM2)

<https://github.com/dm82m/hass-Deltasol-KM2>, the Home Assistant integration
of RESOL KM1/KM2, DL2/DL2Plus/DL3, VBus/LAN and VBus/USB (HACS). Version
1.2.4, branch `master` at commit 55e610d (2026-10-14). MIT License, copyright
(c) 2021 Dirk Maucher (full text below).

Ported to JavaScript in `src/resol/client.js`, `src/resol/model.js`,
`src/devices.js`, `src/constants.js` and `src/config.js`: the detection of the
product through `/cgi-bin/get_resol_device_information` (`product`, `serial`,
`version`... as `key = "value"` lines), the KM2 / DL2Plus path (JSON-RPC
`login` with the user name and the password of the web interface, then
`dataGetCurrentData` with the `authId`, on `/cgi-bin/resol-webservice`), the
DL2 / DL3 path (`/dlx/download/live` with `sessionAuthUsername`,
`sessionAuthPassword` and `filter`), the reading of the `headers` and
`headersets` of the answer, one device per VBus packet, the user name
`admin` and the port 80 by default (`deltasolapi.py`, `__init__.py`,
`sensor.py`, `const.py`, `config_flow.py`). Changed here: proper JSON and
URL encoding of the credentials, the values matched by `header_index` and
`field_index`, a missing value never read as 0, bounded answers, no secret
logged, read-only, the lifetime counters guarded.

The DLx JSON format and the emulation of a DL2 by the json-live-data-server
were checked against the documentation and the sources of resol-vbus
(<https://github.com/danielwippermann/resol-vbus>, MIT License, copyright (c)
2013-present Daniel Wippermann); no code of it is copied nor run.

```
MIT License

Copyright (c) 2021 Dirk Maucher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
