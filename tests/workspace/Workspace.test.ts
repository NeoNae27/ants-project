import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceCore } from '../../src/engine/domain/device/DeviceCore'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { ModuleKind } from '../../src/engine/domain/module'
import { StubModule } from '../../src/engine/domain/modules'
import type { SpatialIndex, SpatialIndexStats, SpatialSearchResult } from '../../src/engine/domain/spatial'
import { Workspace, WorkspaceError } from '../../src/engine/domain/workspace'
import type { WorkspaceConfig, WorkspacePosition } from '../../src/engine/domain/workspace'

function createWorkspace(config?: Partial<WorkspaceConfig>): Workspace {
  return new Workspace({
    id: 'workspace-1',
    name: 'Test workspace',
    width: 100,
    height: 100,
    metersPerUnit: 10,
    cellSize: 10,
    ...config,
  })
}

function createLoRaLikeModule(id: string): StubModule {
  return new StubModule(id, ModuleKind.NETWORK, 'LoRa network', 'SX1276 Stub', '1.0.0', {
    radio: {
      maxRangeMeters: 1000,
    },
  })
}

function createDevice(id: string, role = DeviceRole.NODE, modules: StubModule[] = []): DeviceCore {
  const device = new DeviceCore({
    id,
    model: 'ANT-TEST',
    version: '1.0.0',
    role,
    name: id,
    config: {
      heartbeatIntervalMs: 60_000,
      transmissionIntervalMs: 300_000,
      maxRetries: 3,
      powerMode: 'normal',
    },
  })

  modules.forEach((module) => device.addModule(module))

  return device
}

function assertWorkspaceError(error: unknown, code: string): void {
  assert.ok(error instanceof WorkspaceError)
  assert.equal(error.code, code)
}

function createSpatialIndex(overrides?: Partial<SpatialIndex>): SpatialIndex {
  const positions = new Map<string, WorkspacePosition>()

  const base: SpatialIndex = {
    insert(deviceId, position): void {
      positions.set(deviceId, { ...position })
    },
    update(deviceId, nextPosition): void {
      positions.set(deviceId, { ...nextPosition })
    },
    remove(deviceId): void {
      positions.delete(deviceId)
    },
    getPosition(deviceId): WorkspacePosition | undefined {
      const position = positions.get(deviceId)
      return position ? { ...position } : undefined
    },
    findNearby(): string[] {
      return []
    },
    findNearbyWithDistance(): SpatialSearchResult[] {
      return []
    },
    clear(): void {
      positions.clear()
    },
    size(): number {
      return positions.size
    },
    getStats(): SpatialIndexStats {
      return {
        deviceCount: positions.size,
        cellCount: positions.size,
        maxDevicesInCell: positions.size > 0 ? 1 : 0,
        averageDevicesPerCell: positions.size > 0 ? 1 : 0,
        cellSize: 10,
      }
    },
  }

  return { ...base, ...overrides }
}

describe('Workspace', () => {
  it('accepts valid config and rejects invalid config', () => {
    const workspace = createWorkspace()

    assert.deepEqual(workspace.getConfig(), {
      id: 'workspace-1',
      name: 'Test workspace',
      width: 100,
      height: 100,
      metersPerUnit: 10,
    })

    assert.throws(
      () => createWorkspace({ width: 0 }),
      (error) => {
        assertWorkspaceError(error, 'WORKSPACE_CONFIG_INVALID')
        return true
      },
    )
    assert.throws(
      () => createWorkspace({ id: ' ' }),
      (error) => {
        assertWorkspaceError(error, 'WORKSPACE_CONFIG_INVALID')
        return true
      },
    )
  })

  it('adds devices to registry, placement and spatial lookup', () => {
    const workspace = createWorkspace()
    const source = createDevice('node-1', DeviceRole.NODE, [createLoRaLikeModule('node-1-lora')])
    const target = createDevice('node-2')

    workspace.addDevice(source, { x: 10, y: 10 }, {
      endpoints: [{ deviceId: 'node-1', moduleId: 'node-1-lora', protocol: 'lora', address: 'lora-node-1' }],
    })
    workspace.addDevice(target, { x: 13, y: 14 })

    assert.equal(workspace.hasDevice('node-1'), true)
    assert.equal(workspace.getDevice('node-1'), source)
    assert.equal(workspace.getDeviceByAddress('lora-node-1'), source)
    assert.deepEqual(workspace.getDevicePosition('node-1'), { x: 10, y: 10 })
    assert.deepEqual(workspace.listDevices(), [source, target])
    assert.deepEqual(workspace.findNearbyDevices('node-1', 60), [
      {
        deviceId: 'node-2',
        distanceUnits: 5,
        distanceMeters: 50,
      },
    ])
    assert.equal(workspace.validate().valid, true)
  })

  it('lists devices by role', () => {
    const workspace = createWorkspace()
    const node = createDevice('node-1', DeviceRole.NODE)
    const gateway = createDevice('gateway-1', DeviceRole.GATEWAY)

    workspace.addDevice(node, { x: 1, y: 1 })
    workspace.addDevice(gateway, { x: 2, y: 2 })

    assert.deepEqual(workspace.listDevicesByRole(DeviceRole.NODE), [node])
    assert.deepEqual(workspace.listDevicesByRole(DeviceRole.GATEWAY), [gateway])
  })

  it('rejects duplicate device placement and out-of-bounds position', () => {
    const workspace = createWorkspace()
    const device = createDevice('node-1')

    workspace.addDevice(device, { x: 10, y: 10 })

    assert.throws(
      () => workspace.addDevice(device, { x: 20, y: 20 }),
      (error) => {
        assertWorkspaceError(error, 'WORKSPACE_DEVICE_ALREADY_PLACED')
        return true
      },
    )
    assert.throws(
      () => workspace.addDevice(createDevice('node-2'), { x: 101, y: 10 }),
      (error) => {
        assertWorkspaceError(error, 'WORKSPACE_POSITION_OUT_OF_BOUNDS')
        return true
      },
    )
  })

  it('rolls back registry add when spatial insert fails', () => {
    const workspace = new Workspace(
      {
        id: 'workspace-1',
        name: 'Test workspace',
        width: 100,
        height: 100,
        metersPerUnit: 10,
      },
      {
        spatialIndex: createSpatialIndex({
          insert(): void {
            throw new Error('insert failed')
          },
        }),
      },
    )

    assert.throws(() => workspace.addDevice(createDevice('node-1'), { x: 10, y: 10 }))
    assert.equal(workspace.hasDevice('node-1'), false)
    assert.equal(workspace.getDevicePosition('node-1'), undefined)
  })

  it('removes devices from registry, spatial and placement indexes', () => {
    const workspace = createWorkspace()
    const source = createDevice('node-1', DeviceRole.NODE, [createLoRaLikeModule('node-1-lora')])
    const target = createDevice('node-2')

    workspace.addDevice(source, { x: 10, y: 10 }, {
      endpoints: [{ deviceId: 'node-1', moduleId: 'node-1-lora', protocol: 'lora', address: 'lora-node-1' }],
    })
    workspace.addDevice(target, { x: 13, y: 14 })
    workspace.removeDevice('node-2')

    assert.equal(workspace.hasDevice('node-2'), false)
    assert.equal(workspace.getDevicePosition('node-2'), undefined)
    assert.deepEqual(workspace.findNearbyDevices('node-1', 60), [])
    assert.equal(workspace.validate().valid, true)
  })

  it('moves devices through spatial index before updating placement', () => {
    const workspace = createWorkspace()
    const source = createDevice('node-1')
    const target = createDevice('node-2')

    workspace.addDevice(source, { x: 10, y: 10 })
    workspace.addDevice(target, { x: 90, y: 90 })
    workspace.moveDevice('node-2', { x: 13, y: 14 })

    assert.deepEqual(workspace.getDevicePosition('node-2'), { x: 13, y: 14 })
    assert.deepEqual(workspace.findNearbyDevices('node-1', 60), [
      {
        deviceId: 'node-2',
        distanceUnits: 5,
        distanceMeters: 50,
      },
    ])
  })

  it('keeps old placement when spatial update fails', () => {
    const workspace = new Workspace(
      {
        id: 'workspace-1',
        name: 'Test workspace',
        width: 100,
        height: 100,
        metersPerUnit: 10,
      },
      {
        spatialIndex: createSpatialIndex({
          update(): void {
            throw new Error('update failed')
          },
        }),
      },
    )

    workspace.addDevice(createDevice('node-1'), { x: 10, y: 10 })

    assert.throws(() => workspace.moveDevice('node-1', { x: 20, y: 20 }))
    assert.deepEqual(workspace.getDevicePosition('node-1'), { x: 10, y: 10 })
  })

  it('converts nearby search range from meters to units and excludes source device', () => {
    const workspace = createWorkspace({ metersPerUnit: 10 })

    workspace.addDevice(createDevice('node-1'), { x: 0, y: 0 })
    workspace.addDevice(createDevice('node-2'), { x: 3, y: 4 })
    workspace.addDevice(createDevice('node-3'), { x: 10, y: 10 })

    assert.deepEqual(workspace.findNearbyDevices('node-1', 60), [
      {
        deviceId: 'node-2',
        distanceUnits: 5,
        distanceMeters: 50,
      },
    ])
  })

  it('does not expose public mutable registry access', () => {
    const workspace = createWorkspace()
    const record = workspace as unknown as Record<string, unknown>
    const queries = workspace.getRegistryQueries() as unknown as Record<string, unknown>

    assert.equal('getRegistry' in record, false)
    assert.equal('add' in queries, false)
    assert.equal('remove' in queries, false)
    assert.equal('registerAddress' in queries, false)
    assert.equal('clear' in queries, false)
    assert.equal(typeof record.getDevice, 'function')
    assert.equal(typeof record.listDevices, 'function')
  })

  it('assigns and resolves LoRa addresses through workspace domain API', () => {
    const workspace = createWorkspace()
    const node = createDevice('node-1', DeviceRole.NODE, [createLoRaLikeModule('node-1-lora')])
    const gateway = createDevice('gateway-1', DeviceRole.GATEWAY, [createLoRaLikeModule('gateway-1-lora')])

    workspace.addDevice(node, { x: 10, y: 10 })
    workspace.addDevice(gateway, { x: 20, y: 20 })
    workspace.assignDeviceLoRaAddress('node-1', 'lora-node-1')

    assert.equal(workspace.getRegistryQueries().getByLoRaAddress('lora-node-1'), node)
    assert.equal(workspace.getRegistryQueries().getLoRaAddress('node-1'), 'lora-node-1')
    assert.throws(() => workspace.assignDeviceLoRaAddress('gateway-1', 'lora-node-1'))
  })

  it('creates serializable snapshots independent from internal maps', () => {
    const workspace = createWorkspace()
    const device = createDevice('node-1', DeviceRole.NODE, [createLoRaLikeModule('node-1-lora')])

    workspace.addDevice(device, { x: 10, y: 20 }, {
      endpoints: [{ deviceId: 'node-1', moduleId: 'node-1-lora', protocol: 'lora', address: 'lora-node-1' }],
    })

    const snapshot = workspace.getSnapshot()
    const encoded = JSON.stringify(snapshot)
    const decoded = JSON.parse(encoded)

    assert.deepEqual(decoded, {
      id: 'workspace-1',
      name: 'Test workspace',
      width: 100,
      height: 100,
      metersPerUnit: 10,
      devices: [
        {
          id: 'node-1',
          info: {
            id: 'node-1',
            model: 'ANT-TEST',
            name: 'node-1',
            version: '1.0.0',
            role: DeviceRole.NODE,
            lifecycleState: 'new',
            executionState: 'idle',
            moduleCount: 1,
            bufferSize: 0,
          },
          config: {
            heartbeatIntervalMs: 60000,
            transmissionIntervalMs: 300000,
            maxRetries: 3,
            powerMode: 'normal',
          },
          position: { x: 10, y: 20 },
          address: 'lora-node-1',
          networkEndpoints: [
            {
              deviceId: 'node-1',
              moduleId: 'node-1-lora',
              protocol: 'lora',
              address: 'lora-node-1',
            },
          ],
          modules: [
            {
              id: 'node-1-lora',
              kind: 'network',
              name: 'LoRa network',
              model: 'SX1276 Stub',
              version: '1.0.0',
              lifecycleState: 'new',
              executionState: 'idle',
              communication: {
                protocol: 'lora',
                maxRangeMeters: 1000,
                maxConnections: 8,
                spreadingFactor: 12,
                bandwidthHz: 125000,
                txPowerDbm: 14,
                codingRate: '4/5',
                sourceLabel: 'LoRa module config',
              },
              config: {
                radio: {
                  maxRangeMeters: 1000,
                },
              },
            },
          ],
        },
      ],
      possibleConnections: [],
    })
    assert.equal(snapshot.devices[0].position === workspace.getDevicePosition('node-1'), false)
  })
})
