import { describe, expect, it } from 'vitest'
import {
  packageLinuxAppImage,
  type LinuxPackageOptions,
} from '../scripts/package-linux.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function options(
  calls: CommandCall[],
  logs: string[] = [],
  events: string[] = [],
): LinuxPackageOptions {
  return {
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    arch: 'x64',
    nodeVersion: '22.23.2',
    workspaceRoot: '/repo',
    desktopRoot: '/repo/dsh-plugin-desktop',
    commandShell: '/bin/sh',
    builderCli: '/repo/node_modules/electron-builder/cli.js',
    prepareNative: arch => {
      events.push(`prepare:${arch}`)
    },
    nodeExecutable: '/usr/bin/node',
    expectedArtifact: '/repo/dsh-plugin-desktop/dist/DSH Desktop-2.0.0.AppImage',
    exists: () => true,
    isExecutable: () => true,
    run: (command, args, cwd, env) => {
      events.push(`run:${command}`)
      calls.push({ command, args: [...args], cwd, env: { ...env } })
    },
    log: message => logs.push(message),
  }
}

describe('Linux AppImage packaging', () => {
  it('checks the desktop package, prepares the native binding, builds an unsigned AppImage, then verifies it', () => {
    const calls: CommandCall[] = []
    const logs: string[] = []
    const events: string[] = []

    packageLinuxAppImage(options(calls, logs, events))

    expect(events).toEqual(['run:/bin/sh', 'prepare:x64', 'run:/usr/bin/node'])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      command: '/bin/sh',
      args: ['-c', 'corepack yarn workspace dsh-plugin-desktop check:linux-package'],
      cwd: '/repo',
      env: { PATH: '/usr/bin' },
    })
    expect(calls[1]).toEqual({
      command: '/usr/bin/node',
      args: [
        '/repo/node_modules/electron-builder/cli.js',
        '--linux',
        'AppImage',
        '--x64',
        '--publish',
        'never',
        '--config.npmRebuild=false',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
      },
    })
    expect(logs).toEqual([
      'Building an unsigned Linux x64 AppImage.',
      'Wrote /repo/dsh-plugin-desktop/dist/DSH Desktop-2.0.0.AppImage',
    ])
  })

  it('uses --arm64 and prepares the arm64 binding for an arm64 host', () => {
    const calls: CommandCall[] = []
    const events: string[] = []
    packageLinuxAppImage({ ...options(calls, [], events), arch: 'arm64' })
    expect(calls[1]?.args).toContain('--arm64')
    expect(events).toEqual(['run:/bin/sh', 'prepare:arm64', 'run:/usr/bin/node'])
  })

  it.each([
    ['darwin', 'x64', '22.23.2', 'native Linux host'],
    ['linux', 'ia32', '22.23.2', 'x64 or arm64'],
    ['linux', 'x64', '20.0.0', 'Node 22.19+ or Node 24+'],
  ] as const)(
    'rejects unsupported host %s/%s with Node %s before running commands',
    (platform, arch, nodeVersion, message) => {
      const calls: CommandCall[] = []
      const events: string[] = []
      const value = { ...options(calls, [], events), platform, arch, nodeVersion }

      expect(() => packageLinuxAppImage(value)).toThrow(message)
      expect(events).toEqual([])
      expect(calls).toEqual([])
    },
  )

  it('fails when the artifact is missing or not executable', () => {
    const missingCalls: CommandCall[] = []
    expect(() => packageLinuxAppImage({ ...options(missingCalls), exists: () => false }))
      .toThrow('did not produce')

    const notExecutableCalls: CommandCall[] = []
    expect(() => packageLinuxAppImage({ ...options(notExecutableCalls), isExecutable: () => false }))
      .toThrow('not executable')
  })
})
