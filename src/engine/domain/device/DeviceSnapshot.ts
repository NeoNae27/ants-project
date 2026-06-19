import { DeviceRole } from './DeviceRole'
import { DeviceLifecycleState } from './DeviceLifecycleState'
import { DeviceExecutionState } from './DeviceExecutionState'
import { DeviceCoreConfig } from './DeviceConfig'
import { DeviceMeta } from './DeviceMeta'
import { DeviceMessage } from './DeviceMessage'

/**
 * DeviceInfo — короткая информация об устройстве.
 *
 * Используется там, где не нужен полный snapshot:
 * список устройств, карточки в UI, быстрый debug или status panel.
 */
export type DeviceInfo = {
  /**
   * Уникальный идентификатор устройства.
   */
  id: string

  /**
   * Модель устройства.
   */
  model: string

  /**
   * Опциональное человекочитаемое имя.
   */
  name?: string

  /**
   * Версия устройства или виртуальной реализации.
   */
  version: string

  /**
   * Роль устройства в сети.
   */
  role: DeviceRole

  /**
   * Стадия жизненного цикла устройства.
   */
  lifecycleState: DeviceLifecycleState

  /**
   * Текущее состояние выполнения.
   */
  executionState: DeviceExecutionState

  /**
   * Количество подключённых модулей.
   */
  moduleCount: number

  /**
   * Количество сообщений во внутреннем буфере.
   */
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

/**
 * DeviceSnapshot — полный снимок состояния устройства.
 *
 * Snapshot нужен для:
 * - сохранения проекта;
 * - восстановления симуляции;
 * - debug;
 * - отображения подробного состояния в UI.
 */
export type DeviceSnapshot = {
  /**
   * Уникальный идентификатор устройства.
   */
  id: string

  /**
   * Модель устройства.
   */
  model: string

  /**
   * Опциональное человекочитаемое имя.
   */
  name?: string

  /**
   * Версия устройства или виртуальной реализации.
   */
  version: string

  /**
   * Роль устройства в сети.
   */
  role: DeviceRole

  /**
   * Стадия жизненного цикла устройства.
   */
  lifecycleState: DeviceLifecycleState

  /**
   * Текущее состояние выполнения.
   */
  executionState: DeviceExecutionState

  /**
   * Базовая конфигурация DeviceCore.
   */
  config: DeviceCoreConfig

  /**
   * Метаданные устройства.
   */
  meta: DeviceMeta

  /**
   * Снимки подключённых модулей.
   */
  modules: DeviceModuleSnapshot

  /**
   * Сообщения во внутреннем буфере устройства.
   */
  buffer: DeviceMessage[]
}
