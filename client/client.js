/**
 * Browser half of dsh-door.
 *
 * It ships two surfaces:
 * - a dedicated "dsh-door" page inside dsh Settings (React, dsh locale + slots)
 * - a link on the plugin manager's dsh-door page to the standalone
 *   /dsh-door/admin page rendered from web/ at build time
 *
 * This file is hand-written in the lazy-CJS factory format the dsh client
 * module system expects. build.mjs copies it to lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-door',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dshDoorAdmin'
    const BUNDLE = 'dsh-door'
    const injected = globalThis.__DSH_DOOR__
    const BASE = typeof injected?.basePath === 'string' && injected.basePath.length > 0
      ? injected.basePath.replace(/\/$/, '')
      : '/dsh-door'

    const styles = `
.dd-page{display:grid;gap:14px;max-width:760px}
.dd-title{font-size:20px;margin:0}
.dd-muted{opacity:.65;font-size:13px;line-height:1.5;margin:0}
.dd-card{border:1px solid color-mix(in srgb, currentColor 14%, transparent);border-radius:12px;padding:16px;display:grid;gap:10px;background:color-mix(in srgb, currentColor 3%, transparent)}
.dd-code{font:700 32px ui-monospace,monospace;letter-spacing:6px;text-align:center;color:var(--dsw-alias-brand-primary,#3d7bfd);padding:10px 0}
.dd-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dd-row button{border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer;background:var(--dsw-alias-brand-primary,#3d7bfd);color:#fff}
.dd-row button.secondary{background:transparent;color:inherit;border:1px solid color-mix(in srgb, currentColor 20%, transparent)}
.dd-row button.danger{background:transparent;color:#f87171;border:1px solid #f87171}
.dd-row button:disabled{opacity:.5;cursor:default}
.dd-row input{border:1px solid color-mix(in srgb, currentColor 20%, transparent);border-radius:8px;padding:8px 10px;background:transparent;color:inherit;font:14px ui-monospace,monospace;min-width:200px}
.dd-qr{font-size:10px;line-height:1;overflow:auto;border:1px solid color-mix(in srgb, currentColor 12%, transparent);border-radius:8px;padding:10px;margin:0}
.dd-table{width:100%;border-collapse:collapse;font-size:13px}
.dd-table th,.dd-table td{text-align:left;padding:6px 0;border-bottom:1px solid color-mix(in srgb, currentColor 10%, transparent)}
.dd-error{color:#f87171;font-size:13px;margin:0}
.dd-link{color:var(--dsw-alias-brand-primary,#3d7bfd)}
`

    const zh = {
      nav: 'dsh-door',
      title: 'dsh-door 配对',
      authed: '已通过 dsh 浏览器登录校验',
      currentCode: '当前配对码',
      rotate: '生成新的一次性码',
      restore: '恢复一次性码',
      fixedCode: '固定配对码',
      fixedHint: '固定码会一直有效，直到你恢复一次性码；只建议在可信网络使用。',
      fixedPlaceholder: '例如 ABCD-EFGH',
      setFixed: '设为固定码',
      qrTitle: '扫码/输入',
      qrLoading: '二维码加载中…',
      qrHint: 'App 目前使用数字码；二维码内容为',
      devices: '已配对设备',
      device: '设备',
      pairedAt: '配对时间',
      lastSeen: '最近连接',
      noDevices: '还没有设备',
      footer: '配对码默认 5 分钟有效。固定码会写入 dsh 凭据存储，重启后仍然有效。',
      fixedExpiry: '固定码长期有效，直到你手动恢复一次性码',
      expiry: '过期时间：{time}',
      codeLost: '登录已失效，请刷新 dsh Web UI',
      operationFailed: '操作失败',
      enterFixed: '请输入固定码',
      confirmFixed: '固定码会一直有效，确定设置？',
      openStandalone: '打开独立页面',
      detailHint: '这里只放一个入口；完整的配对面板在 Settings → dsh-door，独立页面在 /dsh-door/admin。',
    }

    const en = {
      nav: 'dsh-door',
      title: 'dsh-door pairing',
      authed: 'Authenticated with the dsh browser session',
      currentCode: 'Current pairing code',
      rotate: 'Generate a new one-time code',
      restore: 'Restore one-time rotation',
      fixedCode: 'Fixed pairing code',
      fixedHint: 'A fixed code stays valid until you restore one-time rotation. Use it only on a trusted network.',
      fixedPlaceholder: 'e.g. ABCD-EFGH',
      setFixed: 'Set fixed code',
      qrTitle: 'Scan or type',
      qrLoading: 'Loading QR…',
      qrHint: 'The app uses the numeric code; the QR payload is',
      devices: 'Paired devices',
      device: 'Device',
      pairedAt: 'Paired',
      lastSeen: 'Last seen',
      noDevices: 'No devices yet',
      footer: 'One-time codes expire after 5 minutes by default. A fixed code is stored in the dsh credential store and survives restarts.',
      fixedExpiry: 'The fixed code stays valid until you restore one-time rotation',
      expiry: 'Expires: {time}',
      codeLost: 'Session expired. Reload the dsh Web UI.',
      operationFailed: 'Operation failed',
      enterFixed: 'Enter a fixed code',
      confirmFixed: 'A fixed code stays valid until changed. Set it?',
      openStandalone: 'Open standalone page',
      detailHint: 'This is only an entry point; the full pairing panel is in Settings → dsh-door, and the standalone page is /dsh-door/admin.',
    }

    function installStyles() {
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-door'
      style.textContent = styles
      document.head.append(style)
      return () => style.remove()
    }

    function isDoor(subject) {
      return (subject.kind === 'bundle' || subject.kind === 'row') && subject.pkg?.name === BUNDLE
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-door: admin copy')
        ctx.effect(installStyles, 'dsh-door: admin styles')

        const t = ctx.locale.bind(NS)

        function AdminSection() {
          const [data, setData] = React.useState(null)
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [fixedCode, setFixedCode] = React.useState('')

          React.useEffect(() => {
            let alive = true
            async function load() {
              try {
                const response = await fetch(BASE + '/admin/data', { credentials: 'same-origin', cache: 'no-store' })
                if (!response.ok) throw new Error(t('codeLost'))
                const next = await response.json()
                if (alive) {
                  setData(next)
                  setError(null)
                }
              } catch (failure) {
                if (alive) setError(failure instanceof Error ? failure.message : String(failure))
              }
            }
            void load()
            const timer = setInterval(load, 5000)
            return () => {
              alive = false
              clearInterval(timer)
            }
          }, [t])

          async function act(action) {
            setBusy(true)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/pair-code', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusy(false)
            }
          }

          async function setFixed() {
            const code = fixedCode.trim()
            if (code.length === 0) {
              setError(t('enterFixed'))
              return
            }
            if (!confirm(t('confirmFixed'))) return
            setBusy(true)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/pair-code', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'fixed', code }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
              setFixedCode('')
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusy(false)
            }
          }

          const devices = Array.isArray(data?.devices) ? data.devices : []
          const expiry = data?.fixed
            ? t('fixedExpiry')
            : data
              ? t('expiry', { time: new Date(data.expiresAt).toLocaleString() })
              : ''

          return h('section', { className: 'dd-page' },
            h('h2', { className: 'dd-title' }, t('title')),
            h('p', { className: 'dd-muted' }, t('authed')),
            error === null ? null : h('p', { className: 'dd-error' }, error),

            h('div', { className: 'dd-card' },
              h('h3', { className: 'dd-title' }, t('currentCode')),
              h('div', { className: 'dd-code' }, data?.formatted ?? '…'),
              h('p', { className: 'dd-muted' }, expiry),
              h('div', { className: 'dd-row' },
                h('button', { type: 'button', disabled: busy, onClick: () => { void act('rotate') } }, t('rotate')),
                h('button', { type: 'button', className: 'secondary', disabled: busy, onClick: () => { void act('auto') } }, t('restore')),
              ),
            ),

            h('div', { className: 'dd-card' },
              h('h3', { className: 'dd-title' }, t('fixedCode')),
              h('p', { className: 'dd-muted' }, t('fixedHint')),
              h('div', { className: 'dd-row' },
                h('input', {
                  value: fixedCode,
                  placeholder: t('fixedPlaceholder'),
                  autoComplete: 'off',
                  onChange: event => setFixedCode(event.target.value),
                }),
                h('button', { type: 'button', className: 'danger', disabled: busy, onClick: () => { void setFixed() } }, t('setFixed')),
              ),
            ),

            h('div', { className: 'dd-card' },
              h('h3', { className: 'dd-title' }, t('qrTitle')),
              h('pre', { className: 'dd-qr' }, data?.qr || t('qrLoading')),
              h('p', { className: 'dd-muted' }, t('qrHint'), ' ', h('code', null, '{"v":1,"url":…,"code":…}')),
            ),

            h('div', { className: 'dd-card' },
              h('h3', { className: 'dd-title' }, t('devices')),
              h('table', { className: 'dd-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, t('device')),
                    h('th', null, t('pairedAt')),
                    h('th', null, t('lastSeen')),
                  ),
                ),
                h('tbody', null,
                  devices.length === 0
                    ? h('tr', null, h('td', { colSpan: 3, className: 'dd-muted' }, t('noDevices')))
                    : devices.map(device => h('tr', { key: String(device.deviceId) },
                      h('td', null,
                        device.deviceName || '—',
                        h('br'),
                        h('span', { className: 'dd-muted' },
                          `${device.platform || ''} ${String(device.deviceId || '').slice(0, 12)}…`),
                      ),
                      h('td', null, new Date(device.pairedAt).toLocaleString()),
                      h('td', null, new Date(device.lastSeenAt).toLocaleString()),
                    )),
                ),
              ),
            ),

            h('p', { className: 'dd-muted' }, t('footer')),
          )
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-door',
          order: 50,
          label: () => t('nav'),
        }, AdminSection))

        ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
          name: 'plugins.detail.actions',
          id: 'dsh-door-admin',
          order: 100,
        }, ({ subject }) => isDoor(subject)
          ? h('a', {
            className: 'dd-link',
            href: BASE + '/admin',
            target: '_blank',
            rel: 'noopener noreferrer',
          }, t('openStandalone'))
          : null))

        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'dsh-door-admin',
          order: 100,
        }, ({ subject }) => isDoor(subject)
          ? h('section', { className: 'dd-page' },
            h('p', { className: 'dd-muted' }, t('detailHint')))
          : null))
      },
    }
  },
})
