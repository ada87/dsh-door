/* Hand-written runtime for the static admin page. No framework or vendor code. */
;(() => {
  const T = window.__DSH_DOOR_TEXT__ || {}
  const BASE = location.pathname.replace(/\/admin\/?$/, '')
  const byId = (id) => document.getElementById(id)
  let timer

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[character]))
  }

  async function refresh() {
    const response = await fetch(BASE + '/admin/data', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) {
      byId('code').textContent = T.codeLost || 'Session expired'
      return
    }
    const data = await response.json()
    byId('code').textContent = data.formatted
    byId('mode').innerHTML = data.fixed
      ? '<span class="warn">' + esc(T.fixedMode) + '</span>'
      : '<span class="ok">' + esc(T.oneTimeMode) + '</span>'
    byId('expiry').textContent = data.fixed
      ? (T.fixedExpiry || '')
      : ((T.expiryPrefix || '') + new Date(data.expiresAt).toLocaleString())
    const qr = byId('qr')
    if (data.qrSvg) {
      qr.innerHTML = data.qrSvg
    } else {
      qr.textContent = T.qrFailed || ''
    }
    const rows = (data.devices || []).map(device =>
      '<tr><td>' + esc(device.deviceName) +
      '<br><span class="muted">' + esc(device.platform || '') + ' ' +
      esc(String(device.deviceId || '').slice(0, 12)) + '…</span></td><td>' +
      new Date(device.pairedAt).toLocaleString() + '</td><td>' +
      new Date(device.lastSeenAt).toLocaleString() + '</td></tr>').join('')
    byId('devices').innerHTML = rows ||
      '<tr><td colspan="3" class="muted">' + esc(T.noDevices) + '</td></tr>'
    clearTimeout(timer)
    timer = setTimeout(refresh, 5000)
  }

  async function act(action) {
    const response = await fetch(BASE + '/admin/pair-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      alert((await response.json()).error?.message || T.operationFailed || 'Operation failed')
      return
    }
    await refresh()
  }

  async function setFixed() {
    const code = byId('fixedInput').value.trim()
    if (!code) {
      alert(T.enterFixed || 'Enter a fixed code')
      return
    }
    if (!confirm(T.confirmFixed || 'Set this fixed code?')) return
    const response = await fetch(BASE + '/admin/pair-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fixed', code }),
    })
    if (!response.ok) {
      alert((await response.json()).error?.message || T.operationFailed || 'Operation failed')
      return
    }
    byId('fixedInput').value = ''
    await refresh()
  }

  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => { void act(button.getAttribute('data-action')) })
  }
  byId('setFixed')?.addEventListener('click', () => { void setFixed() })
  void refresh()
})()
