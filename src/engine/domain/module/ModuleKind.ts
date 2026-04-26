/**
 * ModuleKind описывает категорию модуля.
 *
 * DeviceCore использует это поле только для классификации модулей.
 * Конкретная логика модуля должна находиться в конкретных реализациях:
 * LoRaModule, SensorModule, PowerModule и т.д.
 */
export enum ModuleKind {
  /**
   * Сетевые модули: LoRa, Wi-Fi, Ethernet, Zigbee и т.д.
   */
  NETWORK = 'network',

  /**
   * Сенсорные модули: температура, влажность, CO2, освещённость и т.д.
   */
  SENSOR = 'sensor',

  /**
   * Модули питания: батарея, солнечная панель, power manager.
   */
  POWER = 'power',

  /**
   * Вычислительные модули: дополнительная логика обработки данных.
   */
  COMPUTE = 'compute',

  /**
   * Модули хранения: SD-card, flash storage, external memory.
   */
  STORAGE = 'storage'
}
