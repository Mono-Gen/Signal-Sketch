# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**. Describe what you found, how to reproduce it (a sample file helps), and what you expect the impact to be.

This is a small personal project, so replies are best-effort and there is no guaranteed response time.

## Supported versions

Only the latest commit on the `main` branch is supported.

## What matters here

Signal-Sketch is a single HTML file that runs entirely in the browser. It makes no network requests and stores only the language and color theme settings. The realistic risks are therefore about the files it opens:

- a crafted diagram (`.json`) or device list (`.csv`) that makes the page run script, or that shows unescaped content
- a crafted file that freezes the tab or uses an excessive amount of memory
- anything that makes the app send data somewhere

Reports about these are welcome. The build carries a Content-Security-Policy that forbids network access, and the code limits file sizes, quantities and port counts; see the "Security notes" in the [README](README.md).

## For maintainers

- Dependencies are pinned to exact versions and installed with `npm ci`. Run `npm run audit` before releasing.
- The distributed build must not contain the `window.__app` test hook (only `npm run build:e2e` does).
