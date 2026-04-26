import { DeviceRole } from './DeviceRole'
import { DeviceLifecycleState } from './DeviceLifecycleState'
import { DeviceExecutionState } from './DeviceExecutionState'
import { DeviceCoreConfig } from './DeviceConfig'
import { DeviceMeta } from './DeviceMeta'
import { DeviceMessage } from './DeviceMessage'

export type DeviceInfo = {
  id: string
  model: string
  name?: string
  version: string
  role: DeviceRole
  lifecycleState: DeviceLifecycleState
  executionState: DeviceExecutionState
  moduleCount: number
  bufferSize: number
}

export type DeviceSnapshot = {
  id: string
  model: string
  name?: string
  version: string
  role: DeviceRole
  lifecycleState: DeviceLifecycleState
  executionState: DeviceExecutionState
  config: DeviceCoreConfig
  meta: DeviceMeta
  modules: unknown[]
  buffer: DeviceMessage[]
}