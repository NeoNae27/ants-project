/**
 * DeviceMessage — сообщение во внутреннем буфере устройства.
 *
 * DeviceCore не знает конкретный транспорт.
 * Здесь могут лежать telemetry, control, log или system messages,
 * а сетевые детали остаются внутри network modules.
 */
export type DeviceMessage = {
  /**
   * Уникальный идентификатор сообщения.
   */
  id: string

  /**
   * Время создания сообщения в milliseconds timestamp.
   */
  timestamp: number

  /**
   * Категория сообщения.
   */
  type: 'telemetry' | 'log' | 'control' | 'system'

  /**
   * Данные сообщения.
   *
   * Тип unknown оставляет формат payload конкретному отправителю:
   * telemetry может хранить измерения, log — событие, control — команду.
   */
  payload: unknown

  /**
   * Транспортные или приоритетные подсказки для обработчиков.
   */
  meta?: {
    /**
     * Сколько раз сообщение уже пытались обработать или отправить.
     */
    retries?: number

    /**
     * Time-to-live сообщения, если обработчик поддерживает истечение.
     */
    ttl?: number

    /**
     * Приоритет обработки внутри очередей.
     */
    priority?: 'low' | 'normal' | 'high'
  }
}
