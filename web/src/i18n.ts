/**
 * Admin-page strings. The page is rendered to static HTML at build time, so
 * every locale listed here becomes its own `lib/web/admin.<locale>.html`.
 */
export type AdminLocale = 'zh' | 'en'

export interface AdminText {
  pageTitle: string
  heading: string
  authed: string
  currentCode: string
  rotate: string
  restore: string
  fixedCode: string
  fixedHint: string
  fixedPlaceholder: string
  setFixed: string
  qrTitle: string
  qrLoading: string
  qrHint: string
  devices: string
  device: string
  pairedAt: string
  lastSeen: string
  noDevices: string
  footer: string
  codeLost: string
  fixedMode: string
  oneTimeMode: string
  fixedExpiry: string
  expiryPrefix: string
  qrFailed: string
  operationFailed: string
  enterFixed: string
  confirmFixed: string
  deniedTitle: string
  deniedBody: string
  deniedLead: string
  deniedTail: string
  deniedTerminal: string
}

export const dictionaries: Record<AdminLocale, AdminText> = {
  zh: {
    pageTitle: 'dsh-door 配对',
    heading: 'dsh-door 配对',
    authed: '已通过 dsh 浏览器登录校验',
    currentCode: '当前配对码',
    rotate: '生成新的一次性码',
    restore: '恢复一次性码',
    fixedCode: '固定配对码',
    fixedHint: '固定码会一直有效，直到你在下面恢复一次性码；只建议在可信网络使用。',
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
    codeLost: '登录已失效，请刷新 dsh Web UI',
    fixedMode: '固定码',
    oneTimeMode: '一次性码',
    fixedExpiry: '固定码长期有效，直到你手动恢复一次性码',
    expiryPrefix: '过期时间：',
    qrFailed: '（二维码生成失败，使用上面的数字码）',
    operationFailed: '操作失败',
    enterFixed: '请输入固定码',
    confirmFixed: '固定码会一直有效，确定设置？',
    deniedTitle: '需要 dsh 浏览器登录',
    deniedBody: '这个页面只对已经登录 dsh Web UI 的浏览器开放。',
    deniedLead: '请先在同一个浏览器里打开',
    deniedTail: '完成登录，然后回到',
    deniedTerminal: '也可以直接在服务器终端查看配对码：',
  },
  en: {
    pageTitle: 'dsh-door pairing',
    heading: 'dsh-door pairing',
    authed: 'Authenticated with the dsh browser session',
    currentCode: 'Current pairing code',
    rotate: 'Generate a new one-time code',
    restore: 'Restore one-time rotation',
    fixedCode: 'Fixed pairing code',
    fixedHint: 'A fixed code stays valid until you restore one-time rotation below. Use it only on a trusted network.',
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
    codeLost: 'Session expired. Reload the dsh Web UI.',
    fixedMode: 'Fixed code',
    oneTimeMode: 'One-time code',
    fixedExpiry: 'The fixed code stays valid until you restore one-time rotation',
    expiryPrefix: 'Expires: ',
    qrFailed: '(QR generation failed; use the numeric code above)',
    operationFailed: 'Operation failed',
    enterFixed: 'Enter a fixed code',
    confirmFixed: 'A fixed code stays valid until changed. Set it?',
    deniedTitle: 'dsh browser login required',
    deniedBody: 'This page is only available to a browser already logged into the dsh Web UI.',
    deniedLead: 'Open',
    deniedTail: 'in the same browser first, sign in, then return to',
    deniedTerminal: 'You can also read the pairing code from the server terminal:',
  },
}
