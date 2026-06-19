import { LoRaProfile } from './LoRaProfile'
import { LoRaRegion } from './LoRaRegion'

/**
 * Конфигурация радио-части LoRa-модуля.
 *
 * Эти параметры относятся именно к LoRa-модулю,
 * поэтому они НЕ должны лежать в DeviceCoreConfig.
 */
export type LoRaRadioConfig = {
  /**
   * Режим работы LoRa.
   */
  profile: LoRaProfile

  /**
   * Частотный регион.
   */
  region: LoRaRegion

  /**
   * Рабочая частота в Hz.
   *
   * Например:
   * 868_000_000 для EU868.
   */
  frequencyHz: number

  /**
   * Ширина полосы в Hz.
   *
   * Типовые значения:
   * - 125_000
   * - 250_000
   * - 500_000
   */
  bandwidthHz: number

  /**
   * Spreading Factor.
   *
   * Чем выше SF, тем больше дальность,
   * но ниже скорость передачи.
   */
  spreadingFactor: 7 | 8 | 9 | 10 | 11 | 12

  /**
   * Coding Rate.
   *
   * Чем выше защита, тем устойчивее передача,
   * но больше overhead.
   */
  codingRate: '4/5' | '4/6' | '4/7' | '4/8'

  /**
   * Длина преамбулы.
   *
   * Пreambula нужна для синхронизации приёмника и передатчика.
   */
  preambleLength: number

  /**
   * Включена ли CRC-проверка.
   */
  crcEnabled: boolean

  /**
   * Используется ли implicit header mode.
   */
  implicitHeader: boolean

  /**
   * Мощность передачи в dBm.
   */
  txPowerDbm: number

  /**
   * Максимальный размер payload.
   *
   * Для SX1276 E32-400M30S можно считать 256 байт
   * как практическое ограничение для одного сообщения.
   */
  maxPayloadSizeBytes: number

  /**
   * Требуется ли ACK по умолчанию.
   *
   * Пока для MVP можно использовать false.
   */
  ackEnabled: boolean

  /**
   * Количество повторных попыток.
   */
  retryLimit: number

  /**
   * Timeout ожидания ответа.
   */
  timeoutMs: number

  /**
   * Симуляционный максимальный радиус передачи в метрах.
   *
   * Важно:
   * сам LoRaModule не ищет устройства в радиусе.
   * Это будет делать WirelessMedium.
   */
  maxRangeMeters: number
}

/**
 * Конфигурация mesh-режима.
 *
 * Пока она нужна как подготовка к будущей маршрутизации.
 */
export type LoRaMeshOptions = {
  enabled: boolean

  /**
   * Адрес текущего узла внутри LoRa/Mesh-сети.
   */
  nodeAddress: string

  /**
   * Может ли устройство ретранслировать чужие пакеты.
   */
  relayEnabled: boolean

  /**
   * Максимальное количество переходов между узлами.
   */
  maxHops: number
}

/**
 * Полная конфигурация LoRaModule.
 */
export type LoRaModuleConfig = {
  radio: LoRaRadioConfig
  mesh?: LoRaMeshOptions
}

export type LoRaModuleConfigPatch = {
  radio?: Partial<LoRaRadioConfig>
  mesh?: Partial<LoRaMeshOptions>
}

/**
 * Исходящее сообщение LoRa-модуля.
 *
 * Это ещё НЕ радиопакет.
 * Это сообщение, которое пользователь/устройство хочет отправить.
 */
export type LoRaOutboundMessage = {
  id: string
  timestamp: number

  /**
   * Адрес получателя.
   */
  targetAddress: string

  /**
   * Полезная нагрузка.
   *
   * Пока unknown, потому что payload может быть:
   * - telemetry;
   * - command;
   * - log;
   * - routing message.
   */
  payload: unknown

  options?: {
    requiresAck?: boolean
    ttl?: number
    retries?: number
  }
}

/**
 * LoRaPacket — уже сформированный пакет,
 * который может быть передан в WirelessMedium.
 *
 * Важно:
 * LoRaModule только создаёт пакет.
 * Он не должен сам доставлять пакет получателю.
 */
export type LoRaPacket = {
  packetId: string

  sourceAddress: string
  targetAddress: string

  payload: unknown

  radio: {
    frequencyHz: number
    bandwidthHz: number
    spreadingFactor: number
    codingRate: string
    powerDbm: number
    rangeMeters: number
  }

  meta: {
    timestamp: number
    requiresAck: boolean
    ttl?: number
    retries: number
  }
}

/**
 * Результат локальной операции отправки.
 *
 * success = true означает только то, что модуль смог создать пакет.
 * Это НЕ означает, что пакет был доставлен.
 */
export type LoRaSendResult = {
  success: boolean
  messageId?: string
  packet?: LoRaPacket
  error?: string
}
