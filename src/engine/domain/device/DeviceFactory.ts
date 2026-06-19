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
  }): DeviceCore {
    const device = new DeviceCore({
      id: params.id,
      model: params.model,
      version: params.version,
      role: DeviceRole.NODE,
      name: params.name,
      
      // TODO: transform to params
      config: {
        heartbeatIntervalMs: 60_000,
        transmissionIntervalMs: 300_000,
        maxRetries: 3,
        powerMode: 'normal'
      },
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        location: {
          x: params.x,
          y: params.y
        }
      }
    })

    params.modules?.forEach((module) => device.addModule(module))

    return device
  }
}
