# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0]

### Changed
- Tags are now entered only in the PLC config node's **Variables** tab. The read and write nodes pick from that list.
- Removed the manual tag, element count and data type fields from the read and write nodes.
- `msg.tag` and `msg.dataType` input overrides were removed. `msg.variable` remains.

### Added
- **Elements** column in the variable editor for reading array slices.

## [1.0.0]

### Added
- Initial release: dependency-free EtherNet/IP client for Micro800 (no backplane routing).
- `micro800-config`, `micro800-read` and `micro800-write` nodes.
- Variables tab with an editable, sortable tag list.
- Single and all-variables read modes, polling with change detection, automatic reconnect.
