import type { AdminLocale, AdminText } from './i18n.ts'

export interface AdminPageProps {
  locale: AdminLocale
  text: AdminText
  styles: string
  clientScript: string
}

/**
 * The admin page is rendered to a plain HTML file at build time. Nothing in
 * this component ships to the browser; the only runtime JavaScript is the
 * hand-written `admin.client.js` inlined below.
 */
export function AdminPage({ locale, text, styles, clientScript }: AdminPageProps) {
  const textJson = JSON.stringify(text).replaceAll('<', '\\u003c')
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{text.pageTitle}</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <main>
          <div>
            <h1>{text.heading}</h1>
            <div className="muted">
              {text.authed} · <span id="mode" />
            </div>
          </div>

          <div className="card">
            <h2>{text.currentCode}</h2>
            <div className="code" id="code">…</div>
            <div className="muted" id="expiry" />
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" data-action="rotate">{text.rotate}</button>
              <button type="button" className="secondary" data-action="auto">{text.restore}</button>
            </div>
          </div>

          <div className="card">
            <h2>{text.fixedCode}</h2>
            <div className="muted">{text.fixedHint}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <input id="fixedInput" placeholder={text.fixedPlaceholder} autoComplete="off" />
              <button type="button" className="danger" id="setFixed">{text.setFixed}</button>
            </div>
          </div>

          <div className="card">
            <h2>{text.qrTitle}</h2>
            <div id="qr" className="dd-qr">{text.qrLoading}</div>
            <div className="muted">
              {text.qrHint} <code>{'{"v":1,"url":…,"code":…}'}</code>
            </div>
          </div>

          <div className="card">
            <h2>{text.devices}</h2>
            <table>
              <thead>
                <tr>
                  <th>{text.device}</th>
                  <th>{text.pairedAt}</th>
                  <th>{text.lastSeen}</th>
                </tr>
              </thead>
              <tbody id="devices" />
            </table>
          </div>

          <div className="muted">{text.footer}</div>
        </main>
        <script dangerouslySetInnerHTML={{ __html: `window.__DSH_DOOR_TEXT__ = ${textJson};` }} />
        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
      </body>
    </html>
  )
}
