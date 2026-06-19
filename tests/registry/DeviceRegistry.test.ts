import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceCore } from '../../src/engine/domain/device/DeviceCore'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { DeviceRegistry, DeviceRegistryError } from '../../src/engine/domain/registry'

function createDevice(id: string, role = DeviceRole.NODE): DeviceCore {
  return new DeviceCore({
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

  it('rejects empty device id and address inputs', () => {
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
      () => registry.registerAddress('node-1', ' '),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_REQUIRED')
        return true
      },
    )
    assert.throws(
      () => registry.getByAddress(' '),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_REQUIRED')
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

  it('registers and resolves address during add', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device, { address: 'lora-node-1' })

    assert.equal(registry.getByAddress('lora-node-1'), device)
    assert.equal(registry.getAddress('node-1'), 'lora-node-1')
  })

  it('registers and re-registers address for the same device', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1')

    registry.add(device)
    registry.registerAddress('node-1', 'lora-node-1')
    registry.registerAddress('node-1', 'lora-node-2')

    assert.equal(registry.getByAddress('lora-node-1'), undefined)
    assert.equal(registry.getByAddress('lora-node-2'), device)
  })

  it('rejects duplicate address for another device', () => {
    const registry = new DeviceRegistry()

    registry.add(createDevice('node-1'), { address: 'shared-address' })
    registry.add(createDevice('node-2'))

    assert.throws(
      () => registry.registerAddress('node-2', 'shared-address'),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_ALREADY_EXISTS')
        return true
      },
    )
    assert.throws(
      () => registry.add(createDevice('node-3'), { address: 'shared-address' }),
      (error) => {
        assertRegistryError(error, 'REGISTRY_ADDRESS_ALREADY_EXISTS')
        return true
      },
    )
  })

  it('removes device and cleans up role and address indexes', () => {
    const registry = new DeviceRegistry()
    const device = createDevice('node-1', DeviceRole.NODE)

    registry.add(device, { address: 'lora-node-1' })
    registry.remove('node-1')

    assert.equal(registry.size(), 0)
    assert.equal(registry.has('node-1'), false)
    assert.equal(registry.getByAddress('lora-node-1'), undefined)
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

    registry.add(node, { address: 'lora-node-1' })
    registry.add(gateway, { address: 'gateway-1' })
    registry.clear()

    assert.equal(registry.size(), 0)
    assert.deepEqual(registry.list(), [])
    assert.deepEqual(registry.listByRole(DeviceRole.NODE), [])
    assert.equal(registry.getByAddress('lora-node-1'), undefined)
    assert.equal(registry.getByAddress('gateway-1'), undefined)
  })
})
