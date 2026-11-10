/**
 * Browser half of dsh-door.
 *
 * The dsh client module system loads this file when the dsh-door bundle is on.
 * It contributes a "pairing admin" link to the plugin manager's detail page so
 * the admin page is one click away instead of a hand-typed URL.
 *
 * This file is intentionally hand-written in the lazy-CJS factory format the
 * client module system expects. build.mjs copies it to lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-door',
  factory(require) {
    const React = require('react')

    const BUNDLE = 'dsh-door'
    const FALLBACK_BASE = '/dsh-door'

    function adminBase() {
      const injected = globalThis.__DSH_DOOR__
      const base = typeof injected?.basePath === 'string' && injected.basePath.length > 0
        ? injected.basePath
        : FALLBACK_BASE
      return base.endsWith('/') ? base.slice(0, -1) : base
    }

    function isDoor(subject) {
      return (subject.kind === 'bundle' || subject.kind === 'row')
        && subject.pkg?.name === BUNDLE
    }

    const linkStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-neutral, #d0d7e2)',
      color: 'inherit',
      textDecoration: 'none',
      fontSize: 13,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }

    const sectionStyle = {
      borderTop: '1px solid var(--dsw-alias-border-neutral, #d0d7e2)',
      marginTop: 18,
      paddingTop: 14,
    }

    const bodyStyle = {
      margin: '4px 0 12px',
      fontSize: 13,
      opacity: 0.75,
      lineHeight: 1.5,
    }

    function adminLink(label) {
      return React.createElement('a', {
        href: adminBase() + '/admin',
        target: '_blank',
        rel: 'noopener noreferrer',
        style: linkStyle,
      }, label)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('dshDoor', {
          zh: {
            open: '配对管理',
            section: '手机配对',
            body: '打开配对管理页查看配对码、二维码和已配对设备。该页面需要在已登录 dsh Web UI 的浏览器中打开。',
          },
          en: {
            open: 'Pairing admin',
            section: 'Phone pairing',
            body: 'Open the pairing admin to see the code, QR, and paired devices. It must be opened in a browser already logged into dsh Web UI.',
          },
        }))

        ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
          name: 'plugins.detail.actions',
          id: 'dsh-door-admin',
          locale: 'dshDoor',
          order: 100,
        }, ({ t, subject }) => isDoor(subject) ? adminLink(t('open')) : null))

        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'dsh-door-admin',
          locale: 'dshDoor',
          order: 100,
        }, ({ t, subject }) => isDoor(subject)
          ? React.createElement('section', { style: sectionStyle },
            React.createElement('h3', { style: { margin: '0 0 2px', fontSize: 15 } }, t('section')),
            React.createElement('p', { style: bodyStyle }, t('body')),
            adminLink(t('open')))
          : null))
      },
    }
  },
})
