# Signal-Sketch

A diagram editor for audio, video, control and network system diagrams, aimed at pre-sales proposals and design documents.

Place devices, define their ports, and connect ports with the mouse. Lines are routed automatically and colored by signal type.

> Status: working prototype, being evaluated with its first users. The name is provisional.

## Features

- Devices with port groups (signal type, direction, side, count); ports can be moved one by one
- Port-to-port connections with automatic orthogonal routing, colored by signal type
- Issue list for suspicious connections (different signal types, input-to-input / output-to-output)
- Grouping frames (e.g. Rack, Table) whose membership follows position
- Editable legend (signal types)
- Adjustable page size (16:9 presets or custom) and zoom
- Devices with a quantity show one set of ports per unit
- Box-select several devices to delete, copy or move them together; Shift+drop a device from the palette to add several in a row
- Export: JSON (save/open), SVG and PNG (text kept as real text, so it pastes into PowerPoint), CSV device list
- Import a device list (CSV) to create a first draft of devices and frames (no connections); the header row must match the exported CSV exactly. Details in the user guide; a sample is in [docs/sample_devices.csv](docs/sample_devices.csv)
- Set your own images on devices (PNG / JPEG / WebP, stored inside the diagram file) and change device sizes
- Japanese / English UI switching
- Runs from a single HTML file opened in a browser: no server, no installation

Not yet available: registering reusable custom devices, multiple pages, direct `.pptx` export.

## Using it

Build it (see [Development](#development)), then open `dist/index.html` in Edge or Chrome. It starts with an empty diagram. See the user guide: [English](docs/manual_EN.md) / [日本語](docs/manual_JP.md).

Samples (all device names and model numbers in them are fictitious):

- [docs/sample_diagram.json](docs/sample_diagram.json): a small diagram. Use "Open" to load it.
- [docs/sample_devices.csv](docs/sample_devices.csv): an example device list for "Import device list".

## Project layout

| Path | Purpose |
|---|---|
| `src/` | Source code |
| `tests/` | Unit tests |
| `docs/` | User-facing documentation, a sample diagram and a sample device list |
| `licenses/` | License texts of bundled third-party software |
| `.github/` | Dependabot configuration |

## Development

Requires Node.js (developers only; end users need nothing but a browser).

```
npm ci             # installs exactly the versions in package-lock.json
npm run typecheck
npm test
npm run build      # produces dist/index.html, a single self-contained file
npm run audit      # checks the dependencies for known vulnerabilities
```

`npm run build:e2e` makes a separate build (`dist-e2e/`, not distributed) that exposes `window.__app` when opened with `?debug=1`, for automated browser checks. The normal build contains no such hook.

## Security notes

- The app runs entirely in the browser. It makes no network requests and sends no data anywhere; the only things it stores in the browser are your language and color theme (light/dark) settings.
- Files you open are checked before use (structure, the type of every field, references, and limits on file size, quantities, port counts and the size of a page), and every name from a file is escaped before it is shown. Even so, open diagram files only from sources you trust.
- The build output carries a Content-Security-Policy that forbids network access, external resources and form submission.
- CSV exports prefix values that start with `=`, `+`, `-` or `@` with `'` so spreadsheet software does not run them as formulas; the CSV import removes that mark again.

To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). You are free to use, copy, modify and distribute it.

## Third-party software and trademarks

The build output bundles [maxGraph](https://github.com/maxGraph/maxGraph) (Apache License 2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [licenses/](licenses/).

Images you set on devices are yours: you are responsible for the rights to them (copyright, trademarks and so on). The project ships no device images.

Product and company names mentioned here (for example PowerPoint, Excel, Edge, Chrome, Firefox, Safari, HDMI, USB) belong to their respective owners and are used only to describe compatibility. This project is not affiliated with them.

## Setup after cloning

Apply the local-only exclusions to `.git/info/exclude` (it is not shared through Git). Add these entries individually: `.sample/`, `.tasks/`, `.docs/`, `.agents/`, `.scratch/`, `.scripts/`, `.env`.
