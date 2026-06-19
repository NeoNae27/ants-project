import { DeviceModule } from './DeviceModule'
import { ModuleLifecycleState } from './ModuleLifecycleState'
import { ModuleExecutionState } from './ModuleExecutionState'

/**
 * Расширенный базовый контракт для модулей,
 * у которых есть конфигурация и внутренний buffer.
 */
export interface BaseModule<TConfig = unknown, TBufferItem = unknown>
  extends DeviceModule {
  getConfig(): Readonly<TConfig>
  updateConfig(patch: Partial<TConfig>): void

  getBuffer(): readonly TBufferItem[]
  getBufferSize(): number
  pushToBuffer(item: TBufferItem): void
  drainBuffer(limit?: number): TBufferItem[]

  transitionTo(next: ModuleLifecycleState): void
  setExecutionState(next: ModuleExecutionState): void
}