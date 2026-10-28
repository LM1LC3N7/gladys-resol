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
  quantities and operating hours through a guard (never 0, never a drop nor
  a jump without the two-click "Accept the held counter" action).
- Refused credentials kept as a final stop; test button; stale VBus packets
  no longer published.
