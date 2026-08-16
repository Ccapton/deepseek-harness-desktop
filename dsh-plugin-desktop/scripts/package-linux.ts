/** Build an unsigned Linux AppImage for the current host architecture. */

import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Injectable native Linux packaging boundary used by focused tests. */
export interface LinuxPackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Absolute POSIX command shell. */
  readonly commandShell: string
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** AppImage artifact electron-builder is expected to write. */
  readonly expectedArtifact: string
  /** Report whether a file exists. */
  readonly exists: (path: string) => boolean
  /** Report whether a file is executable. */
  readonly isExecutable: (path: string) => boolean
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function exists(path: string): boolean {
  return existsSync(path)
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultOptions(): LinuxPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const manifest = require('../package.json') as { readonly version: string }
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    commandShell: '/bin/sh',
    builderCli: require.resolve('electron-builder/cli.js'),
    nodeExecutable: process.execPath,
    expectedArtifact: join(desktopRoot, 'dist', `DSH Desktop-${manifest.version}.AppImage`),
    exists,
    isExecutable,
    run,
    log: message => console.log(message),
  }
}

/**
 * Build one unsigned Linux AppImage for the current host architecture.
 * @param options - Injectable process and command boundaries.
 */
export function packageLinuxAppImage(
  options: LinuxPackageOptions = defaultOptions(),
): void {
  if (options.platform !== 'linux') {
    throw new Error('Linux AppImage must be built on a native Linux host')
  }
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`Linux AppImage requires x64 or arm64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new Error(
      `Linux AppImage requires Node 22.19+ or Node 24+; received ${options.nodeVersion}`,
    )
  }

  const archFlag = options.arch === 'arm64' ? '--arm64' : '--x64'
  options.log(`Building an unsigned Linux ${options.arch} AppImage.`)
  options.run(
    options.commandShell,
    ['-c', 'corepack yarn workspace dsh-plugin-desktop check:linux-package'],
    options.workspaceRoot,
    options.env,
  )
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--linux',
      'AppImage',
      archFlag,
      '--publish',
      'never',
      '--config.npmRebuild=false',
    ],
    options.desktopRoot,
    { ...options.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  )
  if (!options.exists(options.expectedArtifact)) {
    throw new Error(`electron-builder did not produce ${options.expectedArtifact}`)
  }
  if (!options.isExecutable(options.expectedArtifact)) {
    throw new Error(`${options.expectedArtifact} is not executable`)
  }
  options.log(`Wrote ${options.expectedArtifact}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageLinuxAppImage()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
