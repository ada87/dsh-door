import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, parse, resolve } from 'node:path'
import semver from 'semver'

export interface VersionCheck {
  version: string | null
  compatible: boolean
}

/**
 * Resolve the running dsh version. `engines.dsh` already guards installation
 * and profile startup, so a mismatch here is reported (and surfaced through
 * `/health` as `dshCompatible: false`) instead of failing the plugin: a linked
 * checkout or an exempted install should still get a chance to run.
 */
export async function checkDshVersion(
  range: string,
  logger: { info(message: string): void; warn(message: string): void },
): Promise<VersionCheck> {
  const version = await resolveVersion()
  if (version === null) {
    logger.warn(
      `[dsh-door] could not read the running dsh version; ` +
      `this build targets "${range}". Continuing, but a mismatch may fail at runtime.`,
    )
    return { version: null, compatible: true }
  }
  let compatible = false
  try {
    compatible = semver.satisfies(version, range, { includePrerelease: true })
  } catch {
    compatible = false
  }
  if (!compatible) {
    logger.warn(
      `[dsh-door] running dsh ${version} is outside this build's tested range "${range}". ` +
      'The Host may refuse the plugin; update dsh-door to a release that supports this dsh.',
    )
    return { version, compatible: false }
  }
  logger.info(`[dsh-door] dsh ${version} satisfies ${range}`)
  return { version, compatible }
}

async function resolveVersion(): Promise<string | null> {
  // The package may be resolvable directly when peer resolution links the
  // installation's copy, which is the normal profile case.
  try {
    // A computed specifier keeps this optional peer out of the build's module
    // graph while still resolving the installation's copy at runtime.
    const moduleName = '@deepseek-ai/dsh-app-boot'
    const mod = await import(moduleName)
    const read = (mod as { getDshRuntimeVersion?: () => string }).getDshRuntimeVersion
    if (typeof read === 'function') {
      const value = read()
      if (typeof value === 'string' && semver.valid(value) !== null) return value
    }
  } catch {
    // Fall through to manifest reads.
  }
  const require = createRequire(import.meta.url)
  for (const specifier of ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-app-boot/package.json']) {
    try {
      const filename = require.resolve(specifier)
      const version = await versionOf(filename)
      if (version !== null) return version
    } catch {
      // Try the next specifier.
    }
  }
  // A linked checkout cannot resolve the Host's installation by name. The
  // launcher's own entry point is inside that installation, so walk up from
  // it looking for the CLI or app-boot manifest.
  const entry = process.argv[1]
  if (entry !== undefined) {
    let current = dirname(resolve(entry))
    const root = parse(current).root
    while (current !== root) {
      for (const candidate of [
        join(current, 'package.json'),
        join(current, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
        join(current, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'),
      ]) {
        const version = await versionOf(candidate)
        if (version !== null) return version
      }
      current = dirname(current)
    }
  }
  return null
}

async function versionOf(filename: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(filename, 'utf8')) as { name?: unknown; version?: unknown }
    if (typeof manifest.name === 'string' && !manifest.name.startsWith('@deepseek-ai/dsh')) return null
    if (typeof manifest.version === 'string' && semver.valid(manifest.version) !== null) return manifest.version
  } catch {
    return null
  }
  return null
}
