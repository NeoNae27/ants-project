import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceExecutionState } from '../../src/engine/domain/device/DeviceExecutionState'
import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceLifecycleState } from '../../src/engine/domain/device/DeviceLifecycleState'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { LoRaModule, LoRaProfile, LoRaRegion, type LoRaPacket } from '../../src/engine/domain/modules/network/lora'
import { Workspace } from '../../src/engine/domain/workspace'
import {
  createDeterministicLoRaPacket,
  createDeterministicTelemetry,
  EventDispatcher,
  EventPriority,
  InMemoryEventQueue,
  RuntimeEventType,
  type DispatchContext,
  type ScheduleSimulationEventInput,
  type SimulationEvent,
  type TelemetrySamplePayload,
  type TelemetrySendPayload
} from '../../src/engine/runtime/events'
import {
  DeviceStateChangeHandler,
  PacketDeliveryHandler,
  TelemetrySampleHandler,
  TelemetrySendHandler
} from '../../src/engine/runtime/events/handlers'

function createLoRaModule(id: string, sourceAddress: string): LoRaModule {
  return new LoRaModule(id, 'SX1276', '1.0.0', sourceAddress, {
    radio: {
      profile: LoRaProfile.LORA_MESH,
      region: LoRaRegion.EU868,
      frequencyHz: 868_000_000,
      bandwidthHz: 125_000,
      spreadingFactor: 7,
      codingRate: '4/5',
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
    },
    mesh: {
      enabled: true,
      nodeAddress: sourceAddress,
      relayEnabled: false,
      maxHops: 1
    }
  })
}

function createWorkspaceFixture(): {
  workspace: Workspace
  sensorModule: LoRaModule
  gatewayModule: LoRaModule
} {
  const workspace = new Workspace({
    id: 'project',
    name: 'Runtime test',
    width: 1000,
    height: 1000,
    metersPerUnit: 10
  })
  const sensorModule = createLoRaModule('sensor-lora', 'node-001')
  const gatewayModule = createLoRaModule('gateway-lora', 'gateway-001')
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
  workspace.addDevice(gateway, { x: 20, y: 20 }, {
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

function createEvent<TPayload>(
  queue: InMemoryEventQueue,
  input: ScheduleSimulationEventInput<TPayload>
): SimulationEvent<TPayload> {
  queue.schedule(input)
  const [event] = queue.popDueEvents(input.scheduledAt)

  if (!event) {
    throw new Error('Expected test event')
  }

  return event as SimulationEvent<TPayload>
}

function createContext(
  eventQueue: InMemoryEventQueue,
  workspace: Workspace,
  simulationTimeMs: number
): DispatchContext {
  return {
    simulationTimeMs,
    eventQueue,
    workspace
  }
}

describe('Runtime event handlers', () => {
  it('creates deterministic telemetry for the same device and simulation time', () => {
    const first = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 1000
    })
    const second = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 1000
    })
    const later = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 2000
    })

    assert.deepEqual(first, second)
    assert.notEqual(first.message_id, later.message_id)
    assert.equal(first.timestamp, 1000)
  })

  it('telemetry sample schedules telemetry send and repeat events', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.TELEMETRY_SAMPLE]: TelemetrySampleHandler
      }
    })
    const event = createEvent<TelemetrySamplePayload>(queue, {
      id: 'sample-1',
      type: RuntimeEventType.TELEMETRY_SAMPLE,
      scheduledAt: 1000,
      createdAt: 0,
      priority: EventPriority.TELEMETRY,
      source: { type: 'device', id: 'sensor-001' },
      target: { deviceId: 'sensor-001' },
      payload: {
        deviceId: 'sensor-001',
        targetAddress: 'gateway-001',
        repeat: true,
        intervalMs: 5000,
        sendDelayMs: 1,
        deliveryDelayMs: 100
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1000))

    assert.equal(result.ok, true)
    assert.deepEqual(result.scheduledEventIds, ['sample-1:send', 'sample-1:next:6000'])

    const [sendEvent] = queue.popDueEvents(1001) as Array<SimulationEvent<TelemetrySendPayload>>
    assert.equal(sendEvent?.type, RuntimeEventType.TELEMETRY_SEND)
    assert.equal(sendEvent?.payload.telemetry.timestamp, 1000)
    assert.equal(sendEvent?.payload.deliveryDelayMs, 100)
    assert.equal(queue.peekNext()?.id, 'sample-1:next:6000')
  })

  it('telemetry sample returns recoverable failure for invalid repeat interval', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.TELEMETRY_SAMPLE]: TelemetrySampleHandler
      }
    })
    const event = createEvent<TelemetrySamplePayload>(queue, {
      id: 'sample-invalid',
      type: RuntimeEventType.TELEMETRY_SAMPLE,
      scheduledAt: 1000,
      createdAt: 0,
      priority: EventPriority.TELEMETRY,
      payload: {
        deviceId: 'sensor-001',
        targetAddress: 'gateway-001',
        repeat: true
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1000))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'INVALID_INTERVAL')
  })

  it('telemetry send schedules packet delivery when wireless medium is missing', () => {
    const { workspace, sensorModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.TELEMETRY_SEND]: TelemetrySendHandler
      }
    })
    const telemetry = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 1000
    })
    const event = createEvent<TelemetrySendPayload>(queue, {
      id: 'send-1',
      type: RuntimeEventType.TELEMETRY_SEND,
      scheduledAt: 1001,
      createdAt: 1000,
      priority: EventPriority.TELEMETRY,
      payload: {
        deviceId: 'sensor-001',
        targetAddress: 'gateway-001',
        telemetry,
        deliveryDelayMs: 100
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1001))

    assert.equal(result.ok, true)
    assert.deepEqual(result.scheduledEventIds, ['send-1:delivery'])

    const [deliveryEvent] = queue.popDueEvents(1101)
    assert.equal(deliveryEvent?.type, RuntimeEventType.PACKET_DELIVERY)
    assert.equal((deliveryEvent?.payload as { packet?: LoRaPacket }).packet?.sourceAddress, 'node-001')
    assert.equal((deliveryEvent?.payload as { packet?: LoRaPacket }).packet?.packetId, `pkt_${telemetry.message_id}`)
    assert.equal(sensorModule.getOutboundBuffer().length, 0)
  })

  it('telemetry send delegates to wireless medium when available', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const transmitted: LoRaPacket[] = []
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.TELEMETRY_SEND]: TelemetrySendHandler
      }
    })
    const telemetry = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 1000
    })
    const event = createEvent<TelemetrySendPayload>(queue, {
      id: 'send-wireless',
      type: RuntimeEventType.TELEMETRY_SEND,
      scheduledAt: 1001,
      createdAt: 1000,
      priority: EventPriority.TELEMETRY,
      payload: {
        deviceId: 'sensor-001',
        targetAddress: 'gateway-001',
        telemetry
      }
    })

    const result = dispatcher.dispatch(event, {
      ...createContext(queue, workspace, 1001),
      wirelessMedium: {
        transmit(packet: LoRaPacket) {
          transmitted.push(packet)
        }
      }
    })

    assert.equal(result.ok, true)
    assert.equal(transmitted.length, 1)
    assert.equal(queue.size(), 0)
  })

  it('packet delivery pushes the packet into the target LoRa inbound buffer', () => {
    const { workspace, sensorModule, gatewayModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.PACKET_DELIVERY]: PacketDeliveryHandler
      }
    })
    const telemetry = createDeterministicTelemetry({
      deviceId: 'sensor-001',
      simulationTimeMs: 1000
    })
    const packet = createDeterministicLoRaPacket({
      sourceAddress: 'node-001',
      targetAddress: 'gateway-001',
      telemetry,
      sourceModule: sensorModule,
      simulationTimeMs: 1001
    })
    const event = createEvent(queue, {
      id: 'delivery-1',
      type: RuntimeEventType.PACKET_DELIVERY,
      scheduledAt: 1101,
      createdAt: 1001,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        packet,
        targetAddress: 'gateway-001',
        targetDeviceId: 'gateway-001',
        sentAtSimulationMs: 1001
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1101))

    assert.equal(result.ok, true)
    assert.equal(gatewayModule.getInboundBuffer().length, 1)
    assert.equal(gatewayModule.getInboundBuffer()[0]?.packetId, packet.packetId)
  })

  it('device state change uses DeviceCore transition APIs', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.DEVICE_STATE_CHANGE]: DeviceStateChangeHandler
      }
    })
    const device = workspace.getDevice('sensor-001')

    assert.ok(device)
    const event = createEvent(queue, {
      id: 'state-1',
      type: RuntimeEventType.DEVICE_STATE_CHANGE,
      scheduledAt: 25,
      createdAt: 0,
      priority: EventPriority.DEVICE_STATE,
      payload: {
        deviceId: 'sensor-001',
        lifecycleState: DeviceLifecycleState.COMMISSIONING,
        executionState: DeviceExecutionState.RUNNING,
        reason: 'test'
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 25))

    assert.equal(result.ok, true)
    assert.equal(device.getLifecycleState(), DeviceLifecycleState.COMMISSIONING)
    assert.equal(device.getExecutionState(), DeviceExecutionState.RUNNING)
    assert.equal(device.getMeta().updatedAt, 25)
  })

  it('device state change returns recoverable failure for invalid transition', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.DEVICE_STATE_CHANGE]: DeviceStateChangeHandler
      }
    })
    const event = createEvent(queue, {
      id: 'state-invalid',
      type: RuntimeEventType.DEVICE_STATE_CHANGE,
      scheduledAt: 25,
      createdAt: 0,
      priority: EventPriority.DEVICE_STATE,
      payload: {
        deviceId: 'sensor-001',
        lifecycleState: DeviceLifecycleState.ACTIVE
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 25))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'INVALID_STATE_TRANSITION')
  })
})
