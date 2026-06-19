import type { DeviceModule } from '../module'
import { ModuleExecutionState } from '../module/ModuleExecutionState'
import { ModuleKind } from '../module/ModuleKind'
import { ModuleLifecycleState } from '../module/ModuleLifecycleState'

export type StubModuleConfig = Record<string, unknown>

export type StubModuleParams = {
  id: string
  kind: ModuleKind
  name: string
  model: string
  version: string
  config?: StubModuleConfig
}

export class StubModule implements DeviceModule {
  private lifecycleState = ModuleLifecycleState.NEW
  private executionState = ModuleExecutionState.IDLE
  private config: StubModuleConfig

  constructor(
    public readonly id: string,
    public readonly kind: ModuleKind,
    public readonly name: string,
    public readonly model: string,
    public readonly version: string,
    config?: StubModuleConfig,
  ) {
    this.config = { ...(config ?? {}) }
  }

  updateConfig(patch: StubModuleConfig): void {
    this.config = {
      ...this.config,
      ...patch,
    }
  }

  getLifecycleState(): ModuleLifecycleState {
    return this.lifecycleState
  }

  getExecutionState(): ModuleExecutionState {
    return this.executionState
  }

  validate(): boolean {
    return Boolean(this.id.trim() && this.model.trim() && this.version.trim())
  }

  getSnapshot() {
    return {
      id: this.id,
      kind: this.kind,
      name: this.name,
      model: this.model,
      version: this.version,
      lifecycleState: this.lifecycleState,
      executionState: this.executionState,
      config: { ...this.config },
    }
  }
}
