import type { DeviceInfo } from '../../src/engine/domain/device/DeviceSnapshot'
import { DeviceExecutionState } from '../../src/engine/domain/device/DeviceExecutionState'
import { DeviceLifecycleState } from '../../src/engine/domain/device/DeviceLifecycleState'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'

const deviceInfo: DeviceInfo = {
  id: 'device-1',
  model: 'ANT-100',
  version: '1.0.0',
  role: DeviceRole.NODE,
  lifecycleState: DeviceLifecycleState.ACTIVE,
  executionState: DeviceExecutionState.RUNNING,
  moduleCount: 3,
  bufferSize: 128,
}

const namedDeviceInfo: DeviceInfo = {
  ...deviceInfo,
  name: 'Greenhouse sensor',
}

const id: string = deviceInfo.id
const name: string | undefined = namedDeviceInfo.name
const role: DeviceRole = deviceInfo.role
const lifecycleState: DeviceLifecycleState = deviceInfo.lifecycleState
const executionState: DeviceExecutionState = deviceInfo.executionState
const moduleCount: number = deviceInfo.moduleCount
const bufferSize: number = deviceInfo.bufferSize

void id
void name
void role
void lifecycleState
void executionState
void moduleCount
void bufferSize

// @ts-expect-error DeviceInfo requires every core snapshot field.
const missingBufferSize: DeviceInfo = {
  id: 'device-2',
  model: 'ANT-200',
  version: '1.0.0',
  role: DeviceRole.REPEATER,
  lifecycleState: DeviceLifecycleState.NEW,
  executionState: DeviceExecutionState.IDLE,
  moduleCount: 1,
}

void missingBufferSize

const invalidRole: DeviceInfo = {
  ...deviceInfo,
  // @ts-expect-error role must be a DeviceRole enum value.
  role: 'sensor',
}

void invalidRole

const invalidBufferSize: DeviceInfo = {
  ...deviceInfo,
  // @ts-expect-error bufferSize must be numeric.
  bufferSize: '128',
}

void invalidBufferSize
