/**
 * Browser half of dsh-door.
 *
 * Ships one surface: a top-level Settings section, ordered just after General
 * (order 5) so it is not the first menu item. There is no standalone page; the
 * React panel reads the Host's `/admin/data` and `/admin/pair-code` endpoints.
 *
 * This file is hand-written in the lazy-CJS factory format the dsh client
 * module system expects. build.mjs copies it to lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-door',
  factory(require) {
    const React = require('react')
    const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'dshDoorAdmin'
    const injected = globalThis.__DSH_DOOR__
    const BASE = typeof injected?.basePath === 'string' && injected.basePath.length > 0
      ? injected.basePath.replace(/\/$/, '')
      : '/dsh-door'

    const styles = `
.dd-page{display:flex;flex-direction:column;width:100%;gap:0}
.dd-head{padding:0 0 18px}
.dd-title{font-size:18px;font-weight:600;margin:0 0 4px;color:var(--dsw-alias-label-primary)}
.dd-desc{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dd-row{display:flex;gap:24px;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.22))}
.dd-row:last-child{border-bottom:none}
.dd-rowText{display:flex;flex-direction:column;gap:4px;min-width:0}
.dd-label{font-size:14px;color:var(--dsw-alias-label-primary)}
.dd-control{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.dd-block{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.22))}
.dd-code{font:600 20px ui-monospace,monospace;letter-spacing:3px;color:var(--dsw-alias-brand-primary,#3d7bfd)}
.dd-segment{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dd-segmentButton{height:28px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:13px;cursor:pointer}
.dd-segmentButton.is-active{background:var(--dsw-alias-surface-primary,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dd-countdown{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dd-modalBackdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.dd-modal{display:flex;flex-direction:column;gap:12px;width:min(380px,90vw);padding:18px;border-radius:12px;background:var(--dsw-alias-surface-primary,#fff);box-shadow:0 12px 40px rgba(0,0,0,.28)}
.dd-modalTitle{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.dd-modalActions{display:flex;justify-content:flex-end;gap:8px}
.dd-modalInput{width:100%}
.dd-qr{font-size:10px;line-height:1;overflow:auto;margin:0;color:var(--dsw-alias-label-secondary);max-height:220px}
.dd-qr-img{display:flex;justify-content:center;align-self:center;background:#fff;border-radius:8px;padding:8px}
.dd-qr-img svg{width:220px;height:220px;display:block}
.dd-table{width:100%;border-collapse:collapse;font-size:13px}
.dd-table th,.dd-table td{text-align:left;padding:8px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18));color:var(--dsw-alias-label-secondary)}
.dd-table th{font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dd-error{color:var(--dsw-alias-state-error-primary,#f87171);font-size:13px;margin:0}
.dd-link{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#3d7bfd))}
.dd-input{width:180px}
`

    const zh = {
      nav: 'dsh-door',
      title: 'dsh-door 配对',
      pairingCode: '配对码',
      oneTimeMode: '一次性',
      fixedMode: '永久性',
      oneTimeHint: '一次性码过期后自动换新码',
      fixedHint: '永久码不会过期；建议只在可信网络使用',
      remaining: '剩余 {time}',
      reset: '重置',
      setPermanentTitle: '设置永久配对码',
      setPermanentDesc: '输入 4 位数字，将作为永久配对码。',
      passwordPlaceholder: '4 位数字',
      passwordInvalid: '请输入 4 位数字',
      confirm: '确定',
      cancel: '取消',
      resetTitle: '恢复为一次性配对码？',
      resetDesc: '当前永久码会立即失效，并生成新的一次性码。',
      qrTitle: '扫码/输入',
      qrLoading: '二维码加载中…',
      qrHint: 'App 使用数字配对码；二维码内容为',
      devices: '已配对设备',
      device: '设备',
      pairedAt: '配对时间',
      lastSeen: '最近连接',
      actions: '操作',
      revoke: '移除',
      revokeConfirm: '移除设备「{name}」？它需要重新配对才能连接。',
      via: '地址',
      noDevices: '还没有设备',
      footer: '一次性码默认 5 分钟有效。永久码会写入 dsh 凭据存储，重启后仍然有效。',
      codeLost: '登录已失效，请刷新 dsh Web UI',
      operationFailed: '操作失败',
    }

    const en = {
      nav: 'dsh-door',
      title: 'dsh-door pairing',
      pairingCode: 'Pairing code',
      oneTimeMode: 'One-time',
      fixedMode: 'Permanent',
      oneTimeHint: 'A new code is generated when this one expires',
      fixedHint: 'The permanent code never expires; use it only on a trusted network',
      remaining: '{time} left',
      reset: 'Reset',
      setPermanentTitle: 'Set a permanent pairing code',
      setPermanentDesc: 'Enter four digits to use as the permanent pairing code.',
      passwordPlaceholder: 'Four digits',
      passwordInvalid: 'Enter four digits',
      confirm: 'Confirm',
      cancel: 'Cancel',
      resetTitle: 'Restore one-time pairing?',
      resetDesc: 'The permanent code stops working immediately and a fresh one-time code is generated.',
      qrTitle: 'Scan or type',
      qrLoading: 'Loading QR…',
      qrHint: 'The app uses the numeric code; the QR payload is',
      devices: 'Paired devices',
      device: 'Device',
      pairedAt: 'Paired',
      lastSeen: 'Last seen',
      actions: 'Actions',
      revoke: 'Remove',
      revokeConfirm: 'Remove “{name}”? It must pair again to reconnect.',
      via: 'Via',
      noDevices: 'No devices yet',
      footer: 'One-time codes expire after 5 minutes by default. A permanent code is stored in the dsh credential store and survives restarts.',
      codeLost: 'Session expired. Reload the dsh Web UI.',
      operationFailed: 'Operation failed',
    }

    function installStyles() {
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-door'
      style.textContent = styles
      document.head.append(style)
      return () => style.remove()
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
          const [now, setNow] = React.useState(Date.now())
          const [dialog, setDialog] = React.useState(null)
          const [password, setPassword] = React.useState('')
          const [dialogError, setDialogError] = React.useState(null)
          const [busyDevice, setBusyDevice] = React.useState(null)

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

          React.useEffect(() => {
            const timer = setInterval(() => setNow(Date.now()), 1000)
            return () => clearInterval(timer)
          }, [])

          async function perform(payload) {
            setBusy(true)
            try {
              const response = await fetch(BASE + '/admin/pair-code', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
              return null
            } catch (failure) {
              return failure instanceof Error ? failure.message : String(failure)
            } finally {
              setBusy(false)
            }
          }

          const fixed = data?.fixed === true
          const remaining = !fixed && data ? Math.max(0, data.expiresAt - now) : null
          const left = remaining === null
            ? ''
            : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`

          const openPermanent = () => {
            setPassword('')
            setDialogError(null)
            setDialog('permanent')
          }
          const openReset = () => {
            setDialogError(null)
            setDialog('reset')
          }
          const confirmPermanent = async () => {
            const code = password.trim()
            if (!/^\d{4}$/.test(code)) {
              setDialogError(t('passwordInvalid'))
              return
            }
            const failure = await perform({ action: 'fixed', code })
            if (failure !== null) {
              setDialogError(failure)
              return
            }
            setDialog(null)
            setPassword('')
          }
          const confirmReset = async () => {
            const failure = await perform({ action: 'auto' })
            if (failure !== null) {
              setDialogError(failure)
              return
            }
            setDialog(null)
          }

          const revokeDevice = async (device) => {
            const name = device.deviceName || String(device.deviceId || '').slice(0, 12)
            if (!window.confirm(t('revokeConfirm', { name }))) return
            setBusyDevice(device.deviceId)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/devices/' + encodeURIComponent(device.deviceId), {
                method: 'DELETE',
                credentials: 'same-origin',
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusyDevice(null)
            }
          }

          const devices = Array.isArray(data?.devices) ? data.devices : []

          return h('section', { className: 'dd-page' },
            h('header', { className: 'dd-head' },
              h('h2', { className: 'dd-title' }, t('title'))),
            error === null ? null : h('p', { className: 'dd-error' }, error),

            h('div', { className: 'dd-row' },
              h('div', { className: 'dd-rowText' },
                h('span', { className: 'dd-label' }, t('pairingCode')),
                h('span', { className: 'dd-desc' }, fixed ? t('fixedHint') : t('oneTimeHint')),
              ),
              h('div', { className: 'dd-control' },
                h('div', { className: 'dd-segment' },
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (fixed ? '' : ' is-active'),
                    disabled: busy || data === null,
                    onClick: () => { if (fixed) openReset() },
                  }, t('oneTimeMode')),
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (fixed ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { if (!fixed) openPermanent() },
                  }, t('fixedMode')),
                ),
                h('span', { className: 'dd-code' }, data?.formatted ?? '…'),
                fixed
                  ? h(Button, {
                    variant: 'outline',
                    size: 'sm',
                    disabled: busy,
                    onClick: openReset,
                  }, t('reset'))
                  : h('span', { className: 'dd-countdown' }, left.length > 0 ? t('remaining', { time: left }) : ''),
              ),
            ),

            h('div', { className: 'dd-block' },
              h('span', { className: 'dd-label' }, t('qrTitle')),
              data?.qrSvg
                ? h('div', { className: 'dd-qr-img', dangerouslySetInnerHTML: { __html: data.qrSvg } })
                : h('span', { className: 'dd-desc' }, t('qrFailed')),
              h('span', { className: 'dd-desc' }, t('qrHint'), ' ', h('code', null, '{"v":1,"url":…,"code":…}')),
            ),

            h('div', { className: 'dd-block' },
              h('span', { className: 'dd-label' }, t('devices')),
              h('table', { className: 'dd-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, t('device')),
                    h('th', null, t('pairedAt')),
                    h('th', null, t('lastSeen')),
                    h('th', null, t('actions')),
                  ),
                ),
                h('tbody', null,
                  devices.length === 0
                    ? h('tr', null, h('td', { colSpan: 4, className: 'dd-desc' }, t('noDevices')))
                    : devices.map(device => h('tr', { key: String(device.deviceId) },
                      h('td', null,
                        device.deviceName || '—',
                        h('br'),
                        h('span', { className: 'dd-desc' },
                          `${device.platform || 'unknown'}${device.appVersion ? ` · app ${device.appVersion}` : ''} · ${String(device.deviceId || '').slice(0, 16)}…`),
                        h('br'),
                        h('span', { className: 'dd-desc' },
                          `${t('via')}: ${Array.isArray(device.authorities) && device.authorities.length > 0 ? device.authorities.join(' / ') : '—'}`),
                      ),
                      h('td', null, new Date(device.pairedAt).toLocaleString()),
                      h('td', null, new Date(device.lastSeenAt).toLocaleString()),
                      h('td', null,
                        h(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          disabled: busyDevice === device.deviceId,
                          onClick: () => { void revokeDevice(device) },
                        }, t('revoke'))),
                    )),
                ),
              ),
            ),

            h('p', { className: 'dd-desc' }, t('footer')),

            dialog === null ? null : h('div', {
              className: 'dd-modalBackdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setDialog(null)
              },
            },
            h('div', { className: 'dd-modal', role: 'dialog', 'aria-modal': 'true' },
              h('h3', { className: 'dd-modalTitle' },
                dialog === 'permanent' ? t('setPermanentTitle') : t('resetTitle')),
              h('p', { className: 'dd-desc' },
                dialog === 'permanent' ? t('setPermanentDesc') : t('resetDesc')),
              dialog === 'permanent'
                ? h(Input, {
                  className: 'dd-modalInput',
                  value: password,
                  placeholder: t('passwordPlaceholder'),
                  autoFocus: true,
                  autoComplete: 'off',
                  onChange: event => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4)),
                })
                : null,
              dialogError === null ? null : h('p', { className: 'dd-error' }, dialogError),
              h('div', { className: 'dd-modalActions' },
                h(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => setDialog(null),
                }, t('cancel')),
                h(Button, {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => { void (dialog === 'permanent' ? confirmPermanent() : confirmReset()) },
                }, t('confirm')),
              ),
            )),
          )
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-door',
          order: 5,
          label: () => t('nav'),
        }, AdminSection))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'dsh-door',
        }, ({ size = 16, active }) => h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M3 2.5h7v11H3z',
          fill: active ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('path', {
          d: 'M10 3.5l3 1v9l-3-1z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }))))
      },
    }
  },
})
