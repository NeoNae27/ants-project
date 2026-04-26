/**
 * DeviceCoreConfig — базовая конфигурация DeviceCore.
 *
 * Здесь находятся только настройки, общие для любого устройства.
 * Специфичные параметры радиомодуля, сенсора или батареи должны
 * храниться внутри соответствующего module domain.
 */
export type DeviceCoreConfig = {
  /**
   * Как часто устройство отправляет heartbeat.
   */
  heartbeatIntervalMs: number

  /**
   * Как часто устройство пытается передавать накопленные данные.
   */
  transmissionIntervalMs: number

  /**
   * Максимальное количество повторных попыток для операций устройства.
   */
  maxRetries: number

  /**
   * Базовый режим питания устройства.
   */
  powerMode: 'normal' | 'low_power' // Not finale
}
