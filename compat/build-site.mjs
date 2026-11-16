/**
 * Build the static compatibility page from compat/versions.json.
 *
 * This is intentionally a single generated HTML file: the market site will own
 * the polished version later, but the version record is useful today.
 *
 *   npm run compat:site
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const data = JSON.parse(readFileSync(join(here, 'versions.json'), 'utf8'))
const outDir = join(here, 'site')
const outFile = join(outDir, 'index.html')

const escape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const resultLabel = { pass: '通过', partial: '部分通过', pending: '待测试', fail: '不兼容' }
const resultClass = { pass: 'pass', partial: 'partial', pending: 'pending', fail: 'fail' }

const rows = (data.releases ?? []).map((release) => `
    <tr>
      <td><code>${escape(release.dsh)}</code></td>
      <td>${escape(release.dshMinor)}</td>
      <td>${escape(release.door)}</td>
      <td>${escape(release.app)}</td>
      <td>${escape(release.protocol)}</td>
      <td><span class="badge ${resultClass[release.result] ?? 'pending'}">${escape(resultLabel[release.result] ?? release.result)}</span></td>
      <td>${escape(release.testedAt ?? '—')}</td>
      <td>${escape(release.notes ?? '')}</td>
    </tr>`).join('')

const minorRows = (data.minors ?? []).map((minor) => `
    <tr>
      <td><strong>${escape(minor.minor)}</strong></td>
      <td>${escape(minor.npmLatest ?? '—')}</td>
      <td>${escape(minor.npmNext ?? '—')}</td>
      <td>${escape((minor.tested ?? []).map(item => item.version).join(', ') || '—')}</td>
      <td>${escape((minor.pending ?? []).map(item => item.version).join(', ') || '—')}</td>
      <td>${escape(minor.notes ?? '')}</td>
    </tr>`).join('')

const policy = data.policy ?? {}
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-door 兼容性记录</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #1b1d22; --muted: #666b76; --line: #e3e6eb; --accent: #3a6df0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111318; --card: #191c22; --text: #e8eaf0; --muted: #9aa0ac; --line: #2a2f39; --accent: #7aa2ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 48px 20px 80px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .card b { display: block; font-size: 12px; color: var(--muted); font-weight: 500; margin-bottom: 4px; }
  h2 { font-size: 17px; margin: 30px 0 10px; }
  .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 860px; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
  .badge.pass { background: #e6f6ec; color: #176b36; }
  .badge.partial { background: #fff4dc; color: #7a5200; }
  .badge.pending { background: #eef0f4; color: #555b66; }
  .badge.fail { background: #fdeaea; color: #a12626; }
  @media (prefers-color-scheme: dark) {
    .badge.pass { background: #153525; color: #8fe0ad; }
    .badge.partial { background: #3a2d12; color: #f3c46b; }
    .badge.pending { background: #242832; color: #b1b7c3; }
    .badge.fail { background: #3b1d1d; color: #f2a0a0; }
  }
  footer { color: var(--muted); font-size: 12px; margin-top: 26px; }
</style>
</head>
<body>
<main>
  <h1>dsh-door 兼容性记录</h1>
  <p class="sub">dsh / dsh-door / App 版本对照。页面由 <code>compat/versions.json</code> 生成。</p>
  <div class="cards">
    <div class="card"><b>兼容基线</b>${escape(policy.baselineMinor ?? '—')}</div>
    <div class="card"><b>支持窗口</b>最近 ${escape(policy.window ?? '—')} 个 minor</div>
    <div class="card"><b>阶段</b>${escape(policy.phase ?? '—')}</div>
    <div class="card"><b>更新</b>${escape(data.updatedAt ?? '—')}</div>
  </div>

  <h2>版本对照</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>dsh</th><th>minor</th><th>dsh-door</th><th>App</th><th>protocol</th><th>结果</th><th>测试时间</th><th>说明</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <h2>Minor 线</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>minor</th><th>npm latest</th><th>npm next</th><th>已测版本</th><th>待测版本</th><th>说明</th></tr></thead>
      <tbody>${minorRows}</tbody>
    </table>
  </div>

  <footer>生成自 dsh-door ${escape(data.plugin ?? '')} · ${escape(data.updatedAt ?? '')}</footer>
</main>
</body>
</html>
`

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, html, 'utf8')
console.log(`[compat] wrote ${outFile}`)
