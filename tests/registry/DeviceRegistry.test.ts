import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceCore } from '../../src/engine/domain/device/DeviceCore'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { ModuleKind } from '../../src/engine/domain/module'
import { StubModule } from '../../src/engine/domain/modules'
import { DeviceRegistry, DeviceRegistryError, type NetworkEndpoint } from '../../src/engine/domain/registry'

function createModule(id: string, kind = ModuleKind.NETWORK): StubModule {
  return new StubModule(id, kind, `${kind} module`, `${kind.toUpperCase()}-STUB`, '1.0.0')
}

function createDevice(id: string, role = DeviceRole.NODE, modules = [createModule(`${id}-lora`)]): DeviceCore {
  const device = new DeviceCore({
    id,
    model: 'ANT-TEST',
    version: '1.0.0',
    role,
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

function createEndpoint(deviceId: string, moduleId = `${deviceId}-lora`, address = `lora-${deviceId}`): NetworkEndpoint {
  return {
    deviceId,
    moduleId,
    protocol: 'lora',
    address,
  }
}

function assertRegistryError(error: unknown, code: string): void {
  assert.ok(error instanceof DeviceRegistryError)
  assert.equal(error.code, code)
}

describe('DeviceRegistry', () => {
  it('adds and retrieves a device by id', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device)

    assert.equal(registry.size(), 1)
    assert.equal(registry.moduleSize(), 1)
    assert.equal(registry.has('node-1'), true)
    assert.equal(registry.get('node-1'), device)
    assert.equal(registry.getOrThrow('node-1'), device)
    assert.deepEqual(registry.list(), [device])
  })

  it('rejects duplicate device id', () => {
    const registry = new DeviceRegistry()

    registry.add(createDevice('node-1'))

    assert.throws(
      () => registry.add(createDevice('node-1')),
      (error) => {
        assertRegistryError(error, 'REGISTRY_DEVICE_ALREADY_EXISTS')
        return true
      },
    )
  })

  it('throws typed error for missing device', () => {
    const registry = new DeviceRegistry()

    assert.equal(registry.get('missing'), undefined)
    assert.throws(
      () => registry.getOrThrow('missing'),
      (error) => {
        assertRegistryError(error, 'REGISTRY_DEVICE_NOT_FOUND')
        return true
      },
    )
  })

  it('rejects empty ids and endpoint inputs', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device)

    assert.throws(
      () => registry.get(' '),
      (error) => {
        assertRegistryError(error, 'REGISTRY_DEVICE_ID_REQUIRED')
        return true
      },
    )
    assert.throws(
      () => registry.registerEndpoint({ ...createEndpoint('node-1'), address: ' ' }),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_REQUIRED')
        return true
      },
    )
    assert.throws(
      () => registry.registerEndpoint({ ...createEndpoint('node-1'), moduleId: ' ' }),
      (error) => {
        assertRegistryError(error, 'REGISTRY_MODULE_ID_REQUIRED')
        return true
      },
    )
  })

  it('lists devices by role', () => {
    const registry = new DeviceRegistry()
    const node = createDevice('node-1', DeviceRole.NODE)
    const repeater = createDevice('repeater-1', DeviceRole.REPEATER)
    const gateway = createDevice('gateway-1', DeviceRole.GATEWAY)

    registry.add(node)
    registry.add(repeater)
    registry.add(gateway)

    assert.deepEqual(registry.listByRole(DeviceRole.NODE), [node])
    assert.deepEqual(registry.listByRole(DeviceRole.REPEATER), [repeater])
    assert.deepEqual(registry.listByRole(DeviceRole.GATEWAY), [gateway])
  })

  it('indexes modules by id and device id', () => {
    const registry = new DeviceRegistry()
    const lora = createModule('node-1-lora')
    const ble = createModule('node-1-ble')
    const device = createDevice('node-1', DeviceRole.NODE, [lora, ble])

    registry.add(device)

    assert.equal(registry.getModule('node-1-lora')?.module, lora)
    assert.deepEqual(
      registry.listModulesByDevice('node-1').map((registeredModule) => registeredModule.module.id),
      ['node-1-lora', 'node-1-ble'],
    )
  })

  it('registers and resolves network endpoints', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device, {
      endpoints: [createEndpoint('node-1')],
    })

    assert.deepEqual(registry.getEndpointByAddress('lora-node-1'), createEndpoint('node-1'))
    assert.equal(registry.getByEndpointAddress('lora-node-1'), device)
    assert.equal(registry.getByLoRaAddress('lora-node-1'), device)
    assert.equal(registry.getLoRaAddress('node-1'), 'lora-node-1')
    assert.deepEqual(registry.getEndpointsByDevice('node-1'), [createEndpoint('node-1')])
    assert.deepEqual(registry.getEndpointsByModule('node-1-lora'), [createEndpoint('node-1')])
  })

  it('re-registers endpoint address for the same module/protocol', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device)
    registry.registerEndpoint(createEndpoint('node-1', 'node-1-lora', 'lora-node-1'))
    registry.registerEndpoint(createEndpoint('node-1', 'node-1-lora', 'lora-node-2'))

    assert.equal(registry.getByLoRaAddress('lora-node-1'), undefined)
    assert.equal(registry.getByLoRaAddress('lora-node-2'), device)
    assert.equal(registry.getLoRaAddress('node-1', 'node-1-lora'), 'lora-node-2')
  })

  it('rejects duplicate endpoint address for another module', () => {
    const registry = new DeviceRegistry()

    registry.add(createDevice('node-1'), {
      endpoints: [createEndpoint('node-1', 'node-1-lora', 'shared-address')],
    })
    registry.add(createDevice('node-2'))

    assert.throws(
      () => registry.registerEndpoint(createEndpoint('node-2', 'node-2-lora', 'shared-address')),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_ALREADY_EXISTS')
        return true
      },
    )
  })

  it('removes device and cleans up role, module and endpoint indexes', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1', DeviceRole.NODE)

    registry.add(device, {
      endpoints: [createEndpoint('node-1')],
    })
    registry.remove('node-1')

    assert.equal(registry.size(), 0)
    assert.equal(registry.moduleSize(), 0)
    assert.equal(registry.endpointSize(), 0)
    assert.equal(registry.has('node-1'), false)
    assert.equal(registry.getByLoRaAddress('lora-node-1'), undefined)
    assert.deepEqual(registry.listByRole(DeviceRole.NODE), [])
  })

  it('throws typed error when removing missing device', () => {
    const registry = new DeviceRegistry()

    assert.throws(
      () => registry.remove('missing'),
      (error) => {
        assertRegistryError(error, 'REGISTRY_DEVICE_NOT_FOUND')
        return true
      },
    )
  })

  it('clears all indexes', () => {
    const registry = new DeviceRegistry()
    const node = createDevice('node-1')
    const gateway = createDevice('gateway-1', DeviceRole.GATEWAY)

    registry.add(node, { endpoints: [createEndpoint('node-1')] })
    registry.add(gateway, { endpoints: [createEndpoint('gateway-1', 'gateway-1-lora', 'gateway-1')] })
    registry.clear()

    assert.equal(registry.size(), 0)
    assert.equal(registry.moduleSize(), 0)
    assert.equal(registry.endpointSize(), 0)
    assert.deepEqual(registry.list(), [])
    assert.deepEqual(registry.listByRole(DeviceRole.NODE), [])
    assert.equal(registry.getByLoRaAddress('lora-node-1'), undefined)
    assert.equal(registry.getByLoRaAddress('gateway-1'), undefined)
  })
})
