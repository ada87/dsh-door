# Marketing site plan

`dsh-door` is the only plugin in the monorepo with a phone app, so it gets its
own product page. Plan modelled on `apps/code-reader/market/site` in the mobile
monorepo (the page behind `https://gitcodeviewer.xdnote.com`).

## Goal

- One page that answers: what is it, why not the browser client, how do I install
  it, is it safe.
- Static HTML on `gh-pages`, custom domain, no server.
- Same copy in English and Chinese; the repo stays the source of truth.

## Shape to add (inside `apps/dsh-door`)

```text
market/site/
  site.config.ts          # name, domain, repo URL, APK/release URL, theme color
  content/locales/
    en.json               # canonical copy
    zh-cn.json            # translation, same keys
  src/
    render.tsx            # renderToStaticMarkup + <!doctype html>
    messages.ts           # typed locale lookup
    components/           # Layout, Hero, Screenshots, HowItWorks, Security, Faq, Cta, Footer, JsonLd
    pages/                # HomePage, PrivacyPage (no analytics = short), NotFound
  static/
    style.css
    script.js             # language switch + copy install command
    favicon.svg
    CNAME                 # door.xdnote.com (placeholder, confirm)
    .nojekyll
  dist/                   # build output, gitignored
scripts/
  build-site.ts           # render locales -> dist, plus sitemap.xml / robots.txt
  sync-site.ts            # copy dist into the gh-pages worktree, keep CNAME
```

`package.json` gains `"site:build": "tsx scripts/build-site.ts"` and
`"site:sync": "tsx scripts/sync-site.ts"`.

## Page outline

1. **Hero** — “Your DSH sessions, in your pocket.” + APK/Release button + repo link.
2. **What you get** — sessions, reply/queue, approvals and questions, terminal,
   files, push, tags/read state (when dsh-tag is installed).
3. **Why a plugin, not the web UI** — phone cannot use the browser Typert client;
   dsh-door speaks device-token HTTP + SSE; no relay.
4. **Screenshots** — drawer with unread, session menu metrics, terminal, tablet split.
5. **Pair in 30 seconds** — code from Settings → DSH Door → enter URL + code.
6. **Security** — bearer token per device, revocable, Host-only, HTTP warning,
   TLS/Tailscale advice.
7. **FAQ** — does it need the cloud? why not official? what about iOS? how do I
   stop a background terminal?
8. **Footer** — repo, npm, license, compatibility ([docs/COMPATIBILITY.md](COMPATIBILITY.md)).

SEO: `sitemap.xml`, `robots.txt`, JSON-LD `SoftwareApplication`, hreflang pairs.

## Deploy (gh-pages)

Follow the GitCodeViewer pattern: a second worktree on the `gh-pages` branch.

```powershell
git -C apps/dsh-door worktree add D:\xdnote\dsh-door-pages gh-pages
pnpm --dir apps/dsh-door site:build
pnpm --dir apps/dsh-door site:sync D:\xdnote\dsh-door-pages
# review, commit, push
git -C D:\xdnote\dsh-door-pages add -A
git -C D:\xdnote\dsh-door-pages commit -m "deploy: site"
git -C D:\xdnote\dsh-door-pages push origin gh-pages
```

GitHub Pages settings: source = `gh-pages` branch, custom domain from `CNAME`,
“Enforce HTTPS” on. DNS: `CNAME door.xdnote.com -> ada87.github.io`.

## Prerequisites before building it

- A stable app download link: GitHub Releases asset (APK) or a store link.
- 4–6 screenshots at phone + tablet sizes.
- Confirm the domain (placeholder: `door.xdnote.com`).
- Decide whether the page sells only the app or the whole plugin trio; the
  current plan is app-first, with dsh-tag/dsh-bag mentioned as optional add-ons.

## Status

Not started. The metadata in `docs/marketplace/meta.json` and
`compat.json` is the single source the page can reuse for descriptions and
version facts later.
