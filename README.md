# dsh-door

Non-official mobile BFF for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
It is a normal dsh plugin: it runs inside the Host process, calls the Host's own
Cordis services, and speaks a small JSON + SSE protocol to the React Native app.

It does **not** use Typert Remote, does **not** fork dsh, and does **not** put a
relay server between the user's phone and the user's Host.

## Why a plugin

The official browser client uses generated Typert codecs and `/api/remote.mux`.
Those artifacts are browser bundles, and dsh's `/api` route sits behind a
Host/Origin fence and browser cookies. A native app cannot consume either
cleanly. This plugin registers its own routes on the same `webServer`, authenticates
devices with its own bearer token, and uses the Host's own
`sessionController` / `approval` / `userQuestions` services.

## Install

```sh
dsh plugin --profile web add dsh-door
```
From a checkout or a packed tarball:

```sh
dsh plugin --profile web add /path/to/dsh-door
# or
pnpm pack
dsh plugin --profile web add ./dsh-door-0.1.1.tgz
```

Restart `dsh web`. The terminal prints:

```text
[dsh-door] dsh 0.2.2-rc.3 satisfies >=0.2.1-rc.4 <0.3.0
[dsh-door] routes mounted at /dsh-door (protocol 1, push none)
[dsh-door] pairing code 1234 — open the app, enter the server URL, then this code.
```

The code has a five-minute TTL by default. After a successful pairing it rotates;
the terminal prints the next one.

The generated pairing code is **four digits** (`1234`). It is one-time, expires
after `pairingTtlMs`, and each client address gets `pairingMaxAttempts` (8)
tries per TTL. Four digits are convenient but low entropy: keep dsh on a trusted
LAN/Tailscale, or raise `pairingCodeLength` / lower `pairingMaxAttempts` before
exposing it to the internet.

The Host's compatibility gate enforces the `engines.dsh` range at install and
profile startup. If a linked or exempted install runs outside the tested range,
the plugin logs a warning and reports `dshCompatible: false` in `/health`
instead of failing to load.

Supported window: the latest three **minor** lines, starting with 0.2.2.
Prerelease suffixes (`alpha`, `rc`) do not create a new line; `0.2.2-rc.1` and
`0.2.2-rc.3` are one line. The current matrix and test record live in
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and `compat/versions.json`.

`engines.dsh` still reads `>=0.2.1-rc.4 <0.3.0` during the transition. 0.2.1 is
outside the support window and marked `@deprecated 0.2.2`: it lacks
`sessionController.state()` and the page cursor, so the facade synthesizes state
from projections + list and always supplies the projection watermark as the cut,
then fills the missing cursor with that cut. See `tests/compat.test.ts`. The
floor will move to `>=0.2.2-0` when the 0.2.1 shims are removed.

## Upgrade

Install from the npm registry (the default `dsh plugin add dsh-door`) so dsh can
track releases. The **dsh-door** page under **Plugins** then shows **Update
available** and a **Versions** section; **Update** removes the old version,
installs the selected one, keeps the bundle enabled, and recomposes with HMR or
asks for a restart. A failed update restores the previous version when possible.

The **Update / Versions** section is a dsh 0.2.2 feature. On 0.2.1 (outside the
supported window) the page has no update action, so update from the CLI instead:

```sh
dsh plugin --profile web remove dsh-door
dsh plugin --profile web add dsh-door@latest
# restart dsh
```

The Web UI is preferred on 0.2.2+ because it checks `engines.dsh` before
touching the profile and rolls back a failed install. From the CLI:

```sh
dsh plugin --profile web add dsh-door@latest
# restart dsh if the result asks for it
```

If you installed from a tarball or a `link:` path, that entry is not updatable;
switch it once:

```sh
dsh plugin --profile web remove dsh-door
dsh plugin --profile web add dsh-door@latest
```

### dsh upgrades

The plugin is a profile dependency, so upgrading dsh keeps it installed. dsh
0.2.x releases stay inside the supported range. A dsh 0.3.x Host refuses this
version at startup and marks it incompatible: update dsh-door to a release with
a matching range instead of reinstalling. Pairings and device tokens live in the
credential store under `dsh-door/*` and survive plugin updates.

### Coming from `@xdnote/dsh-mobile`

Remove the old package once; it owns the old `/dsh-mobile` routes and the old
credential keys:

```sh
dsh plugin --profile web remove @xdnote/dsh-mobile
dsh plugin --profile web add dsh-door
```

Device records now live under `dsh-door/*`, so pairings are not migrated: pair
the phone again. The app's storage keys are also `@dsh-door/*` now, so install
the new app build rather than upgrading the old one in place.

## Pairing code in the browser

Open dsh Web UI and go to **Settings → Built-in plugins → dsh-door**. The tab
sits beside dsh-tag and uses the same slot mechanism, so it follows the Web UI
theme and language.

The page shows:

- the current numeric code and expiry;
- a QR payload (`{"v":1,"url":…,"code":…}`);
- the paired-device table;
- buttons to generate a new one-time code, set a **fixed code**, or restore
  one-time rotation.

There is no standalone HTML page. The tab is contributed by `client/client.js`
through the `settings.plugins.tab` slot and reads two cookie-authenticated
endpoints:

- `GET /admin/data` — current code, QR payload and device list;
- `POST /admin/pair-code` — rotate, set or clear a fixed code.

Both are protected by the dsh browser session: the plugin calls
`ctx.connection.admit()` on the request headers, with loopback accepted as a
local fallback. Without a valid dsh login the endpoints return 401.

The browser half is part of the page's boot manifest, so after installing or
updating the plugin, restart `dsh web` and reload the Web UI (a hard refresh,
not just the settings tab). An already-open tab keeps the old module graph and
will not show the tab.

### Local development without publishing

Install the checkout once as a link; every rebuild is served from the same path:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-door
```

Then:

- **Host + client half**: `pnpm dev:host` (TypeScript types, esbuild bundle, and
  the `client/client.js` copy); restart `dsh web`.
- **Before publishing**: `pnpm build` (types + bundle) and `pnpm test`.

Use a separate home if you do not want to touch your real profile:

```sh
DSH_HOME=$HOME/.dsh-dev dsh plugin --profile web add link:/absolute/path/to/dsh-door
DSH_HOME=$HOME/.dsh-dev dsh web --port 4001
```

On Windows PowerShell:

```powershell
$env:DSH_HOME="$HOME\.dsh-dev"
dsh plugin --profile web add link:D:/all-in-mobile/apps/dsh-door
dsh web --port 4001
```

Fixed codes are normalized (letters/digits, 4–32 chars, dashes ignored) and
persisted in the dsh credential store under `dsh-door/pairing`. They remain
valid until changed; use them only on a trusted network. One-time codes rotate
after a successful pairing and expire after `pairingTtlMs`.

## Pairing

- The plugin generates a one-time code, prints it, and optionally prints a QR
  payload (`{"v":1,"url":"http://host:port/dsh-door","code":"..."}`).
- The app sends the code plus a stable public-key fingerprint
  (`devicePublicKey`). The server stores a hash of the bearer token and pins the
  fingerprint as the device id.
- Tokens are not bound to `host:port`, so changing IP, port, or tunnel does not
  require re-pairing.
- Device records live in the dsh credential store under the owner-scoped key
  `dsh-door/devices` (grant payload). No token is stored in `cordis.yml`.
- `GET /dsh-door/pair/code` is loopback-only and only exists to make local
  setup/curl tests convenient. Remote users read the code from the terminal.

## Configuration

`basePath` defaults to `/dsh-door`. The app's v1 discovery probes that exact
path, so a deployment that changes it also needs an app-side setting (planned).

The wire prefix and the persisted credential keys use the same `dsh-door` name:
the app probes `/dsh-door/health`, and pairings live under `dsh-door/*`.

```yaml
- id: dsh-door
  name: 'dsh-door'
  config:
    basePath: /dsh-door
    allowedHosts: ['dsh.example.com']   # extra Host-header authorities
    requireSecure: false                # true when the Host itself serves TLS
    strictHostCheck: false              # true binds requests to a known authority
    pairingTtlMs: 300000
    pairingCodeLength: 4
    pairingMaxAttempts: 8
    approvalWaitTimeoutMs: 120000
    questionWaitTimeoutMs: 120000
    allowSessionWideGrants: true
    enableDebugRoutes: false            # true exposes authenticated /debug/* test routes
    maxBodyBytes: 65536
    rateLimitWindowMs: 60000
    rateLimitMax: 240
    dshVersionRange: '>=0.2.1-rc.4 <0.3.0'
    push:
      provider: none                    # none | fcm | apns | relay
      # provider: relay
      # relayUrl: https://push.example.com
      # relayHostToken: dshr_...
      notifyTurnEnd: true
      notifyApproval: true
      notifyQuestion: true
```

`relay` mode sends only the notification payload and host token to your relay;
the relay holds the FCM/APNs credentials. Device tokens are registered with the
relay automatically when the app calls `POST /push/register`.

The `notify*` config values are host-wide defaults. Each device can then set its own `approval`, `question` and `turnEnd` subscriptions with `PUT /push/subscriptions`; both direct sending and relay mode filter unsubscribed devices. Turn-end pushes are sent only when no app has a live global SSE connection. A connected app handles the event locally instead.

Push credentials are BYO. Put secrets in the dsh credential store under the
owner-scoped record `dsh-door/push` when possible; the plugin reads that record
first and falls back to configuration:

```json
{
  "provider": "fcm",
  "fcmServiceAccountJson": "{\"type\":\"service_account\",...}",
  "fcmProjectId": "my-project"
}
```

The equivalent configuration fallback (useful for tests) is:

```yaml
    push:
      provider: fcm
      fcmServiceAccountJson: '{"type":"service_account",...}'
      fcmProjectId: my-project
```

or APNs:

```yaml
    push:
      provider: apns
      apnsKey: |
        -----BEGIN PRIVATE KEY-----
        ...
      apnsKeyId: ABC123DEFG
      apnsTeamId: TEAM123456
      apnsTopic: com.example.dshapp
      apnsEnvironment: production
```

The plugin talks directly to Google/Apple; there is no author-operated relay.

## HTTP API

All routes are under `basePath` (default `/dsh-door`). Except for `/health`
and `/pair`, every route requires `Authorization: Bearer <device token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public capability and version facts |
| GET | `/pair` | Public pairing availability (no code) |
| GET/POST | `/pair/code` | Loopback-only current/rotated code + QR |
| POST | `/pair` | One-time code → device token |
| GET | `/devices` | Paired devices |
| DELETE | `/devices/:id` | Revoke a device |
| POST | `/push/register` | Register an FCM/APNs token |
| PUT | `/push/subscriptions` | Set this device's `approval` / `question` / `turnEnd` subscriptions |
| DELETE | `/push` | Remove this device's push token |
| POST | `/presence` | Tell the plugin this device is foreground (`{ foreground: boolean }`) |
| GET | `/speech` | Host speech Provider readiness; requires the experimental speech API bundle |
| POST | `/speech/transcribe` | Transcribe one canonical base64 WAV without submitting a Session prompt |
| GET | `/schedules` | Automation catalog; `available: false` when the profile has no schedule service |
| GET | `/schedule-marks` | Active scheduled-task counts per Session, for the drawer clock mark |
| GET | `/schedules/:id` | One task with target, last delivery and execution flags |
| GET | `/schedules/:id/history?limit=20&before=` | Delivery history, newest first |
| POST | `/schedules/:id/run` | Deliver one occurrence now without moving the schedule |
| PUT | `/schedules/:id` | Pause/resume (`{ "active": boolean, "expectedUpdatedAt"?: string }`) |
| DELETE | `/schedules/:id` | Delete the task and its saved deliveries |
| GET | `/sessions` | Session list with title projections and optional `vitals` (context %, tokens, turns, todos, goal, plan, model) |
| POST | `/sessions` | Create/reuse a blank Session |
| GET | `/sessions/:id/transcript` | Message-aligned history page |
| GET | `/sessions/:id/files?path=` | Read-only directory listing, confined to the Session cwd (300 entries max) |
| GET | `/sessions/:id/file?path=` | UTF-8 text preview, confined to the Session cwd (256 KiB max) |
| GET | `/sessions/:id/state` | Running/queue state + projections |
| GET | `/sessions/:id/terminals` | List retained phone terminals |
| POST | `/sessions/:id/terminals` | Open a PTY in the Session working directory |
| GET | `/sessions/:id/terminals/:tid/events` | SSE replay + live terminal output |
| POST | `/sessions/:id/terminals/:tid/input` | Write terminal input |
| POST | `/sessions/:id/terminals/:tid/resize` | Resize the PTY |
| DELETE | `/sessions/:id/terminals/:tid` | Terminate the terminal |
| GET | `/sessions/:id/events` | SSE follow stream (snapshot + events) |
| POST | `/sessions/:id/prompt` | Send text (`queue` or `steer`) |
| POST | `/sessions/:id/rename` | Rename |
| POST | `/sessions/:id/fork` | Create a child Session at an optional inclusive `atSeq` prefix |
| GET | `/workspaces` | Workspace registry (id, path, title) |
| POST | `/workspaces` | Adopt an existing directory (`{ "path", "title"? }`) |
| PUT | `/workspaces/:id` | Rename a workspace (`{ "title": string }`); duplicate titles are allowed, like dsh Web |
| POST | `/sessions/:id/cancel` | Stop the current turn |
| GET | `/sessions/:id/open` | Escape-hatch browser URL |
| GET | `/events` | Global SSE: approvals, questions, sessions, turn end |
| GET | `/approvals` | Pending approvals (optional `preview`: command/diff/URL/path) |
| POST | `/approvals/:id` | `allow` / `always` / `deny` |
| GET | `/questions` | Pending questions |
| POST | `/questions/:id/answer` | Structured answer batch |
| POST | `/sessions/:id/questions/:callId/answer` | Answer a continued question |
| POST | `/debug/approval` | Debug-only synthetic approval (enableDebugRoutes) |
| POST | `/debug/question` | Debug-only synthetic question (enableDebugRoutes) |

A schedule delivery receipt acknowledges that the target Session persisted the
message, not that the Agent finished or succeeded. Open the target Session for
the actual result. `GET /health` advertises `schedules`, `scheduleActions` and
`scheduleHistory` so older plugins can stay read-only; `workspaceRename` gates
the phone's workspace rename entry.

### Approval policy

The plugin follows the required policy exactly:

1. If a paired app is in the foreground with a live global SSE connection, claim
   the request even when a browser is connected. The app heartbeats
   `POST /presence` every 20 seconds; a claim expires after 45 seconds without a
   heartbeat, and backgrounding the app releases it immediately.
2. Otherwise, if `ctx.typertGateway.hasLiveClient()` is true, call `next()` — the
   browser wins. The waterfall is first-answerer-wins, so claiming would hide the
   prompt from the official UI.
3. With neither, claim the request, broadcast it over SSE, push it if configured,
   and wait for the app or the timeout.
4. Timeout, abort, an answer of "no", or the foreground app leaving falls back to
   `next()`, so dsh's own fail-closed `unavailable` path still applies.

`always` is a process-local session grant for one `session + tool` pair. dsh only
defines one-shot `allowed-once`; the plugin does not invent durable grants.

Approval events try to include a presentation-only `preview` by reading the
matching `tool/call` event (`bash` command, `edit` diff, `web_fetch` URL, etc.).
The lookup is best-effort and bounded so it never blocks the approval. Push data
also carries `hostId` (when the Host origin is known) and the approval's
`sessionId`, so a multi-host app can switch to the right Host before opening the
session.

### Questions

Questions use the same policy: a foreground app with a live SSE connection claims
the question before a connected browser. If the app leaves the foreground, the
claim is released and dsh shows the question in the browser. If the foreground
wait is already gone, the app can still answer the projection's `continued`
questions through the `callId` route, which calls
`ctx.userQuestions.answer(agent, callId, ...)`.

### SSE frames

`GET /sessions/:id/events`:

```text
event: ready
data: {"sessionId":"..."}

event: frame
data: {"type":"snapshot","header":{...},"records":[...],"projections":{...}}

event: frame
data: {"type":"event","event":{"type":"assistant/message",...}}
```

`GET /events`:

```text
event: hello
data: {"server":{...},"features":{...},"pendingApprovals":[],"pendingQuestions":[]}

event: approval
data: {"id":"...","sessionId":"...","toolName":"bash","displayReason":{"en":"..."}}

event: session
data: {"action":"status","sessionId":"...","running":true}
```

### Debug interaction routes

`enableDebugRoutes: true` adds authenticated `POST /debug/approval` and
`POST /debug/question` routes. They create the same pending items the real
interaction seams create, so a phone can exercise the approval/question UI
without a model key or a tool call. They are off by default and are not a
replacement for the real waterfall; turn them off after testing.

## Security model

- Route registration is outside dsh's `/api` cookie fence, so the plugin owns
  its own fence:
  - A `Host` header is required. Unauthenticated routes accept loopback, the
    listener's bind address, a configured `allowedHosts` entry, or an authority
    recorded at pairing.
  - An authenticated device request is accepted across address/tunnel changes:
    the bearer token is the boundary, so changing IP, port, or tunnel does not
    require re-pairing. Set `strictHostCheck: true` to bind requests to the
    authority allowlist instead.
  - An attached `Origin` must match the request authority; cross-site browser
    requests are refused (`403`).
  - Native clients do not need CORS, so no CORS headers are ever sent.
- The pairing admin page uses dsh's own browser authentication
  (`ctx.connection.admit`) and only falls back to loopback; it is not an
  unauthenticated code-dump route.
- Bearer tokens are compared in constant time after hashing.
- The phone terminal runs the Host's default shell through
  `ctx.subprocess.spawnTerminal`, so it runs as the dsh OS user outside the
  agent sandbox — the same permission model as dsh's Web sidebar terminal. It
  is reachable only with a device token, input is capped at 64 KiB per request,
  at most four terminals are kept per Session, and unattached terminals are
  reclaimed after 30 idle minutes. Output is bounded to 200k characters.
- Revoking a device deletes its token and immediately ends every SSE stream
  opened with it (global events and per-Session follows), so a lost phone stops
  receiving events at revoke time rather than on its next reconnect.
- JSON bodies are bounded (`maxBodyBytes`) and rate-limited per client address.
- Pairing has a TTL, a one-time code, and a per-address failure cap.
- Plain HTTP on a public address is the user's choice and is surfaced by the
  app as a strong warning; the app refuses to pair publicly over HTTP until the
  user explicitly confirms. Prefer Tailscale, a private address, or TLS.

## Verification

The plugin ships an integration suite that mounts the real router on a local
HTTP server with a fake Host context:

```sh
node --import tsx --test tests/*.test.ts
# or, when deps are installed:
pnpm test
```

It covers health, pairing and one-time-code consumption, token auth, session
projection, Host/Origin fences, approval claim/answer, browser-first delegation,
session-wide grants, question answers, terminal create/input/resize/close,
revoke stream teardown, body limits, and JSON-safe device persistence.

The app repository also contains a recorded M1 curl walkthrough in
`docs/M1-ACCEPTANCE.md` (https://cnb.cool/ada87/app-dsh-door).

## Known limitations

- dsh is developer preview; the plugin is pinned to `0.2.x`.
- Session title/list reads call the projection service per row (fine for a
  personal Host; not optimized for thousands of sessions).
- `always` is process-local and disappears on restart.
- Push is implemented for FCM v1 and APNs token auth, but this repository cannot
  exercise Apple/Google credentials.
- The app reads committed `assistant/message` events; assistant token deltas
  (`assistant-stream` frames) are not rendered yet.
- The browser escape hatch opens the Web root; dsh does not expose the launch
  token to plugins, so an already-authenticated browser session is required.

