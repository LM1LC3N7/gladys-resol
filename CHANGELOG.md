# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- RESOL KM2, DL2, DL2Plus and DL3 read locally (device information, then the
  live data), one Gladys device per VBus packet, read-only.
- Temperatures, pressures and the other values with a unit; lifetime heat
  quantities, operating hours (also from operating seconds) and total
  volumes through a guard (never 0, never a drop nor a jump without the
  two-click "Accept the held counter" action; an accepted value is a floor).
- The class of each counter of the VSF taken from a table built from its
  English, German and French names (the same whatever the language of the
  data logger), searched with the address masks of the VSF as resol-vbus
  does (the 2nd heat quantity module and the next ones too); counters of a
  period and settings stay plain; counters split in Wh / kWh / MWh put back
  together (published apart when a lower piece reads 1000 or more: the same
  counter in two units).
- Refused credentials kept as a final stop; test button; stale VBus packets
  no longer published.
