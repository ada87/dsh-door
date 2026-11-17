# Marketing site

The page for the DSH plugin suite is built and hosted from the mobile monorepo,
not from this repository:

- Source: `all-in-mobile/apps/app-dsh-door/market/site`
- Build: `pnpm --dir apps/app-dsh-door site:build` → `market/site/dist`
- Deploy: `pnpm --dir apps/app-dsh-door site:sync D:\xdnote\dsh-site-pages`
- Pages repo: [`ada87/dsh-site`](https://github.com/ada87/dsh-site) (`gh-pages`, built files only)
- Domain: `https://dsh.xdnote.com` (`CNAME` lives in `market/site/static/`)
- The `gh-pages` branch holds built files only; the source never lives there.

Rationale: dsh-door is the only plugin with a phone app, so the page sits next
to that app and reuses its build tooling. This repository keeps the plugin and
its docs; the site links here for installation and compatibility details.
