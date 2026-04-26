import { ModuleKind } from './ModuleKind'
import { ModuleLifecycleState } from './ModuleLifecycleState'
import { ModuleExecutionState } from './ModuleExecutionState'

/**
 * DeviceModule — базовый контракт любого модуля,
 * который может быть подключён к DeviceCore.
 *
 * Важно:
 * DeviceCore НЕ должен знать, какой именно это модуль:
 * LoRa, датчик температуры, батарея или что-то другое.
 *
 * DeviceCore хранит модули через этот интерфейс.
 * Конкретная логика находится в отдельных доменах/классах модулей.
 */
export interface DeviceModule {
  /**
   * Уникальный идентификатор модуля внутри устройства.
   *
   * Например:
   * - "lora-1"
   * - "battery-1"
   * - "sensor-temperature-1"
   */
  readonly id: string

  /**
   * Категория модуля.
   *
   * По этому полю можно понять, что это:
   * - network module;
   * - sensor module;
   * - power module;
   * - compute module.
   */
  readonly kind: ModuleKind

  /**
   * Модель модуля.
   *
   * Например:
   * - "SX1276"
   * - "BME280"
   * - "EZO-CO2"
   */
  readonly model: string

  /**
   * Версия модуля или его виртуальной реализации.
   *
   * Например:
   * - "1.0.0"
   * - "sim-v1"
   */
  readonly version: string

  /**
   * Состояние жизненного цикла модуля.
   *
   * Например:
   * - new;
   * - initialized;
   * - active;
   * - failed.
   */
  getLifecycleState(): ModuleLifecycleState

  /**
   * Текущее состояние выполнения модуля.
   *
   * Например:
   * - idle;
   * - running;
   * - paused;
   * - stopped.
   */
  getExecutionState(): ModuleExecutionState

  /**
   * Возвращает снимок состояния модуля.
   *
   * Snapshot нужен для:
   * - сохранения проекта;
   * - debug;
   * - отображения в UI;
   * - восстановления симуляции.
   */
  getSnapshot(): unknown

  /**
   * Проверяет корректность состояния модуля.
   *
   * Например:
   * LoRaModule может проверить frequency, spreadingFactor, bandwidth.
   * SensorModule может проверить sample interval и диапазон значений.
   */
  validate(): boolean
}