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

/**
 * Snapshot одного модуля.
 *
 * Пока структура unknown, потому что разные модули имеют разное состояние:
 * - LoRaModule хранит radio config и buffers;
 * - SensorModule хранит last value и config;
 * - PowerModule хранит battery state.
 */
export type DeviceModuleSnapshot = unknown

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
  modules: DeviceModuleSnapshot
  buffer: DeviceMessage[]
}