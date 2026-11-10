import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminPage } from './src/AdminPage.tsx'
import { AdminDeniedPage } from './src/AdminDeniedPage.tsx'
import { dictionaries, type AdminLocale } from './src/i18n.ts'

const styles = readFileSync(new URL('./src/admin.css', import.meta.url), 'utf8')
const clientScript = readFileSync(new URL('./src/admin.client.js', import.meta.url), 'utf8')
const outDir = new URL('../lib/web/', import.meta.url)

mkdirSync(outDir, { recursive: true })

const locales: AdminLocale[] = ['zh', 'en']
for (const locale of locales) {
  const text = dictionaries[locale]
  const page = '<!doctype html>' + renderToStaticMarkup(
    <AdminPage locale={locale} text={text} styles={styles} clientScript={clientScript} />,
  )
  writeFileSync(new URL(`admin.${locale}.html`, outDir), page)

  const denied = '<!doctype html>' + renderToStaticMarkup(
    <AdminDeniedPage locale={locale} text={text} />,
  )
  writeFileSync(new URL(`admin-denied.${locale}.html`, outDir), denied)
}

console.log(`[dsh-door] wrote admin templates to ${outDir.pathname}`)
