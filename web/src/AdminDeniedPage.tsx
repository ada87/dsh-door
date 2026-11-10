import type { AdminLocale, AdminText } from './i18n.ts'

export interface AdminDeniedPageProps {
  locale: AdminLocale
  text: AdminText
}

/** The 401 page for a browser that has no dsh Web UI session. */
export function AdminDeniedPage({ locale, text }: AdminDeniedPageProps) {
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <title>{text.deniedTitle}</title>
      </head>
      <body style={{ background: '#0b0e14', color: '#e8edf7', font: '16px system-ui', padding: 48, lineHeight: 1.6 }}>
        <h1>{text.deniedTitle}</h1>
        <p>{text.deniedBody}</p>
        <p>
          {text.deniedLead} <a style={{ color: '#6ea8fe' }} href="/">dsh Web UI</a>{text.deniedTail}{' '}
          <a style={{ color: '#6ea8fe' }} href="__ADMIN_PATH__">__ADMIN_PATH__</a>.
        </p>
        <p style={{ color: '#9aa7bd' }}>
          {text.deniedTerminal} <code>journalctl -u dsh -f | grep dsh-door</code>
        </p>
      </body>
    </html>
  )
}
