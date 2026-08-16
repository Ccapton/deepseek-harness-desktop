/** Install a built Linux AppImage as a desktop application with a launcher entry. */

import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fields written into the freedesktop `.desktop` launcher entry. */
export interface DesktopEntry {
  /** Visible application name. */
  readonly name: string
  /** Longer localized application name. */
  readonly genericName: string
  /** One-line description shown in tooltips. */
  readonly comment: string
  /** Absolute path the launcher executes. */
  readonly execPath: string
  /** Installed icon name without an extension. */
  readonly icon: string
  /** Whether the launcher opens a terminal. */
  readonly terminal: boolean
  /** Semicolon-separated freedesktop categories. */
  readonly categories: string
  /** X11 WM class used to group the running window. */
  readonly startupWmClass: string
  /** Semicolon-separated search keywords. */
  readonly keywords: string
}

/**
 * Render a freedesktop `.desktop` launcher entry.
 * @param entry - Launcher metadata.
 * @returns The complete `.desktop` file content.
 */
export function desktopEntryContent(entry: DesktopEntry): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${entry.name}`,
    `GenericName=${entry.genericName}`,
    `Comment=${entry.comment}`,
    `Exec="${entry.execPath}" %U`,
    `Icon=${entry.icon}`,
    `Terminal=${entry.terminal ? 'true' : 'false'}`,
    `Categories=${entry.categories}`,
    `StartupWMClass=${entry.startupWmClass}`,
    `Keywords=${entry.keywords}`,
    '',
  ].join('\n')
}

/** Injectable filesystem and command boundaries for desktop installation. */
export interface LinuxDesktopInstallOptions {
  /** Source AppImage produced by the packaging step. */
  readonly appImagePath: string
  /** Directory receiving the installed AppImage copy. */
  readonly installDir: string
  /** Directory receiving the launcher entry. */
  readonly appsDir: string
  /** hicolor icon theme root receiving the resized icons. */
  readonly iconsRoot: string
  /** Source application artwork. */
  readonly iconSource: string
  /** Launcher metadata written to the `.desktop` entry. */
  readonly entry: DesktopEntry
  /** Icon name installed into the hicolor theme. */
  readonly iconName: string
  /** Square icon sizes to install. */
  readonly iconSizes: readonly number[]
  /** Report whether a file exists. */
  readonly exists: (path: string) => boolean
  /** Report whether a file is executable. */
  readonly isExecutable: (path: string) => boolean
  /** Create a directory recursively. */
  readonly mkdir: (path: string) => void
  /** Copy a file to a destination. */
  readonly copyFile: (from: string, to: string) => void
  /** Write UTF-8 text to a file. */
  readonly writeText: (path: string, content: string) => void
  /** Return an available ImageMagick executable, if any. */
  readonly findImageTool: () => string | undefined
  /** Execute one command that must succeed. */
  readonly run: (command: string, args: readonly string[]) => void
  /** Execute one optional cache refresh without failing the install. */
  readonly runBestEffort: (command: string, args: readonly string[]) => void
  /** Report install progress. */
  readonly log: (message: string) => void
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

function mkdir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function copyFile(from: string, to: string): void {
  copyFileSync(from, to)
}

function writeText(path: string, content: string): void {
  writeFileSync(path, content, 'utf8')
}

function findImageTool(): string | undefined {
  for (const tool of ['magick', 'convert']) {
    const result = spawnSync(tool, ['-version'], { stdio: 'ignore' })
    if (result.error === undefined && result.status === 0) return tool
  }
  return undefined
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function runBestEffort(command: string, args: readonly string[]): void {
  spawnSync(command, args, { stdio: 'ignore' })
}

function defaultOptions(): LinuxDesktopInstallOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const require = createRequire(import.meta.url)
  const manifest = require('../package.json') as { readonly version: string }
  const home = homedir()
  const installDir = join(home, 'Applications')
  const appImagePath = resolve(
    process.argv[2] ?? join(desktopRoot, 'dist', `DSH Desktop-${manifest.version}.AppImage`),
  )
  return {
    appImagePath,
    installDir,
    appsDir: join(home, '.local', 'share', 'applications'),
    iconsRoot: join(home, '.local', 'share', 'icons', 'hicolor'),
    iconSource: join(desktopRoot, 'build', 'app-icon.png'),
    entry: {
      name: 'DSH Desktop',
      genericName: 'DeepSeek Harness Desktop',
      comment: 'DeepSeek Harness desktop shell',
      execPath: join(installDir, basename(appImagePath)),
      icon: 'dsh-desktop',
      terminal: false,
      categories: 'Development;',
      startupWmClass: 'DSH Desktop',
      keywords: 'deepseek;harness;dsh;ai;',
    },
    iconName: 'dsh-desktop',
    iconSizes: [128, 256, 512],
    exists,
    isExecutable,
    mkdir,
    copyFile,
    writeText,
    findImageTool,
    run,
    runBestEffort,
    log: message => console.log(message),
  }
}

/**
 * Install an AppImage to the user Applications directory and register a launcher entry.
 * @param options - Filesystem and command boundaries.
 */
export function installLinuxDesktop(
  options: LinuxDesktopInstallOptions = defaultOptions(),
): void {
  if (!options.exists(options.appImagePath)) {
    throw new Error(`AppImage not found: ${options.appImagePath}`)
  }
  if (!options.isExecutable(options.appImagePath)) {
    throw new Error(`AppImage is not executable: ${options.appImagePath}`)
  }

  const installedAppImage = join(options.installDir, basename(options.appImagePath))
  options.mkdir(options.installDir)
  try {
    options.copyFile(options.appImagePath, installedAppImage)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ETXTBSY') {
      throw new Error(
        `Cannot overwrite ${installedAppImage} because it is currently running; close DSH Desktop and retry`,
      )
    }
    throw error
  }
  options.log(`Installed AppImage to ${installedAppImage}`)

  const desktopPath = join(options.appsDir, `${options.iconName}.desktop`)
  options.mkdir(options.appsDir)
  options.writeText(
    desktopPath,
    desktopEntryContent({ ...options.entry, execPath: installedAppImage }),
  )
  options.log(`Wrote desktop entry to ${desktopPath}`)

  const imageTool = options.findImageTool()
  for (const size of options.iconSizes) {
    const dest = join(options.iconsRoot, `${size}x${size}`, 'apps', `${options.iconName}.png`)
    options.mkdir(dirname(dest))
    if (imageTool === undefined) {
      options.copyFile(options.iconSource, dest)
    } else {
      options.run(imageTool, [options.iconSource, '-resize', `${size}x${size}`, dest])
    }
  }
  options.log(`Installed icons to ${options.iconsRoot}`)

  options.runBestEffort('update-desktop-database', [options.appsDir])
  options.runBestEffort('gtk-update-icon-cache', ['-f', options.iconsRoot])
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    installLinuxDesktop()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
