# FuckingFast Links Downloader (FF Resolver)

FF Resolver is a portable Windows application that converts
`fuckingfast.co` page links into their direct `dl.fuckingfast.co` URLs. It
processes links sequentially and collects the results without downloading the
files.

## Download

Download `FF-Resolver-1.0.0-Portable.exe` from the
[latest GitHub Release](../../releases/latest). No installation is required.

The repository contains the complete application source; compiled executables
are distributed through GitHub Releases rather than committed to the source tree.

## Requirements

- Windows 10 or 11
- Google Chrome or Microsoft Edge
- An internet connection

## Usage

1. Open the downloaded portable executable.
2. Paste one `https://fuckingfast.co/...` link per line.
3. Select **Add to queue**.
4. Keep the Chrome or Edge resolver window open. Complete any Cloudflare prompt
   if one appears.
5. Copy individual results, use **Copy all**, or export them to a text file.

The queue runs one link at a time. It can be paused, cleared, skipped, or
retried after failures.

## How it works

For each queued link, FF Resolver:

1. Opens the page in Chrome or Edge using a separate persistent browser profile.
2. Waits for Cloudflare verification.
3. Activates the page's direct-link request.
4. Observes the response through the Chrome DevTools Protocol and captures its
   `HX-Redirect` URL.
5. Blocks the resulting file request so the browser does not download the file.

The direct URLs may contain temporary server tokens, so use them reasonably
soon after resolving them.

## Local data and privacy

Queue state, results, failures, and the dedicated browser profile are stored
locally under the application's data directory. The resolver profile is separate
from your everyday browser profile, so the application does not use your normal
history, extensions, logins, or cookies.

The Chrome DevTools connection listens only on a temporary local
`127.0.0.1` port and closes with the resolver.

## Troubleshooting

- **The queue does not start:** Select **Resume queue** if it is paused.
- **The resolver appears stuck:** Check the browser window for a Cloudflare
  prompt and complete it manually.
- **The current link fails:** Keep the resolver window open, then use
  **Retry failures**.
- **Chrome or Edge cannot open:** Install either supported browser and restart
  FF Resolver.

Cloudflare and FuckingFast can change their behavior at any time, which may
require an application update.

## Build from source

Clone or download the repository, then run the following commands from the
project directory. Building requires Node.js and npm:

```powershell
npm install
npm run check
npm run dist
```

The portable executable is written to the local `release/` directory. This
generated directory is intended for local builds and GitHub Release artifacts,
not source control.

## Responsible use

FF Resolver only processes links supplied by the user. It does not search for,
host, or distribute files. You are responsible for ensuring that your use of the
application and any resolved links complies with applicable laws and the terms
of the relevant services.

This project is not affiliated with or endorsed by FuckingFast, Cloudflare,
Google, or Microsoft.
