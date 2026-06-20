import assert from 'node:assert/strict'
import test, { TestContext } from 'node:test'

import { DeviceCore, DeviceCoreParams } from '../../src/engine/domain/device/DeviceCore'
import { DeviceDomainError } from '../../src/engine/domain/device/DeviceErrors'
import { DeviceExecutionState } from '../../src/engine/domain/device/DeviceExecutionState'
import { DeviceLifecycleState } from '../../src/engine/domain/device/DeviceLifecycleState'
import { DeviceMessage } from '../../src/engine/domain/device/DeviceMessage'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import {
  DeviceModule,
  ModuleExecutionState,
  ModuleKind,
  ModuleLifecycleState,
} from '../../src/engine/domain/module'

type DeviceCoreOverrides = Omit<Partial<DeviceCoreParams>, 'config'> & {
  config?: Partial<DeviceCoreParams['config']>
}

const baseParams: DeviceCoreParams = {
  id: 'device-1',
  model: 'ANT-100',
  version: '1.0.0',
  role: DeviceRole.NODE,
  name: 'Greenhouse sensor',
  bufferCapacity: 3,
  config: {
    heartbeatIntervalMs: 1_000,
    transmissionIntervalMs: 5_000,
    maxRetries: 2,
    powerMode: 'normal',
  },
  meta: {
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    location: {
      lat: 55.7558,
      lon: 37.6173,
      x: 12,
      y: 8,
    },
    tags: ['greenhouse', 'soil'],
    description: 'Soil telemetry device',
  },
}

function createDevice(overrides: DeviceCoreOverrides = {}): DeviceCore {
  return new DeviceCore({
    ...baseParams,
    ...overrides,
    config: {
      ...baseParams.config,
      ...overrides.config,
    },
    meta: {
      ...baseParams.meta,
      ...overrides.meta,
    },
  })
}

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

function message(id: string): DeviceMessage {
  return {
    id,
    timestamp: 1_700_000_000_000,
    type: 'telemetry',
    payload: {
      temperature: 22,
      humidity: 48,
    },
  }
}

function createModule(params: {
  id: string
  kind: ModuleKind
  model: string
  version: string
}): DeviceModule {
  return {
    ...params,
    getLifecycleState: () => ModuleLifecycleState.ACTIVE,
    getExecutionState: () => ModuleExecutionState.IDLE,
    getSnapshot: () => ({
      id: params.id,
      kind: params.kind,
      model: params.model,
      version: params.version,
      lifecycleState: ModuleLifecycleState.ACTIVE,
      executionState: ModuleExecutionState.IDLE,
    }),
    validate: () => true,
  }
}

function assertDeviceError(
  action: () => void,
  expectedCode: string,
): DeviceDomainError {
  try {
    action()
  } catch (error) {
    assert.ok(error instanceof DeviceDomainError)
    assert.equal(error.code, expectedCode)
    return error
  }

  assert.fail(`Expected DeviceDomainError with code ${expectedCode}`)
}

test('DeviceCore builds a rich snapshot without leaking mutable state', (t) => {
  const device = createDevice()
  const info = device.getInfo()
  const snapshot = device.getSnapshot()

  snapshot.config.maxRetries = 99
  snapshot.meta.tags?.push('mutated')
  snapshot.meta.location!.x = 999

  const freshSnapshot = device.getSnapshot()

  logStep(t, 'created device snapshot', {
    info,
    snapshotSummary: {
      config: freshSnapshot.config,
      meta: freshSnapshot.meta,
      moduleCount: freshSnapshot.modules.length,
      bufferSize: freshSnapshot.buffer.length,
    },
  })

  assert.deepEqual(info, {
    id: 'device-1',
    model: 'ANT-100',
    name: 'Greenhouse sensor',
    version: '1.0.0',
    role: DeviceRole.NODE,
    lifecycleState: DeviceLifecycleState.NEW,
    executionState: DeviceExecutionState.IDLE,
    moduleCount: 0,
    bufferSize: 0,
  })
  assert.equal(freshSnapshot.config.maxRetries, 2)
  assert.deepEqual(freshSnapshot.meta.tags, ['greenhouse', 'soil'])
  assert.deepEqual(freshSnapshot.meta.location, {
    lat: 55.7558,
    lon: 37.6173,
    x: 12,
    y: 8,
  })
})

test('DeviceCore manages modules and reports domain error codes', (t) => {
  const device = createDevice()
  const module = createModule({
    id: 'module-temp-1',
    kind: ModuleKind.SENSOR,
    model: 'TMP-01',
    version: '1.2.0',
  })

  device.addModule(module)
  const duplicateError = assertDeviceError(
    () => device.addModule(module),
    'DEVICE_MODULE_ALREADY_EXISTS',
  )
  device.removeModule(module.id)
  const missingError = assertDeviceError(
    () => device.removeModule(module.id),
    'DEVICE_MODULE_NOT_FOUND',
  )

  logStep(t, 'module lifecycle', {
    addedModule: module,
    duplicateError: {
      name: duplicateError.name,
      code: duplicateError.code,
      message: duplicateError.message,
    },
    missingError: {
      name: missingError.name,
      code: missingError.code,
      message: missingError.message,
    },
    finalModules: device.getModules(),
  })

  assert.equal(device.getModules().length, 0)
})

test('DeviceCore enforces lifecycle transitions and logs successful changes', (t) => {
  const device = createDevice()

  const invalidError = assertDeviceError(
    () => device.transitionTo(DeviceLifecycleState.ACTIVE, 'skip setup'),
    'DEVICE_INVALID_TRANSITION',
  )

  device.transitionTo(DeviceLifecycleState.COMMISSIONING, 'factory started', 1_000)
  device.transitionTo(DeviceLifecycleState.BOUND, 'paired to gateway', 2_000)

  const buffer = device.peekBuffer()

  logStep(t, 'lifecycle transitions', {
    invalidAttempt: {
      from: DeviceLifecycleState.NEW,
      to: DeviceLifecycleState.ACTIVE,
      errorCode: invalidError.code,
      errorMessage: invalidError.message,
    },
    currentState: device.getLifecycleState(),
    buffer,
  })

  assert.equal(device.getLifecycleState(), DeviceLifecycleState.BOUND)
  assert.equal(buffer.length, 2)
  assert.match(String(buffer[0].id), /^[0-9a-f-]{36}$/i)
  assert.equal(buffer[0].timestamp, 1_000)
  assert.equal(buffer[1].timestamp, 2_000)
  assert.deepEqual(buffer[0].payload, {
    event: 'device.lifecycle_changed',
    previous: DeviceLifecycleState.NEW,
    next: DeviceLifecycleState.COMMISSIONING,
    reason: 'factory started',
  })
})

test('DeviceCore metadata uses explicit simulation time instead of wall time', () => {
  const device = createDevice({
    meta: {
      createdAt: 10,
      updatedAt: 10,
    },
  })

  device.updateMeta({ description: 'updated at simulation time' }, 25)

  assert.equal(device.getMeta().createdAt, 10)
  assert.equal(device.getMeta().updatedAt, 25)
})

test('DeviceCore keeps buffer capacity and drains messages predictably', (t) => {
  const device = createDevice({ bufferCapacity: 2 })

  device.pushToBuffer(message('message-1'))
  device.pushToBuffer(message('message-2'))
  device.pushToBuffer(message('message-3'))

  const beforeDrain = device.peekBuffer()
  const drained = device.drainBuffer(1)
  const afterDrain = device.peekBuffer()

  logStep(t, 'buffer capacity and drain', {
    capacity: 2,
    beforeDrain,
    drained,
    afterDrain,
    size: device.getBufferSize(),
  })

  assert.deepEqual(
    beforeDrain.map((entry) => entry.id),
    ['message-2', 'message-3'],
  )
  assert.deepEqual(
    drained.map((entry) => entry.id),
    ['message-2'],
  )
  assert.deepEqual(
    afterDrain.map((entry) => entry.id),
    ['message-3'],
  )
  assert.equal(device.getBufferSize(), 1)
})

test('DeviceCore rejects invalid config and decommissioned mutations', (t) => {
  const invalidConfigError = assertDeviceError(
    () =>
      createDevice({
        config: {
          heartbeatIntervalMs: 0,
        },
      }),
    'DEVICE_CONFIG_INVALID',
  )

  const device = createDevice()
  device.transitionTo(DeviceLifecycleState.COMMISSIONING)
  device.transitionTo(DeviceLifecycleState.BOUND)
  device.transitionTo(DeviceLifecycleState.PROVISIONED)
  device.transitionTo(DeviceLifecycleState.DECOMMISSIONED)

  const roleError = assertDeviceError(
    () => device.changeRole(DeviceRole.GATEWAY),
    'DEVICE_ALREADY_DECOMMISSIONED',
  )
  const executionError = assertDeviceError(
    () => device.setExecutionState(DeviceExecutionState.RUNNING),
    'DEVICE_ALREADY_DECOMMISSIONED',
  )

  logStep(t, 'validation and decommissioning guards', {
    invalidConfigError: {
      code: invalidConfigError.code,
      message: invalidConfigError.message,
    },
    finalLifecycleState: device.getLifecycleState(),
    blockedMutations: [
      {
        operation: 'changeRole',
        code: roleError.code,
        message: roleError.message,
      },
      {
        operation: 'setExecutionState',
        code: executionError.code,
        message: executionError.message,
      },
    ],
  })

  assert.equal(device.getLifecycleState(), DeviceLifecycleState.DECOMMISSIONED)
})
