import { describe, expect, it } from 'vitest'
import {
  desktopEntryContent,
  installLinuxDesktop,
  type LinuxDesktopInstallOptions,
} from '../scripts/install-linux-desktop.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
}

interface Writes {
  readonly madeDirs: string[]
  readonly copiedFiles: Array<{ readonly from: string; readonly to: string }>
  readonly writtenText: Array<{ readonly path: string; readonly content: string }>
  readonly runCalls: CommandCall[]
  readonly bestEffortCalls: CommandCall[]
  readonly logs: string[]
}

function makeOptions(overrides: Partial<LinuxDesktopInstallOptions> = {}): {
  readonly options: LinuxDesktopInstallOptions
  readonly writes: Writes
} {
  const writes: Writes = {
    madeDirs: [],
    copiedFiles: [],
    writtenText: [],
    runCalls: [],
    bestEffortCalls: [],
    logs: [],
  }
  const base: LinuxDesktopInstallOptions = {
    appImagePath: '/repo/dist/DSH Desktop-2.0.0.AppImage',
    installDir: '/home/user/Applications',
    appsDir: '/home/user/.local/share/applications',
    iconsRoot: '/home/user/.local/share/icons/hicolor',
    iconSource: '/repo/build/app-icon.png',
    entry: {
      name: 'DSH Desktop',
      genericName: 'DeepSeek Harness Desktop',
      comment: 'DeepSeek Harness desktop shell',
      execPath: '/home/user/Applications/DSH Desktop-2.0.0.AppImage',
      icon: 'dsh-desktop',
      terminal: false,
      categories: 'Development;',
      startupWmClass: 'DSH Desktop',
      keywords: 'deepseek;harness;dsh;ai;',
    },
    iconName: 'dsh-desktop',
    iconSizes: [128, 256, 512],
    exists: () => true,
    isExecutable: () => true,
    mkdir: path => writes.madeDirs.push(path),
    copyFile: (from, to) => writes.copiedFiles.push({ from, to }),
    writeText: (path, content) => writes.writtenText.push({ path, content }),
    findImageTool: () => 'magick',
    run: (command, args) => writes.runCalls.push({ command, args: [...args] }),
    runBestEffort: (command, args) => writes.bestEffortCalls.push({ command, args: [...args] }),
    log: message => writes.logs.push(message),
  }
  return { options: { ...base, ...overrides }, writes }
}

describe('desktop entry content', () => {
  it('renders a launcher entry with a quoted Exec path', () => {
    const content = desktopEntryContent({
      name: 'DSH Desktop',
      genericName: 'DeepSeek Harness Desktop',
      comment: 'DeepSeek Harness desktop shell',
      execPath: '/home/user/Applications/DSH Desktop-2.0.0.AppImage',
      icon: 'dsh-desktop',
      terminal: false,
      categories: 'Development;',
      startupWmClass: 'DSH Desktop',
      keywords: 'deepseek;harness;dsh;ai;',
    })

    expect(content).toBe([
      '[Desktop Entry]',
      'Type=Application',
      'Name=DSH Desktop',
      'GenericName=DeepSeek Harness Desktop',
      'Comment=DeepSeek Harness desktop shell',
      'Exec="/home/user/Applications/DSH Desktop-2.0.0.AppImage" %U',
      'Icon=dsh-desktop',
      'Terminal=false',
      'Categories=Development;',
      'StartupWMClass=DSH Desktop',
      'Keywords=deepseek;harness;dsh;ai;',
      '',
    ].join('\n'))
  })
})

describe('Linux desktop installation', () => {
  it('copies the AppImage, writes the entry, installs icons, then refreshes caches', () => {
    const { options, writes } = makeOptions()

    installLinuxDesktop(options)

    expect(writes.madeDirs).toContain('/home/user/Applications')
    expect(writes.madeDirs).toContain('/home/user/.local/share/applications')
    expect(writes.copiedFiles).toEqual([
      {
        from: '/repo/dist/DSH Desktop-2.0.0.AppImage',
        to: '/home/user/Applications/DSH Desktop-2.0.0.AppImage',
      },
    ])
    expect(writes.writtenText).toEqual([{
      path: '/home/user/.local/share/applications/dsh-desktop.desktop',
      content: desktopEntryContent({
        name: 'DSH Desktop',
        genericName: 'DeepSeek Harness Desktop',
        comment: 'DeepSeek Harness desktop shell',
        execPath: '/home/user/Applications/DSH Desktop-2.0.0.AppImage',
        icon: 'dsh-desktop',
        terminal: false,
        categories: 'Development;',
        startupWmClass: 'DSH Desktop',
        keywords: 'deepseek;harness;dsh;ai;',
      }),
    }])
    expect(writes.runCalls).toEqual([
      { command: 'magick', args: ['/repo/build/app-icon.png', '-resize', '128x128', '/home/user/.local/share/icons/hicolor/128x128/apps/dsh-desktop.png'] },
      { command: 'magick', args: ['/repo/build/app-icon.png', '-resize', '256x256', '/home/user/.local/share/icons/hicolor/256x256/apps/dsh-desktop.png'] },
      { command: 'magick', args: ['/repo/build/app-icon.png', '-resize', '512x512', '/home/user/.local/share/icons/hicolor/512x512/apps/dsh-desktop.png'] },
    ])
    expect(writes.bestEffortCalls).toEqual([
      { command: 'update-desktop-database', args: ['/home/user/.local/share/applications'] },
      { command: 'gtk-update-icon-cache', args: ['-f', '/home/user/.local/share/icons/hicolor'] },
    ])
    expect(writes.logs).toEqual([
      'Installed AppImage to /home/user/Applications/DSH Desktop-2.0.0.AppImage',
      'Wrote desktop entry to /home/user/.local/share/applications/dsh-desktop.desktop',
      'Installed icons to /home/user/.local/share/icons/hicolor',
    ])
  })

  it('falls back to copying the source artwork when ImageMagick is absent', () => {
    const { options, writes } = makeOptions({ findImageTool: () => undefined })

    installLinuxDesktop(options)

    expect(writes.runCalls).toEqual([])
    expect(writes.copiedFiles.map(file => file.to)).toEqual([
      '/home/user/Applications/DSH Desktop-2.0.0.AppImage',
      '/home/user/.local/share/icons/hicolor/128x128/apps/dsh-desktop.png',
      '/home/user/.local/share/icons/hicolor/256x256/apps/dsh-desktop.png',
      '/home/user/.local/share/icons/hicolor/512x512/apps/dsh-desktop.png',
    ])
  })

  it('reports a clear error when the installed AppImage is still running', () => {
    const busyError = Object.assign(new Error('text file is busy'), { code: 'ETXTBSY' })
    const { options } = makeOptions({ copyFile: () => { throw busyError } })

    expect(() => installLinuxDesktop(options)).toThrow('currently running')
  })

  it('rejects a missing or non-executable AppImage before writing anything', () => {
    const missing = makeOptions({ exists: () => false })
    expect(() => installLinuxDesktop(missing.options)).toThrow('not found')
    expect(missing.writes.madeDirs).toEqual([])

    const notExecutable = makeOptions({ isExecutable: () => false })
    expect(() => installLinuxDesktop(notExecutable.options)).toThrow('not executable')
    expect(notExecutable.writes.madeDirs).toEqual([])
  })
})
