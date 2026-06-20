import { DeviceCore } from './DeviceCore'
import { DeviceRole } from './DeviceRole'
import { DeviceModule } from '../module'

/**
 * DeviceFactory создаёт типовые устройства с готовыми defaults.
 *
 * Фабрика скрывает boilerplate DeviceCore:
 * роль, базовую конфигурацию, meta timestamps и начальную location.
 */
export class DeviceFactory {
  static createDevice(params: {
    id: string
    model: string
    version: string
    role: DeviceRole
    name?: string
    x?: number
    y?: number
    modules?: readonly DeviceModule[]
    nowMs?: number
  }): DeviceCore {
    const nowMs = params.nowMs ?? 0
    const device = new DeviceCore({
      id: params.id,
      model: params.model,
      version: params.version,
      role: params.role,
      name: params.name,
      config: {
        heartbeatIntervalMs: 60_000,
        transmissionIntervalMs: 300_000,
        maxRetries: 3,
        powerMode: 'normal'
      },
      meta: {
        createdAt: nowMs,
        updatedAt: nowMs,
        location:
          params.x !== undefined && params.y !== undefined
            ? {
                x: params.x,
                y: params.y
              }
            : undefined
      }
    })

    params.modules?.forEach((module) => device.addModule(module))

    return device
  }

  /**
   * Создаёт обычную node-ноду.
   *
   * Опциональные modules сразу подключаются к DeviceCore,
   * но их конкретная логика остаётся в module domain.
   */
  static createNode(params: {
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
     * Опциональное человекочитаемое имя.
     */
    name?: string

    /**
     * X-координата устройства в симуляции.
     */
    x: number

    /**
     * Y-координата устройства в симуляции.
     */
    y: number

    /**
     * Модули, которые нужно подключить к устройству при создании.
     */
    modules?: readonly DeviceModule[]

    /**
     * Current simulation time for initial metadata.
     */
    nowMs?: number
  }): DeviceCore {
    return this.createDevice({
      id: params.id,
      model: params.model,
      version: params.version,
      name: params.name,
      role: DeviceRole.NODE,
      x: params.x,
      y: params.y,
      modules: params.modules,
      nowMs: params.nowMs
    })
  }

  /**
   * Creates a Gateway device without introducing a separate Gateway subclass.
   *
   * Gateway-specific behavior comes from the role, attached modules, and runtime handlers.
   */
  static createGateway(params: {
    id: string
    model: string
    version: string
    name?: string
    x: number
    y: number
    modules?: readonly DeviceModule[]
    nowMs?: number
  }): DeviceCore {
    return this.createDevice({
      id: params.id,
      model: params.model,
      version: params.version,
      name: params.name,
      role: DeviceRole.GATEWAY,
      x: params.x,
      y: params.y,
      modules: params.modules,
      nowMs: params.nowMs
    })
  }
}
