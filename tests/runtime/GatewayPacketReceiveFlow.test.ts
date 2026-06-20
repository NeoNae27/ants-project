import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { LoRaModule, LoRaProfile, LoRaRegion, type LoRaPacket } from '../../src/engine/domain/modules/network/lora'
import { Workspace } from '../../src/engine/domain/workspace'
import {
  createDefaultRuntimeEventHandlers,
  createDeterministicLoRaPacket,
  createDeterministicTelemetry,
  EventDispatcher,
  EventPriority,
  InMemoryEventQueue,
  RuntimeEventType,
  SimulationClock,
  SimulationEngine,
  type DispatchContext,
  type GatewayPacketReceivedPayload,
  type PacketDeliveryPayload,
  type ScheduleSimulationEventInput,
  type SimulationEvent
} from '../../src/engine/runtime'
import {
  GatewayPacketReceivedHandler,
  PacketDeliveryHandler
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
  nodeTargetModule: LoRaModule
} {
  const workspace = new Workspace({
    id: 'project',
    name: 'Gateway receive flow',
    width: 1000,
    height: 1000,
    metersPerUnit: 10
  })
  const sensorModule = createLoRaModule('sensor-lora', 'node-001')
  const gatewayModule = createLoRaModule('gateway-lora', 'gateway-001')
  const nodeTargetModule = createLoRaModule('node-target-lora', 'node-target')
  const sensor = DeviceFactory.createNode({
    id: 'sensor-001',
    model: 'ANT-S',
    version: '1.0.0',
    x: 10,
    y: 10,
    modules: [sensorModule]
  })
  const gateway = DeviceFactory.createGateway({
    id: 'gateway-001',
    model: 'ANT-G',
    version: '1.0.0',
    x: 20,
    y: 20,
    modules: [gatewayModule]
  })
  const nodeTarget = DeviceFactory.createDevice({
    id: 'node-target-001',
    model: 'ANT-S',
    version: '1.0.0',
    role: DeviceRole.NODE,
    modules: [nodeTargetModule]
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
  workspace.addDevice(nodeTarget, { x: 30, y: 30 }, {
    endpoints: [
      {
        deviceId: 'node-target-001',
        moduleId: nodeTargetModule.id,
        protocol: 'lora',
        address: 'node-target'
      }
    ]
  })

  return { workspace, sensorModule, gatewayModule, nodeTargetModule }
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

function createPacket(sourceModule: LoRaModule, targetAddress = 'gateway-001'): LoRaPacket {
  const telemetry = createDeterministicTelemetry({
    deviceId: 'sensor-001',
    simulationTimeMs: 1000
  })

  return createDeterministicLoRaPacket({
    sourceAddress: 'node-001',
    targetAddress,
    telemetry,
    sourceModule,
    simulationTimeMs: 1001
  })
}

function createContext(
  eventQueue: InMemoryEventQueue,
  workspace: Workspace,
  simulationTimeMs: number,
  logger?: DispatchContext['logger']
): DispatchContext {
  return {
    simulationTimeMs,
    eventQueue,
    workspace,
    ...(logger ? { logger } : {})
  }
}

describe('Gateway packet receive flow', () => {
  it('gateway packet received handler rejects missing gatewayDeviceId', () => {
    const { workspace, sensorModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.GATEWAY_PACKET_RECEIVED]: GatewayPacketReceivedHandler
      }
    })
    const event = createEvent(queue, {
      id: 'gateway-received-missing-device',
      type: RuntimeEventType.GATEWAY_PACKET_RECEIVED,
      scheduledAt: 1102,
      createdAt: 1101,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        packet: createPacket(sensorModule),
        receivedAtSimulationMs: 1101
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1102))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'GATEWAY_DEVICE_ID_REQUIRED')
  })

  it('gateway packet received handler rejects missing packets', () => {
    const { workspace } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.GATEWAY_PACKET_RECEIVED]: GatewayPacketReceivedHandler
      }
    })
    const event = createEvent(queue, {
      id: 'gateway-received-missing-packet',
      type: RuntimeEventType.GATEWAY_PACKET_RECEIVED,
      scheduledAt: 1102,
      createdAt: 1101,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        gatewayDeviceId: 'gateway-001',
        receivedAtSimulationMs: 1101
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, workspace, 1102))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'PACKET_REQUIRED')
  })

  it('gateway packet received handler logs valid packet metadata', () => {
    const { workspace, sensorModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const logs: Array<{ message: string; details?: unknown }> = []
    const packet = createPacket(sensorModule)
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.GATEWAY_PACKET_RECEIVED]: GatewayPacketReceivedHandler
      }
    })
    const event = createEvent<GatewayPacketReceivedPayload>(queue, {
      id: 'gateway-received-valid',
      type: RuntimeEventType.GATEWAY_PACKET_RECEIVED,
      scheduledAt: 1102,
      createdAt: 1101,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        gatewayDeviceId: 'gateway-001',
        packet,
        receivedAtSimulationMs: 1101,
        targetAddress: 'gateway-001'
      }
    })

    const result = dispatcher.dispatch(
      event,
      createContext(queue, workspace, 1102, {
        info(message, details) {
          logs.push({ message, details })
        }
      })
    )

    assert.equal(result.ok, true)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].message, 'gateway.packet_received')
    assert.equal((logs[0].details as { packetId?: string }).packetId, packet.packetId)
    assert.equal((logs[0].details as { gatewayDeviceId?: string }).gatewayDeviceId, 'gateway-001')
  })

  it('packet delivery schedules gateway.packet_received for Gateway targets only', () => {
    const { workspace, sensorModule, gatewayModule, nodeTargetModule } = createWorkspaceFixture()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: {
        [RuntimeEventType.PACKET_DELIVERY]: PacketDeliveryHandler
      }
    })
    const gatewayPacket = createPacket(sensorModule)
    const gatewayDelivery = createEvent<PacketDeliveryPayload>(queue, {
      id: 'delivery-gateway',
      type: RuntimeEventType.PACKET_DELIVERY,
      scheduledAt: 1101,
      createdAt: 1001,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        packet: gatewayPacket,
        targetAddress: 'gateway-001',
        targetDeviceId: 'gateway-001',
        sentAtSimulationMs: 1001
      }
    })

    const gatewayResult = dispatcher.dispatch(gatewayDelivery, createContext(queue, workspace, 1101))

    assert.equal(gatewayResult.ok, true)
    assert.deepEqual(gatewayResult.scheduledEventIds, ['delivery-gateway:gateway-received'])
    assert.equal(gatewayModule.getInboundBuffer().length, 1)
    assert.equal(queue.peekNext()?.type, RuntimeEventType.GATEWAY_PACKET_RECEIVED)

    queue.clear()
    const nodePacket = createPacket(sensorModule, 'node-target')
    const nodeDelivery = createEvent<PacketDeliveryPayload>(queue, {
      id: 'delivery-node',
      type: RuntimeEventType.PACKET_DELIVERY,
      scheduledAt: 1201,
      createdAt: 1101,
      priority: EventPriority.WIRELESS_DELIVERY,
      payload: {
        packet: nodePacket,
        targetAddress: 'node-target',
        targetDeviceId: 'node-target-001',
        sentAtSimulationMs: 1101
      }
    })

    const nodeResult = dispatcher.dispatch(nodeDelivery, createContext(queue, workspace, 1201))

    assert.equal(nodeResult.ok, true)
    assert.deepEqual(nodeResult.scheduledEventIds, [])
    assert.equal(nodeTargetModule.getInboundBuffer().length, 1)
    assert.equal(queue.size(), 0)
  })

  it('delivers telemetry to Gateway inbound buffer and logs gateway receive after advancing time', () => {
    const { workspace, gatewayModule } = createWorkspaceFixture()
    const clock = new SimulationClock()
    const queue = new InMemoryEventQueue()
    const logs: Array<{ message: string; details?: unknown }> = []
    const dispatcher = new EventDispatcher({
      handlers: createDefaultRuntimeEventHandlers()
    })
    const engine = new SimulationEngine({
      clock,
      eventQueue: queue,
      dispatcher,
      runtimeContextProvider: () => ({ workspace }),
      logger: {
        info(message, details) {
          logs.push({ message, details })
        }
      }
    })

    queue.schedule({
      id: 'flow:sample',
      type: RuntimeEventType.TELEMETRY_SAMPLE,
      scheduledAt: 1000,
      createdAt: 0,
      priority: EventPriority.TELEMETRY,
      source: { type: 'scenario', id: 'test' },
      target: { deviceId: 'sensor-001' },
      payload: {
        deviceId: 'sensor-001',
        targetAddress: 'gateway-001',
        sendDelayMs: 1,
        deliveryDelayMs: 100
      }
    })

    const generated = engine.step(1000)
    assert.equal(generated.ok, true)
    assert.equal(queue.peekNext()?.id, 'flow:sample:send')

    const sent = engine.step(1)
    assert.equal(sent.ok, true)
    assert.equal(queue.peekNext()?.id, 'flow:sample:send:delivery')

    const delivered = engine.step(100)
    assert.equal(delivered.ok, true)
    assert.equal(gatewayModule.getInboundBuffer().length, 1)
    assert.equal(
      workspace.getSnapshot().devices.find((device) => device.id === 'gateway-001')?.info
        .receivedPacketCount,
      1
    )
    assert.equal(queue.peekNext()?.id, 'flow:sample:send:delivery:gateway-received')
    assert.equal(logs.length, 0)

    const received = engine.step(1)
    assert.equal(received.ok, true)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].message, 'gateway.packet_received')
    assert.equal((logs[0].details as { gatewayDeviceId?: string }).gatewayDeviceId, 'gateway-001')

    gatewayModule.drainInbound()
    assert.equal(gatewayModule.getInboundBuffer().length, 0)
    assert.equal(
      workspace.getSnapshot().devices.find((device) => device.id === 'gateway-001')?.info
        .receivedPacketCount,
      1
    )
  })
})
