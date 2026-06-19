import { ModuleKind } from './ModuleKind'
import { ModuleLifecycleState } from './ModuleLifecycleState'
import { ModuleExecutionState } from './ModuleExecutionState'

/**
 * Базовый контракт любого модуля устройства.
 *
 * DeviceCore работает именно с этим интерфейсом.
 * Он не должен знать, какой конкретно модуль подключён:
 * LoRa, BME280, Battery или другой.
 */

// QUE: Remove this interface?
export interface DeviceModule {
  readonly id: string
  readonly kind: ModuleKind
  readonly model: string
  readonly version: string

  getLifecycleState(): ModuleLifecycleState
  getExecutionState(): ModuleExecutionState

  validate(): boolean
  getSnapshot(): unknown
}