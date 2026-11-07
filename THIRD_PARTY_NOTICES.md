# Third-party notices

Signal-Sketch itself is licensed under the MIT License (see [LICENSE](LICENSE)). Its build output (`dist/index.html`) is a single file that contains the third-party software listed below and nothing else from outside this repository. Its license requires that this notice and the license text accompany copies of it; the build adds both to the top of the HTML file.

## maxGraph

- Package: `@maxgraph/core` 0.25.1
- Purpose: the diagram canvas (drawing, selection, connection handling)
- License: Apache License 2.0 — the full text is in [licenses/maxGraph-LICENSE.txt](licenses/maxGraph-LICENSE.txt)
- Project: https://github.com/maxGraph/maxGraph
- Copyright holders named in maxGraph's source files: The maxGraph project Contributors (2021-present), JGraph Ltd (2006-2020), Gaudenz Alder (2006-2018) and draw.io AG (2006-2020). maxGraph is derived from mxGraph (Apache License 2.0). The files are used unmodified.
- maxGraph has no runtime dependencies, and no `NOTICE` file.

## Development tools (not distributed)

The following are used only to build and test the project and are not part of `dist/index.html`: TypeScript, Vite, `vite-plugin-singlefile`, Vitest and their dependencies. Their licenses (MIT, Apache-2.0, BSD-3-Clause, ISC, MPL-2.0) apply to those tools only.

## Trademarks

Product and company names mentioned in this project (for example PowerPoint, Excel, Edge, Chrome, Firefox, Safari, HDMI, USB) are trademarks or registered trademarks of their respective owners. They are used only to describe compatibility and are not affiliated with or endorsed by this project. The device names and model numbers in the sample files (`Model-A1` and so on) are fictitious.

## Fonts

The app does not bundle any font. The names of fonts that appear in the CSS and in exported SVG (a `font-family` fallback list) only ask the viewer's system for a font it may already have, so that Japanese text in an SVG pasted into PowerPoint is displayed with a suitable installed font.
