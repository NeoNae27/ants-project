import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import {
  LoRaModule,
  LoRaProfile,
  LoRaRegion,
  type LoRaPacket
} from '../../src/engine/domain/modules/network/lora'
import { Workspace } from '../../src/engine/domain/workspace'
import { SimulationRuntimeSessionManager } from '../../src/engine/application/simulation'
import {
  calculateLinkBudget,
  createDeterministicLoRaPacket,
  createDeterministicTelemetry,
  FreeSpacePathLossModel,
  InMemoryEventQueue,
  LinkBudgetChannelModel,
  RuntimeEventType,
  TableLoRaSensitivityResolver,
  toRadioPacketFromLoRaPacket,
  WirelessMedium
} from '../../src/engine/runtime'

function createLoRaModule(
  id: string,
  sourceAddress: string,
  patch: Partial<ReturnType<typeof createBaseRadioConfig>> = {}
): LoRaModule {
  return new LoRaModule(id, 'SX1276', '1.0.0', sourceAddress, {
    radio: {
      ...createBaseRadioConfig(),
      ...patch
    },
    mesh: {
      enabled: true,
      nodeAddress: sourceAddress,
      relayEnabled: false,
      maxHops: 1
    }
  })
}

function createBaseRadioConfig() {
  return {
    profile: LoRaProfile.LORA_MESH,
    region: LoRaRegion.EU868,
    frequencyHz: 868_000_000,
    bandwidthHz: 125_000,
    spreadingFactor: 7 as const,
    codingRate: '4/5' as const,
    preambleLength: 8,
    crcEnabled: true,
    implicitHeader: false,
    txPowerDbm: 14,
    maxPayloadSizeBytes: 64,
    ackEnabled: false,
    retryLimit: 0,
    timeoutMs: 1000,
    maxRangeMeters: 1000,
    maxConnections: 8
  }
}

function createWorkspaceFixture(options: {
  gatewayFrequencyHz?: number
  gatewayX?: number
  gatewayY?: number
  sourceMaxRangeMeters?: number
} = {}): {
  workspace: Workspace
  sensorModule: LoRaModule
  gatewayModule: LoRaModule
} {
  const workspace = new Workspace({
    id: 'project',
    name: 'Radio runtime',
    width: 1000,
    height: 1000,
    metersPerUnit: 10
  })
  const sensorModule = createLoRaModule('sensor-lora', 'node-001', {
    ...(options.sourceMaxRangeMeters !== undefined
      ? { maxRangeMeters: options.sourceMaxRangeMeters }
      : {})
  })
  const gatewayModule = createLoRaModule('gateway-lora', 'gateway-001', {
    ...(options.gatewayFrequencyHz ? { frequencyHz: options.gatewayFrequencyHz } : {})
  })
  const sensor = DeviceFactory.createDevice({
    id: 'sensor-001',
    model: 'ANT-S',
    version: '1.0.0',
    role: DeviceRole.NODE,
    modules: [sensorModule]
  })
  const gateway = DeviceFactory.createDevice({
    id: 'gateway-001',
    model: 'ANT-G',
    version: '1.0.0',
    role: DeviceRole.GATEWAY,
    modules: [gatewayModule]
  })

  workspace.addDevice(sensor, { x: 10, y: 10 }, {
    endpoints: [
      {
        deviceId: 'sensor-001',
        moduleId: sensorModule.id,
        protocol: 'lora',
        address: 'node-001'
      }
    ]
  })
  workspace.addDevice(gateway, { x: options.gatewayX ?? 20, y: options.gatewayY ?? 20 }, {
    endpoints: [
      {
        deviceId: 'gateway-001',
        moduleId: gatewayModule.id,
        protocol: 'lora',
        address: 'gateway-001'
      }
    ]
  })

  return { workspace, sensorModule, gatewayModule }
}

function createPacket(sourceModule: LoRaModule): LoRaPacket {
  const telemetry = createDeterministicTelemetry({
    deviceId: 'sensor-001',
    simulationTimeMs: 1000
  })

  return createDeterministicLoRaPacket({
    sourceAddress: 'node-001',
    targetAddress: 'gateway-001',
    telemetry,
    sourceModule,
    simulationTimeMs: 1001
  })
}

describe('radio runtime', () => {
  it('normalizes LoRa packets without losing the original packet', () => {
    const { sensorModule } = createWorkspaceFixture()
    const packet = createPacket(sensorModule)
    const radioPacket = toRadioPacketFromLoRaPacket(packet, {
      sourceDeviceId: 'sensor-001',
      targetDeviceId: 'gateway-001'
    })

    assert.equal(radioPacket.id, packet.packetId)
    assert.equal(radioPacket.radio.txPowerDbm, packet.radio.powerDbm)
    assert.equal(radioPacket.radio.candidateSearchRadiusMeters, packet.radio.rangeMeters)
    assert.equal(radioPacket.meta.originalPacket, packet)
  })

  it('calculates path loss and link margin consistently', () => {
    const pathLossModel = new FreeSpacePathLossModel()
    const nearLoss = pathLossModel.calculate({ distanceMeters: 100, frequencyHz: 868_000_000 })
    const farLoss = pathLossModel.calculate({ distanceMeters: 1000, frequencyHz: 868_000_000 })
    const budget = calculateLinkBudget({
      txPowerDbm: 14,
      pathLossDb: nearLoss,
      rxSensitivityDbm: -123
    })

    assert.ok(farLoss > nearLoss)
    assert.equal(budget.linkMarginDb, budget.rxPowerDbm + 123)
  })

  it('resolves LoRa sensitivity from a spreading-factor table', () => {
    const resolver = new TableLoRaSensitivityResolver()

    assert.equal(resolver.getSensitivityDbm({ spreadingFactor: 7, bandwidthHz: 125_000 }), -123)
    assert.equal(resolver.getSensitivityDbm({ spreadingFactor: 12, bandwidthHz: 125_000 }), -137)
  })

  it('evaluates reachable, weak, lost, and incompatible links', () => {
    const packet = toRadioPacketFromLoRaPacket(createPacket(createLoRaModule('sensor-lora', 'node-001')))
    packet.radio.candidateSearchRadiusMeters = 1_000_000
    const model = new LinkBudgetChannelModel({ baseDelayMs: 50 })
    const source = { deviceId: 'sensor-001', x: 0, y: 0 }
    const target = {
      deviceId: 'gateway-001',
      x: 1,
      y: 1,
      radio: {
        frequencyHz: 868_000_000,
        bandwidthHz: 125_000,
        spreadingFactor: 7
      }
    }
    const reachable = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 100,
      nowMs: 1000
    })
    const weak = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 70_000,
      nowMs: 1000
    })
    const lost = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 300_000,
      nowMs: 1000
    })
    const incompatible = model.evaluate({
      packet,
      source,
      target: {
        ...target,
        radio: {
          ...target.radio,
          frequencyHz: 915_000_000
        }
      },
      distanceMeters: 100,
      nowMs: 1000
    })

    assert.equal(reachable.canDeliver, true)
    assert.equal(reachable.link.status, 'reachable')
    assert.equal(weak.canDeliver, true)
    assert.equal(weak.link.status, 'weak')
    assert.equal(lost.canDeliver, false)
    assert.equal(lost.link.reason, 'LINK_BUDGET_TOO_LOW')
    assert.equal(incompatible.canDeliver, false)
    assert.equal(incompatible.link.status, 'invalid_config')
    assert.equal(incompatible.reason, 'FREQUENCY_MISMATCH')
  })

  it('uses candidate search radius as a hard range cap before link budget', () => {
    const packet = toRadioPacketFromLoRaPacket(createPacket(createLoRaModule('sensor-lora', 'node-001')))
    packet.radio.candidateSearchRadiusMeters = 10_000
    packet.radio.txPowerDbm = 80
    const model = new LinkBudgetChannelModel({ baseDelayMs: 50 })
    const source = { deviceId: 'sensor-001', x: 0, y: 0 }
    const target = {
      deviceId: 'gateway-001',
      x: 1,
      y: 1,
      radio: {
        frequencyHz: 868_000_000,
        bandwidthHz: 125_000,
        spreadingFactor: 7
      }
    }

    const justInsideRange = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 9999.99,
      nowMs: 1000
    })
    const onBoundary = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 10_000,
      nowMs: 1000
    })
    const beyondRange = model.evaluate({
      packet,
      source,
      target,
      distanceMeters: 10_000.01,
      nowMs: 1000
    })

    assert.equal(justInsideRange.reason, undefined)
    assert.equal(justInsideRange.canDeliver, true)
    assert.equal(onBoundary.reason, undefined)
    assert.equal(onBoundary.canDeliver, true)
    assert.equal(beyondRange.canDeliver, false)
    assert.equal(beyondRange.reason, 'OUT_OF_RANGE')
    assert.equal(beyondRange.link.status, 'lost')
    assert.equal(beyondRange.link.reason, 'OUT_OF_RANGE')
    assert.equal(beyondRange.link.pathLossDb, undefined)
  })

  it('schedules packet delivery and exposes radio link snapshots', () => {
    const { workspace, sensorModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const medium = new WirelessMedium({
      eventQueue: queue,
      channelModel: new LinkBudgetChannelModel({ baseDelayMs: 25 }),
      now: () => 1000,
      runtimeContextProvider: () => ({ workspace })
    })
    const result = medium.transmit(
      createPacket(sensorModule),
      {
        simulationTimeMs: 1000,
        eventQueue: queue,
        workspace
      },
      { sourceDeviceId: 'sensor-001' }
    )

    assert.equal(result.ok, true)
    assert.equal(result.scheduledDeliveries, 1)
    assert.equal(queue.peekNext()?.type, RuntimeEventType.PACKET_DELIVERY)
    assert.equal(medium.getLinks().length, 1)
    assert.equal(medium.getLinks()[0]?.status, 'reachable')

    medium.clearLinks()
    assert.equal(medium.getLinks().length, 0)
  })

  it('records and schedules packet loss for incompatible links', () => {
    const { workspace, sensorModule } = createWorkspaceFixture({
      gatewayFrequencyHz: 915_000_000
    })
    const queue = new InMemoryEventQueue()
    const medium = new WirelessMedium({
      eventQueue: queue,
      channelModel: new LinkBudgetChannelModel(),
      now: () => 1000,
      runtimeContextProvider: () => ({ workspace })
    })
    const result = medium.transmit(
      createPacket(sensorModule),
      {
        simulationTimeMs: 1000,
        eventQueue: queue,
        workspace
      },
      { sourceDeviceId: 'sensor-001' }
    )

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'FREQUENCY_MISMATCH')
    assert.equal(queue.peekNext()?.type, RuntimeEventType.PACKET_LOST)
    assert.equal(medium.getLinks()[0]?.status, 'invalid_config')
  })

  it('keeps direct target lookup but rejects explicit targets beyond source range', () => {
    const { workspace, sensorModule, gatewayModule } = createWorkspaceFixture({
      gatewayX: 1000,
      gatewayY: 1000,
      sourceMaxRangeMeters: 10_000
    })
    const queue = new InMemoryEventQueue()
    const medium = new WirelessMedium({
      eventQueue: queue,
      channelModel: new LinkBudgetChannelModel(),
      now: () => 1000,
      runtimeContextProvider: () => ({ workspace })
    })
    const result = medium.transmit(
      createPacket(sensorModule),
      {
        simulationTimeMs: 1000,
        eventQueue: queue,
        workspace
      },
      { sourceDeviceId: 'sensor-001' }
    )

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'OUT_OF_RANGE')
    assert.equal(result.links.length, 1)
    assert.equal(result.links[0]?.targetDeviceId, 'gateway-001')
    assert.equal(result.links[0]?.status, 'lost')
    assert.equal(result.links[0]?.reason, 'OUT_OF_RANGE')
    assert.equal(queue.peekNext()?.type, RuntimeEventType.PACKET_LOST)
    assert.equal(queue.getSnapshot().events.some((event) => event.type === RuntimeEventType.PACKET_DELIVERY), false)
    assert.equal(gatewayModule.getInboundBuffer().length, 0)
  })

  it('returns and clears radio links through simulation command results', () => {
    const { workspace } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const scheduled = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      dueInMs: 1,
      sendDelayMs: 1,
      deliveryDelayMs: 1
    })

    assert.equal(scheduled.ok, true)
    assert.deepEqual(scheduled.radioLinks, [])

    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    const sent = manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })

    assert.equal(sent.ok, true)
    assert.equal(sent.radioLinks?.length, 1)

    const snapshot = manager.dispatch({ type: 'simulation/get-clock-snapshot' })
    assert.equal(snapshot.radioLinks?.length, 1)

    const reset = manager.dispatch({ type: 'simulation/reset' })
    assert.equal(reset.radioLinks?.length, 0)

    manager.dispatch({ type: 'simulation/schedule-basic-telemetry', deviceId: 'sensor-001', targetAddress: 'gateway-001', dueInMs: 1, sendDelayMs: 1, deliveryDelayMs: 1 })
    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    assert.equal(manager.dispatch({ type: 'simulation/get-clock-snapshot' }).radioLinks?.length, 1)
    assert.equal(manager.resetForNewWorkspace().radioLinks?.length, 0)
  })

  it('does not deliver runtime telemetry to an explicit Gateway beyond 10 km', () => {
    const { workspace, gatewayModule } = createWorkspaceFixture({
      gatewayX: 1000,
      gatewayY: 1000,
      sourceMaxRangeMeters: 10_000
    })
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const scheduled = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      dueInMs: 1,
      sendDelayMs: 1,
      deliveryDelayMs: 1
    })

    assert.equal(scheduled.ok, true)

    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    const sent = manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })

    assert.equal(sent.ok, true)
    assert.equal(sent.radioLinks?.length, 1)
    assert.equal(sent.radioLinks?.[0]?.status, 'lost')
    assert.equal(sent.radioLinks?.[0]?.reason, 'OUT_OF_RANGE')
    assert.equal(sent.queue?.events.some((event) => event.type === RuntimeEventType.PACKET_LOST), true)
    assert.equal(sent.queue?.events.some((event) => event.type === RuntimeEventType.PACKET_DELIVERY), false)

    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    assert.equal(gatewayModule.getInboundBuffer().length, 0)
  })
})
