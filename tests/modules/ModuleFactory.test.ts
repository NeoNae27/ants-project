import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ModuleFactory, StubModule } from '../../src/engine/domain/modules'
import { LoRaModule } from '../../src/engine/domain/modules/network/lora'
import { ModuleDomainError } from '../../src/engine/domain/module'

const loraTemplate = {
  kind: 'network' as const,
  name: 'LoRa network',
  model: 'SX1276 Stub',
  communication: {
    protocol: 'lora' as const,
    maxRangeMeters: 10_000,
    maxConnections: 8,
    spreadingFactor: 12 as const,
    bandwidthHz: 125_000,
    txPowerDbm: 14,
    codingRate: '4/5' as const,
    sourceLabel: 'preset',
  },
}

describe('ModuleFactory', () => {
  it('creates real LoRa modules from LoRa templates', () => {
    const factory = new ModuleFactory()
    const module = factory.createModule(loraTemplate, {
      id: 'module-lora-1',
      deviceId: 'device-1',
      loraAddress: 'lora-device-1',
    })

    assert.ok(module instanceof LoRaModule)
    assert.equal(module.id, 'module-lora-1')
    assert.equal(module.model, 'SX1276 Stub')
    assert.equal(module.getSnapshot().sourceAddress, 'lora-device-1')
  })

  it('creates LoRa messages with explicit simulation timestamps', () => {
    const factory = new ModuleFactory()
    const module = factory.createModule(loraTemplate, {
      id: 'module-lora-1',
      deviceId: 'device-1',
      loraAddress: 'lora-device-1',
    })

    assert.ok(module instanceof LoRaModule)

    const message = module.createMessage('gateway-1', { temperature: 21 }, undefined, 42_000)
    const packet = module.buildPacket(message)

    assert.equal(message.timestamp, 42_000)
    assert.equal(packet.meta.timestamp, 42_000)
  })

  it('creates stub modules for non-LoRa templates', () => {
    const factory = new ModuleFactory()
    const module = factory.createModule(
      {
        kind: 'sensor',
        name: 'Environmental sensor',
        model: 'BME280 Stub',
        config: { rateHz: 1 },
      },
      {
        id: 'module-sensor-1',
        deviceId: 'device-1',
      },
    )

    assert.ok(module instanceof StubModule)
    assert.deepEqual(module.getSnapshot(), {
      id: 'module-sensor-1',
      kind: 'sensor',
      name: 'Environmental sensor',
      model: 'BME280 Stub',
      version: '1.0.0',
      lifecycleState: 'new',
      executionState: 'idle',
      config: { rateHz: 1 },
    })
  })

  it('rejects invalid templates with typed module errors', () => {
    const factory = new ModuleFactory()

    assert.throws(
      () =>
        factory.createModule(
          {
            kind: 'sensor',
            name: '',
            model: 'BME280 Stub',
          },
          {
            deviceId: 'device-1',
          },
        ),
      (error) => {
        assert.ok(error instanceof ModuleDomainError)
        assert.equal(error.code, 'MODULE_TEMPLATE_INVALID')
        return true
      },
    )
  })
})
