import type { DeviceModule } from '../module'
import { DeviceRole } from './DeviceRole'
import { DeviceLifecycleState } from './DeviceLifecycleState'
import { DeviceExecutionState } from './DeviceExecutionState'
import { DeviceCoreConfig } from './DeviceConfig'
import { DeviceMeta } from './DeviceMeta'
import { DeviceMessage } from './DeviceMessage'
import { allowedDeviceTransitions } from './DeviceTransitions'
import { DeviceDomainError } from './DeviceErrors'

/**
 * DeviceCoreParams — параметры создания DeviceCore.
 *
 * Здесь задаётся только ядро устройства.
 * Конкретные LoRa, sensor, battery и другие capabilities подключаются
 * через module domain после создания.
 */
export type DeviceCoreParams = {
  /**
   * Уникальный идентификатор устройства.
   */
  id: string

  /**
   * Модель устройства.
   */
  model: string

  /**
   * Версия устройства или виртуальной реализации.
   */
  version: string

  /**
   * Роль устройства в сети.
   */
  role: DeviceRole

  /**
   * Базовая конфигурация ядра устройства.
   */
  config: DeviceCoreConfig

  /**
   * Опциональное человекочитаемое имя.
   */
  name?: string

  /**
   * Опциональные метаданные.
   */
  meta?: Partial<DeviceMeta>

  /**
   * Размер внутреннего буфера сообщений.
   */
  bufferCapacity?: number
}

/**
 * DeviceCore — центральная доменная модель устройства.
 *
 * Важно:
 * DeviceCore отвечает за идентичность, состояние, конфигурацию,
 * lifecycle, execution state, список модулей и общий message buffer.
 *
 * DeviceCore НЕ знает детали конкретных модулей:
 * LoRa, sensor, power и другие реализации подключаются через DeviceModule.
 */
export class DeviceCore {
  private readonly id: string //QUE: Change to the symbol type?
  private readonly model: string
  private readonly version: string

  private name?: string
  private role: DeviceRole
  private lifecycleState: DeviceLifecycleState
  private executionState: DeviceExecutionState
  private config: DeviceCoreConfig
  private meta: DeviceMeta

  /**
   * Список модулей устройства.
   *
   * DeviceCore хранит модули через базовый интерфейс DeviceModule.
   * Он не должен знать детали конкретных реализаций:
   * - как LoRaModule отправляет пакет;
   * - как SensorModule генерирует значение;
   * - как PowerModule считает заряд.
   *
   * Это сохраняет DeviceCore простым и расширяемым.
   */
  private readonly modules = new Map<string, DeviceModule>()

  /**
   * Внутренний буфер (память) устройства.
   *
   * Здесь могут храниться:
   * - telemetry messages;
   * - control messages;
   * - log messages;
   * - system messages.
   *
   * Это не radio-buffer и не LoRa-buffer.
   * Сетевые буферы должны находиться внутри network modules.
   */

  // TODO: Move to a new file DeviceBuffer
  private readonly buffer: {
    capacity: number
    queue: DeviceMessage[]
  }

  // Device Constructor
  constructor(params: DeviceCoreParams) {
    const now = Date.now()

    this.id = params.id
    this.model = params.model
    this.version = params.version
    this.name = params.name
    this.role = params.role // TODO: Create a default role. Example: None or set NODE as default role 

    this.lifecycleState = DeviceLifecycleState.NEW
    this.executionState = DeviceExecutionState.IDLE
    this.config = params.config

    this.meta = {
      createdAt: params.meta?.createdAt ?? now,
      updatedAt: params.meta?.updatedAt ?? now,
      location: params.meta?.location,
      tags: params.meta?.tags,
      description: params.meta?.description
    }

    this.buffer = {
      capacity: params.bufferCapacity ?? 100,
      queue: []
    }

    this.validateOrThrow()
  }

  /**
   * Возвращает короткую информацию об устройстве.
   *
   * Подходит для списков, карточек и status views,
   * где не нужен полный snapshot.
   */
  getInfo() {
    // TODO: Create DeviceInfo DTO
    return {
      id: this.id,
      model: this.model,
      name: this.name,
      version: this.version,
      role: this.role,
      lifecycleState: this.lifecycleState,
      executionState: this.executionState,
      moduleCount: this.modules.size,
      bufferSize: this.buffer.queue.length
    }
  }

  /**
   * Возвращает snapshot устройства.
   *
   * Для модулей вызывается getSnapshot(), если метод есть в интерфейсе.
   * Это позволяет сохранить не только базовые данные модуля,
   * но и его внутреннее состояние.
   */
  getSnapshot() {
    return {
      ...this.getInfo(),
      config: { ...this.config },
      meta: {
        ...this.meta,
        location: this.meta.location ? { ...this.meta.location } : undefined,
        tags: this.meta.tags ? [...this.meta.tags] : undefined
      },
      modules: Array.from(this.modules.values()),
      buffer: [...this.buffer.queue]
    }
  }

  /**
   * Возвращает роль устройства.
   */
  getRole(): DeviceRole {
    return this.role
  }

  /**
   * Меняет роль устройства.
   *
   * Нельзя менять роль decommissioned устройства.
   */
  changeRole(nextRole: DeviceRole): void {
    this.assertNotDecommissioned()
    this.role = nextRole
    this.touch()
  }

  /**
   * Возвращает человекочитаемое имя устройства.
   */
  getName(): string | undefined {
    return this.name
  }

  /**
   * Переименовывает устройство.
   *
   * Пустое имя запрещено, чтобы UI и debug-логи не получали
   * бессмысленное display name.
   */
  rename(nextName: string): void {
    if (!nextName.trim()) {
      throw new DeviceDomainError('Device name cannot be empty', 'DEVICE_NAME_EMPTY')
    }

    this.name = nextName
    this.touch()
  }

  /**
   * Возвращает копию базовой конфигурации.
   */
  getConfig(): DeviceCoreConfig {
    return { ...this.config }
  }

  /**
   * Обновляет базовую конфигурацию устройства.
   *
   * После применения patch конфигурация валидируется целиком.
   */
  updateConfig(patch: Partial<DeviceCoreConfig>): void {
    this.assertNotDecommissioned()

    this.config = {
      ...this.config,
      ...patch
    }

    this.touch()
    this.validateOrThrow()
  }

  /**
   * Возвращает копию метаданных устройства.
   */
  getMeta(): DeviceMeta {
    return {
      ...this.meta,
      location: this.meta.location ? { ...this.meta.location } : undefined,
      tags: this.meta.tags ? [...this.meta.tags] : undefined
    }
  }

  /**
   * Обновляет метаданные устройства и updatedAt.
   */
  updateMeta(patch: Partial<DeviceMeta>): void {
    this.meta = {
      ...this.meta,
      ...patch,
      updatedAt: Date.now()
    }
  }

  /**
   * Возвращает список модулей устройства.
   *
   * Возвращается readonly-массив, чтобы внешний код не мог напрямую
   * изменить внутреннее состояние DeviceCore.
   */
  getModules(): readonly DeviceModule[] {
    return Array.from(this.modules.values())
  }

  /**
   * Возвращает модуль по id.
   *
   * DeviceCore не приводит модуль к конкретному типу.
   * Если вызывающему коду нужен LoRaModule, он должен проверить тип отдельно.
   */
  getModule(moduleId: string): DeviceModule | undefined {
    return this.modules.get(moduleId)
  }

  /**
   * Добавляет модуль в устройство.
   *
   * Правило:
   * внутри одного устройства не может быть двух модулей с одинаковым id.
   */
  addModule(module: DeviceModule): void {
    this.assertNotDecommissioned()

    if (this.modules.has(module.id)) {
      throw new DeviceDomainError(
        `Module already exists: ${module.id}`,
        'DEVICE_MODULE_ALREADY_EXISTS'
      )
    }

    this.modules.set(module.id, module)
    this.touch()
  }

  /**
   * Удаляет модуль из устройства.
   *
   * На уровне DeviceCore мы только удаляем модуль из коллекции.
   * Если модулю нужно корректно завершить работу, это должен делать
   * отдельный service или сам модуль до удаления.
   */
  removeModule(moduleId: string): void {
    this.assertNotDecommissioned()

    if (!this.modules.has(moduleId)) {
      throw new DeviceDomainError(`Module not found: ${moduleId}`, 'DEVICE_MODULE_NOT_FOUND')
    }

    this.modules.delete(moduleId)
    this.touch()
  }

  /**
   * Возвращает lifecycle state устройства.
   */
  getLifecycleState(): DeviceLifecycleState {
    return this.lifecycleState
  }

  /**
   * Проверяет, разрешён ли переход в следующий lifecycle state.
   */
  canTransitionTo(next: DeviceLifecycleState): boolean {
    return allowedDeviceTransitions[this.lifecycleState]?.includes(next) ?? false
  }

  /**
   * Переводит устройство в новый lifecycle state.
   *
   * Успешный переход записывает log-сообщение во внутренний buffer,
   * чтобы история переходов была доступна для debug и UI.
   */
  transitionTo(next: DeviceLifecycleState, reason?: string): void {
    if (!this.canTransitionTo(next)) {
      throw new DeviceDomainError(
        `Invalid lifecycle transition: ${this.lifecycleState} -> ${next}`,
        'DEVICE_INVALID_TRANSITION'
      )
    }

    const previous = this.lifecycleState
    this.lifecycleState = next
    this.touch()

    this.pushToBuffer({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'log',
      payload: {
        event: 'device.lifecycle_changed',
        previous,
        next,
        reason
      }
    })
  }

  /**
   * Возвращает текущее execution state устройства.
   */
  getExecutionState(): DeviceExecutionState {
    return this.executionState
  }

  /**
   * Устанавливает execution state устройства.
   *
   * Decommissioned устройство больше не может выполнять действия.
   */
  setExecutionState(next: DeviceExecutionState): void {
    if (this.lifecycleState === DeviceLifecycleState.DECOMMISSIONED) {
      throw new DeviceDomainError(
        'Cannot change execution state of decommissioned device',
        'DEVICE_ALREADY_DECOMMISSIONED'
      )
    }

    this.executionState = next
    this.touch()
  }

  /**
   * Возвращает сообщения из buffer без удаления.
   */
  peekBuffer(limit?: number): readonly DeviceMessage[] {
    return limit ? this.buffer.queue.slice(0, limit) : [...this.buffer.queue]
  }

  /**
   * Удаляет и возвращает сообщения из buffer.
   *
   * Если limit не передан, очищает весь buffer.
   */
  drainBuffer(limit?: number): DeviceMessage[] {
    if (!limit) {
      const all = [...this.buffer.queue]
      this.buffer.queue.length = 0
      return all
    }

    return this.buffer.queue.splice(0, limit)
  }

  /**
   * Добавляет сообщение во внутренний buffer.
   *
   * Если buffer заполнен, самое старое сообщение вытесняется.
   */
  pushToBuffer(message: DeviceMessage): void {
    if (this.buffer.queue.length >= this.buffer.capacity) {
      this.buffer.queue.shift()
    }

    this.buffer.queue.push(message)
  }

  /**
   * Возвращает текущее количество сообщений в buffer.
   */
  getBufferSize(): number {
    return this.buffer.queue.length
  }

  // -- DEVICE VALIDATE -- //
  /**
   * Проверяет корректность текущего состояния устройства.
   */
  validate() {
    const issues: Array<{
      code: string
      message: string
      severity: 'error' | 'warning' | 'info'
    }> = []

    if (!this.id) {
      issues.push({
        code: 'DEVICE_ID_REQUIRED',
        message: 'Device id is required',
        severity: 'error'
      })
    }

    if (!this.model) {
      issues.push({
        code: 'DEVICE_MODEL_REQUIRED',
        message: 'Device model is required',
        severity: 'error'
      })
    }

    if (!this.version) {
      issues.push({
        code: 'DEVICE_VERSION_REQUIRED',
        message: 'Device version is required',
        severity: 'error'
      })
    }

    if (this.config.heartbeatIntervalMs <= 0) {
      issues.push({
        code: 'DEVICE_HEARTBEAT_INTERVAL_INVALID',
        message: 'Heartbeat interval must be greater than 0',
        severity: 'error'
      })
    }

    if (this.config.transmissionIntervalMs <= 0) {
      issues.push({
        code: 'DEVICE_TRANSMISSION_INTERVAL_INVALID',
        message: 'Transmission interval must be greater than 0',
        severity: 'error'
      })
    }

    if (this.config.maxRetries < 0) {
      issues.push({
        code: 'DEVICE_MAX_RETRIES_INVALID',
        message: 'Max retries cannot be negative',
        severity: 'error'
      })
    }

    return {
      valid: issues.every((issue) => issue.severity !== 'error'),
      issues
    }
  }

  // Validate function
  private validateOrThrow(): void {
    const result = this.validate()

    if (!result.valid) {
      throw new DeviceDomainError(
        result.issues.map((issue) => issue.message).join('; '),
        'DEVICE_CONFIG_INVALID'
      )
    }
  }

  private assertNotDecommissioned(): void {
    if (this.lifecycleState === DeviceLifecycleState.DECOMMISSIONED) {
      throw new DeviceDomainError('Device is decommissioned', 'DEVICE_ALREADY_DECOMMISSIONED')
    }
  }

  private touch(): void {
    this.meta.updatedAt = Date.now()
  }
}
