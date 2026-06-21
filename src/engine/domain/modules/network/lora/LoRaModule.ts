import { ModuleKind } from '../../../module/ModuleKind'
import { ModuleLifecycleState } from '../../../module/ModuleLifecycleState'
import { ModuleExecutionState } from '../../../module/ModuleExecutionState'
import type { DeviceModule } from '../../../module/DeviceModule'
import { ModuleDomainError } from '../../../module/ModuleErrors'

import { LoRaRuntimeState } from './LoRaRuntimeState'
import type {
  LoRaModuleConfig,
  LoRaModuleConfigPatch,
  LoRaOutboundMessage,
  LoRaPacket,
  LoRaSendResult,
} from './LoRaTypes'

/**
 * LoRaModule — типовой сетевой модуль LoRa.
 *
 * Его задача:
 * - хранить LoRa-конфигурацию;
 * - создавать исходящие сообщения;
 * - создавать LoRaPacket;
 * - принимать входящие пакеты;
 * - хранить inbound/outbound buffers.
 *
 * Важно:
 * LoRaModule НЕ доставляет пакет другому устройству напрямую.
 * Доставку должен выполнять WirelessMedium.
 */
export class LoRaModule implements DeviceModule {
  /**
   * Категория модуля.
   *
   * DeviceCore может использовать это поле,
   * чтобы понять, что перед ним сетевой модуль.
   */
  public readonly kind = ModuleKind.NETWORK

  private lifecycleState: ModuleLifecycleState = ModuleLifecycleState.NEW
  private executionState: ModuleExecutionState = ModuleExecutionState.IDLE
  private runtimeState: LoRaRuntimeState = LoRaRuntimeState.SLEEP

  /**
   * Буфер входящих пакетов.
   *
   * Сюда будут попадать пакеты, которые доставил WirelessMedium.
   */
  private readonly inboundBuffer: LoRaPacket[] = []
  private receivedPacketCount = 0

  /**
   * Буфер исходящих сообщений.
   *
   * Сюда можно складывать сообщения перед формированием пакетов.
   */
  private readonly outboundBuffer: LoRaOutboundMessage[] = []

  constructor(
    public readonly id: string,
    public readonly model: string,
    public readonly version: string,

    /**
     * Адрес текущего LoRa-модуля в симулируемой сети.
     *
     * Например:
     * - "node-001"
     * - "gateway-001"
     * - "repeater-003"
     */
    private readonly sourceAddress: string,

    private config: LoRaModuleConfig,

    /**
     * Максимальный размер каждого buffer.
     *
     * Для MVP используем простую стратегию:
     * если buffer переполнен — удаляем самый старый элемент.
     */
    private readonly bufferCapacity = 128,
  ) {}

  /**
   * Возвращает состояние жизненного цикла модуля.
   */
  getLifecycleState(): ModuleLifecycleState {
    return this.lifecycleState
  }

  /**
   * Возвращает текущее состояние выполнения модуля.
   */
  getExecutionState(): ModuleExecutionState {
    return this.executionState
  }

  /**
   * Возвращает текущее радио-состояние LoRa-модуля.
   */
  getRuntimeState(): LoRaRuntimeState {
    return this.runtimeState
  }

  /**
   * Изменяет runtime-state LoRa-модуля.
   *
   * Например:
   * STANDBY → TX → STANDBY
   */
  setRuntimeState(next: LoRaRuntimeState): void {
    this.runtimeState = next
  }

  /**
   * Возвращает readonly-конфигурацию модуля.
   *
   * Внешний код не должен менять config напрямую.
   * Для изменения используется updateConfig().
   */
  getConfig(): Readonly<LoRaModuleConfig> {
    return this.config
  }

  /**
   * Частично обновляет конфигурацию LoRa-модуля.
   */
  updateConfig(patch: LoRaModuleConfigPatch): void {
    this.config = {
      ...this.config,
      ...patch,
      radio: {
        ...this.config.radio,
        ...(patch.radio ?? {}),
      },
      mesh: patch.mesh
        ? {
            ...(this.config.mesh ?? {
              enabled: false,
              nodeAddress: this.sourceAddress,
              relayEnabled: false,
              maxHops: 1,
            }),
            ...patch.mesh,
          }
        : this.config.mesh,
    }
  }

  /**
   * Переводит модуль в другое lifecycle-состояние.
   *
   * Пока без строгой state machine.
   * Позже можно добавить таблицу разрешённых переходов.
   */
  transitionTo(next: ModuleLifecycleState): void {
    this.lifecycleState = next
  }

  /**
   * Изменяет execution state.
   */
  setExecutionState(next: ModuleExecutionState): void {
    this.executionState = next
  }

  /**
   * Проверяет, может ли модуль передавать сообщения.
   */
  canTransmit(): boolean {
    return (
      this.lifecycleState === ModuleLifecycleState.ACTIVE &&
      this.executionState !== ModuleExecutionState.STOPPED &&
      this.runtimeState !== LoRaRuntimeState.ERROR &&
      this.runtimeState !== LoRaRuntimeState.SLEEP
    )
  }

  /**
   * Проверяет, может ли модуль принимать сообщения.
   */
  canReceive(): boolean {
    return (
      this.lifecycleState === ModuleLifecycleState.ACTIVE &&
      this.executionState !== ModuleExecutionState.STOPPED &&
      this.runtimeState !== LoRaRuntimeState.ERROR
    )
  }

  /**
   * Создаёт исходящее сообщение.
   *
   * Это ещё не LoRaPacket.
   * Это внутренняя структура модуля, из которой потом строится пакет.
   */
  createMessage(
    targetAddress: string,
    payload: unknown,
    options?: LoRaOutboundMessage['options'],
    nowMs = 0,
  ): LoRaOutboundMessage {
    if (!targetAddress.trim()) {
      throw new ModuleDomainError(
        'Target address is required',
        'LORA_TARGET_ADDRESS_REQUIRED',
      )
    }

    return {
      id: crypto.randomUUID(),
      timestamp: nowMs,
      targetAddress,
      payload,
      options: {
        requiresAck: options?.requiresAck ?? false,
        ttl: options?.ttl,
        retries: options?.retries ?? 0,
      },
    }
  }

  /**
   * Добавляет исходящее сообщение в outbound buffer.
   */
  enqueueOutbound(message: LoRaOutboundMessage): void {
    if (this.outboundBuffer.length >= this.bufferCapacity) {
      this.outboundBuffer.shift()
    }

    this.outboundBuffer.push(message)
  }

  /**
   * Создаёт LoRaPacket из исходящего сообщения.
   *
   * Именно этот объект потом должен передаваться в WirelessMedium.
   */
  buildPacket(message: LoRaOutboundMessage): LoRaPacket {
    return {
      packetId: `pkt_${message.id}`,
      sourceAddress: this.sourceAddress,
      targetAddress: message.targetAddress,
      payload: message.payload,
      radio: {
        frequencyHz: this.config.radio.frequencyHz,
        bandwidthHz: this.config.radio.bandwidthHz,
        spreadingFactor: this.config.radio.spreadingFactor,
        codingRate: this.config.radio.codingRate,
        powerDbm: this.config.radio.txPowerDbm,
        rangeMeters: this.config.radio.maxRangeMeters,
      },
      meta: {
        timestamp: message.timestamp,
        requiresAck: message.options?.requiresAck ?? false,
        ttl: message.options?.ttl,
        retries: message.options?.retries ?? 0,
      },
    }
  }

  /**
   * Отправка сообщения без ACK.
   *
   * Важно:
   * пока этот метод только создаёт пакет и выводит его в console.log.
   *
   * Позже логика будет такой:
   * LoRaModule.sendUnconfirmed(...)
   *   → buildPacket(...)
   *   → WirelessMedium.transmit(packet)
   */
  sendUnconfirmed(targetAddress: string, payload: unknown, nowMs = 0): LoRaSendResult {
    if (!this.canTransmit()) {
      return {
        success: false,
        error: 'LoRa module cannot transmit in current state',
      }
    }

    const message = this.createMessage(
      targetAddress,
      payload,
      {
        requiresAck: false,
        retries: 0,
      },
      nowMs,
    )

    this.enqueueOutbound(message)

    const packet = this.buildPacket(message)

    this.runtimeState = LoRaRuntimeState.TX

    console.log('[LoRaModule] Created unconfirmed LoRa packet:', packet)

    this.runtimeState = LoRaRuntimeState.STANDBY

    return {
      success: true,
      messageId: message.id,
      packet,
    }
  }

  /**
   * Заглушка для приёма пакета.
   *
   * Сейчас метод только:
   * - проверяет возможность приёма;
   * - кладёт пакет во входящий buffer;
   * - выводит пакет в console.log.
   *
   * Позже здесь можно будет добавить:
   * - проверку адреса получателя;
   * - CRC validation;
   * - фильтрацию duplicate packets;
   * - обработку ACK;
   * - передачу payload в DeviceCore или сервис телеметрии.
   */
  receive(packet: LoRaPacket): void {
    if (!this.canReceive()) {
      console.log('[LoRaModule] Packet ignored. Module cannot receive:', packet)
      return
    }

    this.runtimeState = LoRaRuntimeState.RX

    this.pushInbound(packet)

    console.log('[LoRaModule] Received LoRa packet stub:', packet)

    this.runtimeState = LoRaRuntimeState.STANDBY
  }

  /**
   * Добавляет пакет во входящий buffer.
   */
  pushInbound(packet: LoRaPacket): void {
    if (this.inboundBuffer.length >= this.bufferCapacity) {
      this.inboundBuffer.shift()
    }

    this.inboundBuffer.push(packet)
    this.receivedPacketCount += 1
  }

  /**
   * Возвращает копию входящего buffer.
   */
  getInboundBuffer(): readonly LoRaPacket[] {
    return [...this.inboundBuffer]
  }

  /**
   * Возвращает копию исходящего buffer.
   */
  getOutboundBuffer(): readonly LoRaOutboundMessage[] {
    return [...this.outboundBuffer]
  }

  /**
   * Очищает и возвращает входящие пакеты.
   */
  drainInbound(limit?: number): LoRaPacket[] {
    if (!limit) {
      const all = [...this.inboundBuffer]
      this.inboundBuffer.length = 0
      return all
    }

    return this.inboundBuffer.splice(0, limit)
  }

  /**
   * Очищает и возвращает исходящие сообщения.
   */
  drainOutbound(limit?: number): LoRaOutboundMessage[] {
    if (!limit) {
      const all = [...this.outboundBuffer]
      this.outboundBuffer.length = 0
      return all
    }

    return this.outboundBuffer.splice(0, limit)
  }

  /**
   * Метод из DeviceModule.
   *
   * Возвращает сериализуемое состояние модуля.
   * Его можно использовать для сохранения проекта или debug-панели.
   */
  getSnapshot() {
    return {
      id: this.id,
      kind: this.kind,
      model: this.model,
      version: this.version,
      sourceAddress: this.sourceAddress,
      lifecycleState: this.lifecycleState,
      executionState: this.executionState,
      runtimeState: this.runtimeState,
      config: this.config,
      inboundBufferSize: this.inboundBuffer.length,
      outboundBufferSize: this.outboundBuffer.length,
      receivedPacketCount: this.receivedPacketCount,
    }
  }

  /**
   * Простая валидация LoRa-модуля.
   *
   * Позже можно заменить на более подробный ValidationResult.
   */
  validate(): boolean {
    if (!this.id) return false
    if (!this.model) return false
    if (!this.version) return false
    if (!this.sourceAddress) return false

    if (!this.config.radio) return false
    if (!this.config.radio.frequencyHz) return false
    if (!this.config.radio.bandwidthHz) return false
    if (!this.config.radio.spreadingFactor) return false
    if (!this.config.radio.codingRate) return false
    if (!this.config.radio.maxPayloadSizeBytes) return false
    if (!this.config.radio.maxRangeMeters) return false
    if (!this.config.radio.maxConnections) return false

    return true
  }
}
