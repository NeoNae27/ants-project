import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createWorkspaceConnectionLines,
  filterConnectionsForMode,
  findPossibleWorkspaceConnections
} from '../../src/renderer/src/workspace/workspaceConnections'
import type {
  WorkspaceDevice,
  WorkspaceModule,
  WorkspaceProject
} from '../../src/renderer/src/workspace/types'

const project: WorkspaceProject = {
  id: 'project-a',
  name: 'Test project',
  width: 1000,
  height: 1000,
  unitScaleMeters: 10
}

function createLoRaModule(id: string, maxRangeMeters = 1000): WorkspaceModule {
  return {
    id,
    kind: 'network',
    name: 'LoRa network',
    model: 'SX1276 Stub',
    status: 'new',
    communication: {
      protocol: 'lora',
      maxRangeMeters,
      spreadingFactor: 12,
      bandwidthHz: 125_000,
      txPowerDbm: 14,
      codingRate: '4/5',
      sourceLabel: 'Test preset'
    }
  }
}

function createDevice(params: {
  id: string
  x: number
  y: number
  modules?: WorkspaceModule[]
}): WorkspaceDevice {
  return {
    id: params.id,
    name: params.id,
    model: 'ANT-UI-100',
    role: 'node',
    status: 'new',
    executionState: 'idle',
    config: {
      heartbeatIntervalMs: 60_000,
      transmissionIntervalMs: 300_000,
      maxRetries: 3,
      powerMode: 'normal'
    },
    modules: params.modules ?? [],
    bufferSize: 0,
    x: params.x,
    y: params.y
  }
}

describe('workspace connections', () => {
  it('connects only LoRa-capable devices inside source range', () => {
    const devices = [
      createDevice({ id: 'source', x: 100, y: 100, modules: [createLoRaModule('source-lora')] }),
      createDevice({ id: 'target', x: 150, y: 100, modules: [createLoRaModule('target-lora')] }),
      createDevice({ id: 'no-lora', x: 120, y: 100 }),
      createDevice({ id: 'far', x: 500, y: 500, modules: [createLoRaModule('far-lora')] })
    ]

    const connections = findPossibleWorkspaceConnections({ project, devices })

    assert.ok(
      connections.some(
        (connection) =>
          connection.sourceDeviceId === 'source' && connection.targetDeviceId === 'target'
      )
    )
    assert.ok(
      !connections.some((connection) => connection.targetDeviceId === 'no-lora')
    )
    assert.ok(!connections.some((connection) => connection.targetDeviceId === 'far'))
  })

  it('uses source range for directed links', () => {
    const devices = [
      createDevice({ id: 'short', x: 100, y: 100, modules: [createLoRaModule('short-lora', 200)] }),
      createDevice({ id: 'long', x: 150, y: 100, modules: [createLoRaModule('long-lora', 1000)] })
    ]

    const connections = findPossibleWorkspaceConnections({ project, devices })

    assert.ok(!connections.some((connection) => connection.sourceDeviceId === 'short'))
    assert.ok(
      connections.some(
        (connection) => connection.sourceDeviceId === 'long' && connection.targetDeviceId === 'short'
      )
    )
  })

  it('filters selected mode and keeps all mode', () => {
    const devices = [
      createDevice({ id: 'a', x: 100, y: 100, modules: [createLoRaModule('a-lora')] }),
      createDevice({ id: 'b', x: 150, y: 100, modules: [createLoRaModule('b-lora')] }),
      createDevice({ id: 'c', x: 170, y: 100, modules: [createLoRaModule('c-lora')] })
    ]
    const connections = findPossibleWorkspaceConnections({ project, devices })

    assert.equal(
      filterConnectionsForMode({
        connections,
        selectedDeviceId: 'a',
        mode: 'selected'
      }).every((connection) => connection.sourceDeviceId === 'a'),
      true
    )
    assert.equal(
      filterConnectionsForMode({
        connections,
        selectedDeviceId: 'a',
        mode: 'all'
      }).length,
      connections.length
    )
  })

  it('deduplicates visual lines for bidirectional links', () => {
    const devices = [
      createDevice({ id: 'a', x: 100, y: 100, modules: [createLoRaModule('a-lora')] }),
      createDevice({ id: 'b', x: 150, y: 100, modules: [createLoRaModule('b-lora')] })
    ]
    const connections = findPossibleWorkspaceConnections({ project, devices })
    const lines = createWorkspaceConnectionLines({
      connections,
      selectedDeviceId: 'a'
    })

    assert.equal(lines.length, 1)
    assert.equal(lines[0].connectionCount, 2)
    assert.equal(lines[0].isSelected, true)
  })
})
