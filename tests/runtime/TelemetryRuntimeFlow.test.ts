import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import { LoRaModule, LoRaProfile, LoRaRegion } from '../../src/engine/domain/modules/network/lora'
import { Workspace } from '../../src/engine/domain/workspace'
import { SimulationRuntimeSessionManager } from '../../src/engine/application/simulation'
import {
  createDefaultRuntimeEventHandlers,
  EventDispatcher,
  EventPriority,
  InMemoryEventQueue,
  RuntimeEventType,
  SimulationClock,
  SimulationEngine,
  SimulationEngineStatus
} from '../../src/engine/runtime'

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
  gatewayModule: LoRaModule
} {
  const workspace = new Workspace({
    id: 'project',
    name: 'Runtime flow',
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

  return { workspace, gatewayModule }
}

describe('Telemetry runtime flow', () => {
  it('delivers telemetry through engine, dispatcher, queue, and handlers', () => {
    const { workspace, gatewayModule } = createWorkspaceFixture()
    const clock = new SimulationClock()
    const queue = new InMemoryEventQueue()
    const dispatcher = new EventDispatcher({
      handlers: createDefaultRuntimeEventHandlers()
    })
    const engine = new SimulationEngine({
      clock,
      eventQueue: queue,
      dispatcher,
      runtimeContextProvider: () => ({ workspace })
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
    assert.equal(generated.processedEventCount, 1)
    assert.equal(queue.peekNext()?.id, 'flow:sample:send')

    const sent = engine.step(1)
    assert.equal(sent.ok, true)
    assert.equal(sent.processedEventCount, 1)
    assert.equal(queue.peekNext()?.id, 'flow:sample:send:delivery')

    const delivered = engine.step(100)
    assert.equal(delivered.ok, true)
    assert.equal(delivered.processedEventCount, 1)
    assert.equal(gatewayModule.getInboundBuffer().length, 1)

    const [packet] = gatewayModule.getInboundBuffer()
    assert.equal(packet?.targetAddress, 'gateway-001')
    assert.equal((packet?.payload as { timestamp?: number }).timestamp, 1000)
  })

  it('schedule-basic-telemetry command schedules only the first telemetry event', () => {
    const { workspace } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const result = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      dueInMs: 500,
      sendDelayMs: 1,
      deliveryDelayMs: 100
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.scheduledEventIds, ['scenario:telemetry:sensor-001:0:1'])
    assert.equal(result.queue?.size, 1)
    assert.equal(result.queue?.events[0]?.type, RuntimeEventType.TELEMETRY_SAMPLE)
    assert.equal(result.queue?.events[0]?.scheduledAt, 500)
    assert.equal(result.clock?.virtualTimeMs, 0)
    assert.equal(result.engine?.state.status, SimulationEngineStatus.IDLE)
  })

  it('schedule-basic-telemetry rejects invalid source devices', () => {
    const { workspace } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const result = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'missing',
      targetAddress: 'gateway-001'
    })

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'SIMULATION_TELEMETRY_SOURCE_DEVICE_NOT_FOUND')
    assert.equal(result.queue?.size, 0)
    assert.equal(result.clock?.virtualTimeMs, 0)
    assert.equal(result.engine?.state.status, SimulationEngineStatus.IDLE)
  })

  it('schedule-basic-telemetry rejects missing gateway LoRa targets', () => {
    const { workspace } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const result = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'node-001'
    })

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'SIMULATION_TELEMETRY_TARGET_NOT_GATEWAY')
    assert.equal(result.queue?.size, 0)
    assert.equal(result.clock?.virtualTimeMs, 0)
    assert.equal(result.engine?.state.status, SimulationEngineStatus.IDLE)
  })

  it('schedule-basic-telemetry validates simulation delays', () => {
    const { workspace } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace })
    })

    const due = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      dueInMs: -1
    })
    const interval = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      repeat: true
    })
    const send = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      sendDelayMs: 0
    })
    const delivery = manager.dispatch({
      type: 'simulation/schedule-basic-telemetry',
      deviceId: 'sensor-001',
      targetAddress: 'gateway-001',
      deliveryDelayMs: 0
    })

    assert.equal(due.ok, false)
    assert.equal(due.error?.code, 'SIMULATION_TELEMETRY_DUE_IN_INVALID')
    assert.equal(interval.ok, false)
    assert.equal(interval.error?.code, 'SIMULATION_TELEMETRY_INTERVAL_INVALID')
    assert.equal(send.ok, false)
    assert.equal(send.error?.code, 'SIMULATION_TELEMETRY_SEND_DELAY_INVALID')
    assert.equal(delivery.ok, false)
    assert.equal(delivery.error?.code, 'SIMULATION_TELEMETRY_DELIVERY_DELAY_INVALID')
    assert.equal(manager.getClockSnapshot().clock?.virtualTimeMs, 0)
    assert.equal(manager.getClockSnapshot().engine?.state.status, SimulationEngineStatus.IDLE)
  })

  it('auto-runs queued telemetry while simulation is active and records execution logs', async () => {
    const { workspace, gatewayModule } = createWorkspaceFixture()
    const runtimeLogs: Array<{ message: string; details?: unknown }> = []
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({ workspace }),
      autoRun: true,
      autoStepRealMs: 5,
      logger: {
        info(message, details) {
          runtimeLogs.push({ message, details })
        },
        warn(message, details) {
          runtimeLogs.push({ message, details })
        }
      }
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
    assert.equal(scheduled.queue?.size, 1)

    const started = manager.dispatch({ type: 'simulation/start' })

    assert.equal(started.ok, true)
    assert.equal(started.clock?.state, 'running')

    let snapshot = manager.getClockSnapshot()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (
        snapshot.queue?.size === 0 &&
        gatewayModule.getInboundBuffer().length === 1 &&
        runtimeLogs.some((entry) => entry.message === 'gateway.packet_received')
      ) {
        break
      }

      await delay(10)
      snapshot = manager.getClockSnapshot()
    }

    manager.dispatch({ type: 'simulation/pause' })

    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.queue?.size, 0)
    assert.equal(snapshot.radioLinks?.length, 1)
    assert.equal(gatewayModule.getInboundBuffer().length, 1)
    assert.ok((snapshot.executions?.length ?? 0) >= 4)
    assert.ok(runtimeLogs.some((entry) => entry.message === 'simulation.step_executed'))
    assert.ok(runtimeLogs.some((entry) => entry.message === 'gateway.packet_received'))
  })
})
