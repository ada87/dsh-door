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
.dd-modalInput{box-sizing:border-box;width:100%;max-width:100%;min-width:0}
.dd-qr{font-size:10px;line-height:1;overflow:auto;margin:0;color:var(--dsw-alias-label-secondary);max-height:220px}
.dd-qr-img{display:flex;justify-content:flex-start;align-self:flex-start;background:#fff;border-radius:8px;padding:8px}
.dd-qr-img svg{width:220px;height:220px;display:block}
.dd-table{width:100%;border-collapse:collapse;font-size:13px}
.dd-table th,.dd-table td{text-align:left;padding:8px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18));color:var(--dsw-alias-label-secondary)}
.dd-table th{font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dd-devices{display:flex;flex-direction:column;margin-top:2px}
.dd-device{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;padding:14px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18))}
.dd-device:last-child{border-bottom:0}
.dd-deviceInfo{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dd-deviceNameRow{display:flex;align-items:center;gap:8px;min-width:0}
.dd-deviceName{font-size:14px;color:var(--dsw-alias-label-primary,#111)}
.dd-rename{padding:0;border:0;background:transparent;color:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#3d7bfd));font:inherit;font-size:12px;cursor:pointer}
.dd-rename:disabled{opacity:.45;cursor:default}
.dd-deviceMeta{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all}
.dd-deviceSide{display:flex;align-items:center;gap:20px;flex:none}
.dd-deviceTimes{display:flex;flex-direction:column;gap:3px;text-align:right}
.dd-deviceTime{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dd-deviceAction{flex:none}
.dd-deviceAction button{white-space:nowrap;color:var(--dsw-alias-state-error-primary,#e5484d)!important}
.dd-deviceAction button:hover{background:var(--dsw-alias-state-error-primary,#e5484d)!important;color:#fff!important}
@media (max-width:640px){
  .dd-device{flex-wrap:wrap}
  .dd-deviceSide{width:100%;justify-content:space-between}
}
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
      modify: '修改',
      setPermanentTitle: '设置永久配对码',
      setPermanentDesc: '输入 4 位数字，将作为永久配对码。',
      modifyTitle: '修改永久配对码',
      modifyDesc: '输入新的 4 位数字，旧永久码会立即失效。',
      passwordPlaceholder: '4 位数字',
      passwordInvalid: '请输入 4 位数字',
      confirm: '确定',
      cancel: '取消',
      resetTitle: '恢复为一次性配对码？',
      resetDesc: '当前永久码会立即失效，并生成新的一次性码。',
      qrTitle: '扫码/输入',
      qrLoading: '二维码加载中…',
      qrHint: '请用手机打开 DSH Door，连接 → 添加服务器 → 使用插件配对 → 扫描二维码。',
      devices: '已配对设备',
      device: '设备',
      pairedAt: '配对时间',
      lastSeen: '最近连接',
      actions: '操作',
      revoke: '移除',
      rename: '改名',
      renameTitle: '重命名设备',
      renameDesc: '只修改显示名称，不影响已配对连接。',
      renameEmpty: '设备名称不能为空',
      revokeConfirm: '移除设备「{name}」？它需要重新配对才能连接。',
      via: '地址',
      noDevices: '还没有设备',
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
      modify: 'Change',
      setPermanentTitle: 'Set a permanent pairing code',
      setPermanentDesc: 'Enter four digits to use as the permanent pairing code.',
      modifyTitle: 'Change the permanent pairing code',
      modifyDesc: 'Enter four new digits; the old permanent code stops working immediately.',
      passwordPlaceholder: 'Four digits',
      passwordInvalid: 'Enter four digits',
      confirm: 'Confirm',
      cancel: 'Cancel',
      resetTitle: 'Restore one-time pairing?',
      resetDesc: 'The permanent code stops working immediately and a fresh one-time code is generated.',
      qrTitle: 'Scan or type',
      qrLoading: 'Loading QR…',
      qrHint: 'Open DSH Door on your phone, then Connection → Add server → Plugin pairing → Scan QR code.',
      devices: 'Paired devices',
      device: 'Device',
      pairedAt: 'Paired',
      lastSeen: 'Last seen',
      actions: 'Actions',
      revoke: 'Remove',
      rename: 'Rename',
      renameTitle: 'Rename device',
      renameDesc: 'Only the display name changes; the pairing stays connected.',
      renameEmpty: 'The device name cannot be empty',
      revokeConfirm: 'Remove “{name}”? It must pair again to reconnect.',
      via: 'Via',
      noDevices: 'No devices yet',
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

        /** Browser-local date/time for the device table; follows the page language. */
        let deviceTimeFormat
        function formatDeviceTime(value) {
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) return '—'
          try {
            deviceTimeFormat ??= new Intl.DateTimeFormat(
              document.documentElement.lang || navigator.language || undefined,
              { dateStyle: 'medium', timeStyle: 'short' },
            )
            return deviceTimeFormat.format(date)
          } catch {
            return date.toLocaleString()
          }
        }

        function AdminSection() {
          const [data, setData] = React.useState(null)
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [now, setNow] = React.useState(Date.now())
          const [dialog, setDialog] = React.useState(null)
          const [password, setPassword] = React.useState('')
          const [dialogError, setDialogError] = React.useState(null)
          const [busyDevice, setBusyDevice] = React.useState(null)
          const [renameTarget, setRenameTarget] = React.useState(null)
          const [renameValue, setRenameValue] = React.useState('')
          const [renameError, setRenameError] = React.useState(null)

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

          const openRename = (device) => {
            setRenameValue(device.deviceName || '')
            setRenameError(null)
            setRenameTarget(device)
          }

          const confirmRename = async () => {
            if (renameTarget === null) return
            const name = renameValue.trim()
            if (name.length === 0) {
              setRenameError(t('renameEmpty'))
              return
            }
            setBusyDevice(renameTarget.deviceId)
            setRenameError(null)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/devices/' + encodeURIComponent(renameTarget.deviceId), {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
              setRenameTarget(null)
            } catch (failure) {
              setRenameError(failure instanceof Error ? failure.message : String(failure))
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
                    onClick: openPermanent,
                  }, t('modify'))
                  : h('span', { className: 'dd-countdown' }, left.length > 0 ? t('remaining', { time: left }) : ''),
              ),
            ),

            h('div', { className: 'dd-block' },
              h('span', { className: 'dd-label' }, t('qrTitle')),
              data?.qrSvg
                ? h('div', { className: 'dd-qr-img', dangerouslySetInnerHTML: { __html: data.qrSvg } })
                : h('span', { className: 'dd-desc' }, t('qrFailed')),
              h('span', { className: 'dd-desc' }, t('qrHint')),
            ),

            h('div', { className: 'dd-block' },
              h('span', { className: 'dd-label' }, t('devices')),
              h('div', { className: 'dd-devices' },
                devices.length === 0
                  ? h('div', { className: 'dd-desc' }, t('noDevices'))
                  : devices.map(device => h('div', { className: 'dd-device', key: String(device.deviceId) },
                    h('div', { className: 'dd-deviceInfo' },
                      h('div', { className: 'dd-deviceNameRow' },
                        h('span', { className: 'dd-deviceName' }, device.deviceName || '—'),
                        h('button', {
                          type: 'button',
                          className: 'dd-rename',
                          disabled: busyDevice === device.deviceId,
                          onClick: () => { openRename(device) },
                        }, t('rename')),
                      ),
                      h('span', { className: 'dd-deviceMeta' },
                        `${device.platform || 'unknown'} · ${device.appVersion || '—'}`),
                    ),
                    h('div', { className: 'dd-deviceSide' },
                      h('div', { className: 'dd-deviceTimes' },
                        h('span', { className: 'dd-deviceTime' }, `${t('lastSeen')} ${formatDeviceTime(device.lastSeenAt)}`),
                        h('span', { className: 'dd-deviceTime' }, `${t('pairedAt')} ${formatDeviceTime(device.pairedAt)}`),
                      ),
                      h('div', { className: 'dd-deviceAction' },
                        h(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          disabled: busyDevice === device.deviceId,
                          onClick: () => { void revokeDevice(device) },
                        }, t('revoke'))),
                    ),
                  )),
              ),
            ),

            dialog === null ? null : h('div', {
              className: 'dd-modalBackdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setDialog(null)
              },
            },
            h('div', { className: 'dd-modal', role: 'dialog', 'aria-modal': 'true' },
              h('h3', { className: 'dd-modalTitle' },
                dialog === 'permanent'
                  ? (fixed ? t('modifyTitle') : t('setPermanentTitle'))
                  : t('resetTitle')),
              h('p', { className: 'dd-desc' },
                dialog === 'permanent'
                  ? (fixed ? t('modifyDesc') : t('setPermanentDesc'))
                  : t('resetDesc')),
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
            renameTarget === null ? null : h('div', {
              className: 'dd-modalBackdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setRenameTarget(null)
              },
            },
            h('div', { className: 'dd-modal', role: 'dialog', 'aria-modal': 'true' },
              h('h3', { className: 'dd-modalTitle' }, t('renameTitle')),
              h('p', { className: 'dd-desc' }, t('renameDesc')),
              h(Input, {
                className: 'dd-modalInput',
                value: renameValue,
                placeholder: t('renameTitle'),
                autoFocus: true,
                autoComplete: 'off',
                onChange: event => setRenameValue(event.target.value.slice(0, 120)),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void confirmRename()
                },
              }),
              renameError === null ? null : h('p', { className: 'dd-error' }, renameError),
              h('div', { className: 'dd-modalActions' },
                h(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled: busyDevice === renameTarget.deviceId,
                  onClick: () => setRenameTarget(null),
                }, t('cancel')),
                h(Button, {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busyDevice === renameTarget.deviceId,
                  onClick: () => { void confirmRename() },
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
