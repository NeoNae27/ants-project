import assert from 'node:assert/strict'
import test, { TestContext } from 'node:test'

import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceExecutionState } from '../../src/engine/domain/device/DeviceExecutionState'
import { DeviceLifecycleState } from '../../src/engine/domain/device/DeviceLifecycleState'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'

function logStep(
  t: TestContext,
  title: string,
  details: Record<string, unknown>,
): void {
  t.diagnostic(
    JSON.stringify(
      {
        title,
        ...details,
      },
      null,
      2,
    ),
  )
}

test('DeviceFactory.createNode creates a node with default config and location', (t) => {
  const createdAt = 1_700_000_000_000
  t.mock.method(Date, 'now', () => createdAt)

  const device = DeviceFactory.createNode({
    id: 'node-1',
    model: 'ANT-NODE-100',
    version: '2.1.0',
    name: 'North bed sensor',
    x: 42,
    y: 7,
  })

  const info = device.getInfo()
  const snapshot = device.getSnapshot()

  logStep(t, 'factory node snapshot', {
    info,
    config: snapshot.config,
    meta: snapshot.meta,
    modules: snapshot.modules,
    buffer: snapshot.buffer,
  })

  assert.deepEqual(info, {
    id: 'node-1',
    model: 'ANT-NODE-100',
    name: 'North bed sensor',
    version: '2.1.0',
    role: DeviceRole.NODE,
    lifecycleState: DeviceLifecycleState.NEW,
    executionState: DeviceExecutionState.IDLE,
    moduleCount: 0,
    bufferSize: 0,
  })
  assert.deepEqual(snapshot.config, {
    heartbeatIntervalMs: 60_000,
    transmissionIntervalMs: 300_000,
    maxRetries: 3,
    powerMode: 'normal',
  })
  assert.deepEqual(snapshot.meta, {
    createdAt,
    updatedAt: createdAt,
    location: {
      x: 42,
      y: 7,
    },
    tags: undefined,
    description: undefined,
  })
  assert.deepEqual(snapshot.modules, [])
  assert.deepEqual(snapshot.buffer, [])
})

test('DeviceFactory.createNode supports unnamed nodes and preserves behavior', (t) => {
  const createdAt = 1_700_000_100_000
  t.mock.method(Date, 'now', () => createdAt)

  const device = DeviceFactory.createNode({
    id: 'node-unnamed',
    model: 'ANT-NODE-200',
    version: '3.0.0',
    x: -3,
    y: 15,
  })

  device.rename('Renamed node')
  device.transitionTo(DeviceLifecycleState.COMMISSIONING, 'factory smoke test')

  const snapshot = device.getSnapshot()

  logStep(t, 'factory unnamed node behavior', {
    renamedName: snapshot.name,
    lifecycleState: snapshot.lifecycleState,
    buffer: snapshot.buffer,
    meta: snapshot.meta,
  })

  assert.equal(snapshot.name, 'Renamed node')
  assert.equal(snapshot.role, DeviceRole.NODE)
  assert.equal(snapshot.lifecycleState, DeviceLifecycleState.COMMISSIONING)
  assert.deepEqual(snapshot.meta.location, {
    x: -3,
    y: 15,
  })
  assert.equal(snapshot.buffer.length, 1)
  assert.deepEqual(snapshot.buffer[0].payload, {
    event: 'device.lifecycle_changed',
    previous: DeviceLifecycleState.NEW,
    next: DeviceLifecycleState.COMMISSIONING,
    reason: 'factory smoke test',
  })
})
