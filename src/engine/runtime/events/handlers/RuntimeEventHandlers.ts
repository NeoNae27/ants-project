import { DeviceExecutionState } from '../../../domain/device/DeviceExecutionState'
import { DeviceLifecycleState } from '../../../domain/device/DeviceLifecycleState'
import type { LoRaModule, LoRaPacket } from '../../../domain/modules/network/lora'
import {
  TelemetrySensorFlags,
  type TelemetryPayloadV1
} from '../../../domain/lora/codec'
import {
  LORA_CODEC_REPORT_NOTE_PREFIX,
  LoRaCodecReportService,
  type LoRaEncodedPacketPayload,
  isLoRaCodecEncodedPacketPayload,
  loraAddressToNumericAddress
} from '../../../application/simulation/LoRaCodecReportService'
import { EventDispatchError, type EventDispatchErrorCode } from '../EventDispatcherErrors'
import type { DispatchContext, EventHandler } from '../EventDispatcherTypes'
import { EventPriority, type SimulationEvent } from '../EventQueueTypes'
import { createDeterministicTelemetry } from '../DeterministicTelemetryFactory'
import {
  findRuntimeDeviceByAddress,
  findRuntimeDeviceById,
  findRuntimeLoRaAddress,
  findRuntimeLoRaEndpoint,
  findRuntimeLoRaModule,
  getRuntimeDeviceId,
  isRuntimeGatewayDevice,
  isRuntimeLoRaModule
} from '../RuntimeEventContext'
import type {
  GatewayPacketReceivedPayload,
  LoRaCodecSendPayload,
  LoRaPingSendPayload,
  PacketDeliveryPayload,
  TelemetrySamplePayload,
  TelemetrySendPayload,
  WirelessPacketLostPayload
} from '../RuntimeEventPayloads'
import { RuntimeEventType } from '../RuntimeEventTypes'

const DEFAULT_SEND_DELAY_MS = 1
const DEFAULT_DELIVERY_DELAY_MS = 100

type WirelessMediumPort = {
  transmit(
    packet: LoRaPacket,
    context: DispatchContext,
    options?: { sourceDeviceId?: string; parentEventId?: string }
  ): unknown
}

type RuntimeMetricsCollectorPort = {
  recordTelemetryGenerated?(details: unknown): void
  recordPacketSent?(details: unknown): void
  recordPacketDelivered?(details: unknown): void
  recordHandlerFailure?(details: unknown): void
}

export const TelemetrySampleHandler: EventHandler =
  function TelemetrySampleHandler(event, context) {
    const payload = requireTelemetrySamplePayload(event)
    const sendDelayMs = payload.sendDelayMs ?? DEFAULT_SEND_DELAY_MS

    if (!Number.isFinite(sendDelayMs) || sendDelayMs <= 0) {
      fail('INVALID_EVENT_PAYLOAD', 'sendDelayMs must be greater than zero', {
        eventId: event.id,
        sendDelayMs
      })
    }

    const measuredAtUnix =
      typeof payload.measuredAtUnix === 'number'
        ? payload.measuredAtUnix
        : Math.max(0, Math.floor(context.simulationTimeMs / 1000))
    const sequence =
      typeof payload.sequence === 'number'
        ? payload.sequence
        : Math.max(1, Math.floor(context.simulationTimeMs / 1000))
    const telemetry = createDeterministicTelemetry({
      deviceId: payload.deviceId,
      simulationTimeMs: measuredAtUnix * 1000,
      sequence
    })
    const scheduledSend = context.eventQueue.schedule<TelemetrySendPayload>({
      id: `${event.id}:send`,
      type: RuntimeEventType.TELEMETRY_SEND,
      scheduledAt: context.simulationTimeMs + sendDelayMs,
      createdAt: context.simulationTimeMs,
      priority: EventPriority.TELEMETRY,
      source: { type: 'device', id: payload.deviceId },
      target: event.target ? { ...event.target } : { deviceId: payload.deviceId },
      payload: {
        deviceId: payload.deviceId,
        targetAddress: payload.targetAddress,
        telemetry,
        deliveryDelayMs: payload.deliveryDelayMs
      },
      meta: {
        parentEventId: event.id,
        correlationId: event.meta?.correlationId
      }
    })
    const scheduledEventIds = [scheduledSend.id]

    if (payload.repeat) {
      const intervalMs = payload.intervalMs

      if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        fail('INVALID_INTERVAL', 'repeat requires intervalMs greater than zero', {
          eventId: event.id,
          intervalMs
        })
      }

      const nextScheduledAt = context.simulationTimeMs + intervalMs
      const nextMeasuredAtUnix = Math.max(measuredAtUnix + 1, Math.floor(nextScheduledAt / 1000))

      const scheduledNext = context.eventQueue.schedule<TelemetrySamplePayload>({
        id: `${event.id}:next:${nextScheduledAt}`,
        type: RuntimeEventType.TELEMETRY_SAMPLE,
        scheduledAt: nextScheduledAt,
        createdAt: context.simulationTimeMs,
        priority: EventPriority.TELEMETRY,
        source: event.source ? { ...event.source } : { type: 'device', id: payload.deviceId },
        target: event.target ? { ...event.target } : { deviceId: payload.deviceId },
        payload: {
          ...payload,
          sequence: sequence + 1,
          measuredAtUnix: nextMeasuredAtUnix
        },
        meta: {
          parentEventId: event.id,
          correlationId: event.meta?.correlationId
        }
      })

      scheduledEventIds.push(scheduledNext.id)
    }

    toMetricsCollector(context.metricsCollector)?.recordTelemetryGenerated?.({
      deviceId: payload.deviceId,
      messageId: telemetry.message_id,
      simulationTimeMs: context.simulationTimeMs
    })
    context.logger?.debug?.('telemetry_generated', {
      deviceId: payload.deviceId,
      messageId: telemetry.message_id
    })

    return {
      scheduledEventIds,
      notes: [`telemetry generated: ${telemetry.message_id}`]
    }
  }

export const TelemetrySendHandler: EventHandler =
  function TelemetrySendHandler(event, context) {
    const payload = requireTelemetrySendPayload(event)
    const sourceDevice = findRuntimeDeviceById(context, payload.deviceId)

    if (!sourceDevice) {
      fail('SOURCE_DEVICE_NOT_FOUND', `Source device not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      fail('SOURCE_NETWORK_MODULE_NOT_FOUND', `Source LoRa module not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceAddress = findRuntimeLoRaAddress(context, payload.deviceId, sourceModule.id)

    if (!sourceAddress) {
      fail('SOURCE_LORA_ADDRESS_REQUIRED', `Source LoRa address not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId,
        moduleId: sourceModule.id
      })
    }

    const targetDevice = findRuntimeDeviceByAddress(context, payload.targetAddress)
    const targetDeviceId = targetDevice ? getRuntimeDeviceId(targetDevice) : undefined
    const encodedPayloads = new LoRaCodecReportService().buildEncodedPayloads({
      mode: 'direct',
      telemetry: runtimeTelemetryToLoRaTelemetry(
        payload.telemetry,
        loraAddressToNumericAddress(sourceAddress)
      ),
      source: {
        deviceId: payload.deviceId,
        moduleId: sourceModule.id,
        address: sourceAddress,
        numericAddress: loraAddressToNumericAddress(sourceAddress)
      },
      target: {
        deviceId: targetDeviceId ?? payload.targetAddress,
        address: payload.targetAddress,
        numericAddress: loraAddressToNumericAddress(payload.targetAddress)
      },
      sourceModuleConfig: sourceModule.getConfig()
    })
    const wirelessMedium = toWirelessMedium(context.wirelessMedium)
    const scheduledEventIds: string[] = []
    const notes: string[] = []

    for (const encodedPayload of encodedPayloads) {
      const packet = createEncodedLoRaPacket({
        sourceAddress,
        targetAddress: payload.targetAddress,
        encodedPayload,
        sourceModule,
        simulationTimeMs: context.simulationTimeMs
      })

      if (wirelessMedium) {
        const transmissionResult = wirelessMedium.transmit(packet, context, {
          sourceDeviceId: payload.deviceId,
          parentEventId: event.id
        })
        scheduledEventIds.push(...getScheduledEventIds(transmissionResult))
        notes.push(`encoded telemetry packet transmit requested: ${packet.packetId}`)
      } else {
        const deliveryDelayMs = payload.deliveryDelayMs ?? DEFAULT_DELIVERY_DELAY_MS

        if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
          fail('INVALID_EVENT_PAYLOAD', 'deliveryDelayMs must be greater than zero', {
            eventId: event.id,
            deliveryDelayMs
          })
        }

        const scheduledDelivery = context.eventQueue.schedule<PacketDeliveryPayload>({
          id: `${event.id}:delivery`,
          type: RuntimeEventType.PACKET_DELIVERY,
          scheduledAt: context.simulationTimeMs + deliveryDelayMs,
          createdAt: context.simulationTimeMs,
          priority: EventPriority.WIRELESS_DELIVERY,
          source: { type: 'module', id: sourceModule.id },
          target: targetDevice ? { deviceId: getRuntimeDeviceId(targetDevice) } : undefined,
          payload: {
            packet,
            targetAddress: payload.targetAddress,
            ...(targetDevice ? { targetDeviceId: getRuntimeDeviceId(targetDevice) } : {}),
            sentAtSimulationMs: context.simulationTimeMs
          },
          meta: {
            parentEventId: event.id,
            correlationId: event.meta?.correlationId
          }
        })

        scheduledEventIds.push(scheduledDelivery.id)
        notes.push(`encoded telemetry packet delivery scheduled: ${packet.packetId}`)
      }

      toMetricsCollector(context.metricsCollector)?.recordPacketSent?.({
        packet,
        simulationTimeMs: context.simulationTimeMs
      })
      context.logger?.debug?.('encoded_telemetry_packet_transmit_requested', {
        packetId: packet.packetId
      })
    }

    return {
      scheduledEventIds,
      notes
    }
  }

export const LoRaCodecSendHandler: EventHandler =
  function LoRaCodecSendHandler(event, context) {
    const payload = requireLoRaCodecSendPayload(event)
    const sourceDevice = findRuntimeDeviceById(context, payload.deviceId)

    if (!sourceDevice) {
      fail('SOURCE_DEVICE_NOT_FOUND', `Source device not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      fail('SOURCE_NETWORK_MODULE_NOT_FOUND', `Source LoRa module not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceAddress = findRuntimeLoRaAddress(context, payload.deviceId, sourceModule.id)

    if (!sourceAddress) {
      fail('SOURCE_LORA_ADDRESS_REQUIRED', `Source LoRa address not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId,
        moduleId: sourceModule.id
      })
    }

    const targetDevice = findRuntimeDeviceByAddress(context, payload.targetAddress)
    const targetDeviceId = targetDevice ? getRuntimeDeviceId(targetDevice) : undefined
    const service = new LoRaCodecReportService()
    const encodedPayloads = service.buildEncodedPayloads({
      mode: payload.mode,
      telemetry: payload.telemetry,
      source: {
        deviceId: payload.deviceId,
        moduleId: sourceModule.id,
        address: sourceAddress,
        numericAddress: loraAddressToNumericAddress(sourceAddress)
      },
      target: {
        deviceId: targetDeviceId ?? payload.targetAddress,
        address: payload.targetAddress,
        numericAddress: loraAddressToNumericAddress(payload.targetAddress)
      },
      sourceModuleConfig: sourceModule.getConfig()
    })
    const wirelessMedium = toWirelessMedium(context.wirelessMedium)
    const scheduledEventIds: string[] = []
    const notes: string[] = []

    for (const encodedPayload of encodedPayloads) {
      const packet = createEncodedLoRaPacket({
        sourceAddress,
        targetAddress: payload.targetAddress,
        encodedPayload,
        sourceModule,
        simulationTimeMs: context.simulationTimeMs
      })

      if (wirelessMedium) {
        const transmissionResult = wirelessMedium.transmit(packet, context, {
          sourceDeviceId: payload.deviceId,
          parentEventId: event.id
        })
        scheduledEventIds.push(...getScheduledEventIds(transmissionResult))
        notes.push(`lora codec packet transmit requested: ${packet.packetId}`)
      } else {
        const deliveryDelayMs = payload.deliveryDelayMs ?? DEFAULT_DELIVERY_DELAY_MS

        if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
          fail('INVALID_EVENT_PAYLOAD', 'deliveryDelayMs must be greater than zero', {
            eventId: event.id,
            deliveryDelayMs
          })
        }

        const scheduledDelivery = context.eventQueue.schedule<PacketDeliveryPayload>({
          id: `${event.id}:delivery:${encodedPayload.frameMode}`,
          type: RuntimeEventType.PACKET_DELIVERY,
          scheduledAt: context.simulationTimeMs + deliveryDelayMs,
          createdAt: context.simulationTimeMs,
          priority: EventPriority.WIRELESS_DELIVERY,
          source: { type: 'module', id: sourceModule.id },
          target: targetDeviceId ? { deviceId: targetDeviceId } : undefined,
          payload: {
            packet,
            targetAddress: payload.targetAddress,
            ...(targetDeviceId ? { targetDeviceId } : {}),
            sentAtSimulationMs: context.simulationTimeMs
          },
          meta: {
            parentEventId: event.id,
            correlationId: event.meta?.correlationId
          }
        })

        scheduledEventIds.push(scheduledDelivery.id)
        notes.push(`lora codec packet delivery scheduled: ${packet.packetId}`)
      }

      toMetricsCollector(context.metricsCollector)?.recordPacketSent?.({
        packet,
        simulationTimeMs: context.simulationTimeMs
      })
      context.logger?.debug?.('lora_codec_packet_transmit_requested', {
        packetId: packet.packetId,
        frameMode: encodedPayload.frameMode
      })
    }

    return {
      scheduledEventIds,
      notes
    }
  }

export const LoRaPingSendHandler: EventHandler =
  function LoRaPingSendHandler(event, context) {
    const payload = requireLoRaPingSendPayload(event)
    const sourceDevice = findRuntimeDeviceById(context, payload.deviceId)

    if (!sourceDevice) {
      fail('SOURCE_DEVICE_NOT_FOUND', `Source device not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      fail('SOURCE_NETWORK_MODULE_NOT_FOUND', `Source LoRa module not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    const sourceAddress = findRuntimeLoRaAddress(context, payload.deviceId, sourceModule.id)

    if (!sourceAddress) {
      fail('SOURCE_LORA_ADDRESS_REQUIRED', `Source LoRa address not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId,
        moduleId: sourceModule.id
      })
    }

    const targetDevice = findRuntimeDeviceByAddress(context, payload.targetAddress)
    const targetDeviceId = targetDevice ? getRuntimeDeviceId(targetDevice) : undefined
    const service = new LoRaCodecReportService()
    const encodedPayloads = service.buildPingEncodedPayloads({
      mode: payload.mode ?? 'direct',
      ping: payload.ping,
      source: {
        deviceId: payload.deviceId,
        moduleId: sourceModule.id,
        address: sourceAddress,
        numericAddress: loraAddressToNumericAddress(sourceAddress)
      },
      target: {
        deviceId: targetDeviceId ?? payload.targetAddress,
        address: payload.targetAddress,
        numericAddress: loraAddressToNumericAddress(payload.targetAddress)
      },
      sourceModuleConfig: sourceModule.getConfig()
    })
    const wirelessMedium = toWirelessMedium(context.wirelessMedium)
    const scheduledEventIds: string[] = []
    const notes: string[] = []

    for (const encodedPayload of encodedPayloads) {
      const packet = createEncodedLoRaPacket({
        sourceAddress,
        targetAddress: payload.targetAddress,
        encodedPayload,
        sourceModule,
        simulationTimeMs: context.simulationTimeMs
      })

      if (wirelessMedium) {
        const transmissionResult = wirelessMedium.transmit(packet, context, {
          sourceDeviceId: payload.deviceId,
          parentEventId: event.id
        })
        scheduledEventIds.push(...getScheduledEventIds(transmissionResult))
        notes.push(`lora ping packet transmit requested: ${packet.packetId}`)
      } else {
        const deliveryDelayMs = payload.deliveryDelayMs ?? DEFAULT_DELIVERY_DELAY_MS

        if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
          fail('INVALID_EVENT_PAYLOAD', 'deliveryDelayMs must be greater than zero', {
            eventId: event.id,
            deliveryDelayMs
          })
        }

        const scheduledDelivery = context.eventQueue.schedule<PacketDeliveryPayload>({
          id: `${event.id}:delivery:${encodedPayload.frameMode}`,
          type: RuntimeEventType.PACKET_DELIVERY,
          scheduledAt: context.simulationTimeMs + deliveryDelayMs,
          createdAt: context.simulationTimeMs,
          priority: EventPriority.WIRELESS_DELIVERY,
          source: { type: 'module', id: sourceModule.id },
          target: targetDeviceId ? { deviceId: targetDeviceId } : undefined,
          payload: {
            packet,
            targetAddress: payload.targetAddress,
            ...(targetDeviceId ? { targetDeviceId } : {}),
            sentAtSimulationMs: context.simulationTimeMs
          },
          meta: {
            parentEventId: event.id,
            correlationId: event.meta?.correlationId
          }
        })

        scheduledEventIds.push(scheduledDelivery.id)
        notes.push(`lora ping packet delivery scheduled: ${packet.packetId}`)
      }

      toMetricsCollector(context.metricsCollector)?.recordPacketSent?.({
        packet,
        simulationTimeMs: context.simulationTimeMs
      })
      context.logger?.debug?.('lora_ping_packet_transmit_requested', {
        packetId: packet.packetId,
        frameMode: encodedPayload.frameMode
      })
    }

    return {
      scheduledEventIds,
      notes
    }
  }

export const PacketDeliveryHandler: EventHandler =
  function PacketDeliveryHandler(event, context) {
    const payload = requirePacketDeliveryPayload(event)
    const targetDevice = payload.targetDeviceId
      ? findRuntimeDeviceById(context, payload.targetDeviceId)
      : findRuntimeDeviceByAddress(context, payload.targetAddress)

    if (!targetDevice) {
      fail('TARGET_DEVICE_NOT_FOUND', `Target device not found: ${payload.targetAddress}`, {
        eventId: event.id,
        targetAddress: payload.targetAddress,
        targetDeviceId: payload.targetDeviceId
      })
    }

    const targetDeviceId = getRuntimeDeviceId(targetDevice)
    const endpoint = findRuntimeLoRaEndpoint(context, targetDeviceId, payload.targetAddress)

    if (!endpoint) {
      fail('TARGET_LORA_ADDRESS_REQUIRED', `Target LoRa address not found: ${payload.targetAddress}`, {
        eventId: event.id,
        targetAddress: payload.targetAddress,
        targetDeviceId
      })
    }

    const endpointModule = targetDevice.getModule(endpoint.moduleId)
    const targetModule = isRuntimeLoRaModule(endpointModule)
      ? endpointModule
      : findRuntimeLoRaModule(targetDevice)

    if (!targetModule) {
      fail('TARGET_NETWORK_MODULE_NOT_FOUND', `Target LoRa module not found: ${targetDeviceId}`, {
        eventId: event.id,
        targetDeviceId,
        moduleId: endpoint.moduleId
      })
    }

    try {
      targetModule.pushInbound(payload.packet)
    } catch (error) {
      fail('PACKET_DELIVERY_FAILED', `Packet delivery failed: ${payload.packet.packetId}`, {
        eventId: event.id,
        packetId: payload.packet.packetId,
        error
      })
    }

    toMetricsCollector(context.metricsCollector)?.recordPacketDelivered?.({
      packet: payload.packet,
      targetDeviceId,
      simulationTimeMs: context.simulationTimeMs
    })
    context.logger?.debug?.('packet_delivered', {
      packetId: payload.packet.packetId,
      targetDeviceId
    })

    if (isRuntimeGatewayDevice(targetDevice)) {
      const scheduledGatewayReceive = context.eventQueue.schedule<GatewayPacketReceivedPayload>({
        id: `${event.id}:gateway-received`,
        type: RuntimeEventType.GATEWAY_PACKET_RECEIVED,
        scheduledAt: context.simulationTimeMs + 1,
        createdAt: context.simulationTimeMs,
        priority: EventPriority.WIRELESS_DELIVERY,
        source: { type: 'module', id: targetModule.id },
        target: { deviceId: targetDeviceId, moduleId: targetModule.id },
        payload: {
          gatewayDeviceId: targetDeviceId,
          packet: payload.packet,
          receivedAtSimulationMs: context.simulationTimeMs,
          targetAddress: payload.targetAddress
        },
        meta: {
          parentEventId: event.id,
          correlationId: event.meta?.correlationId
        }
      })

      return {
        scheduledEventIds: [scheduledGatewayReceive.id],
        notes: [
          `packet delivered: ${payload.packet.packetId}`,
          `gateway receive scheduled: ${scheduledGatewayReceive.id}`
        ]
      }
    }

    return {
      notes: [`packet delivered: ${payload.packet.packetId}`]
    }
  }

export const PacketLostHandler: EventHandler =
  function PacketLostHandler(event, context) {
    const payload = requirePacketLostPayload(event)

    toMetricsCollector(context.metricsCollector)?.recordHandlerFailure?.({
      packet: payload.packet ?? payload.radioPacket,
      reason: payload.reason,
      link: payload.link,
      simulationTimeMs: context.simulationTimeMs
    })
    context.logger?.warn?.('wireless.packet_lost', {
      packetId: payload.radioPacket.id,
      sourceDeviceId: payload.sourceDeviceId,
      targetDeviceId: payload.targetDeviceId,
      targetAddress: payload.targetAddress,
      reason: payload.reason,
      link: payload.link,
      lostAtSimulationMs: payload.lostAtSimulationMs
    })

    return {
      notes: [`packet lost: ${payload.radioPacket.id} (${payload.reason})`]
    }
  }

export const GatewayPacketReceivedHandler: EventHandler =
  function GatewayPacketReceivedHandler(event, context) {
    const payload = requireGatewayPacketReceivedPayload(event)
    const gatewayDevice = findRuntimeDeviceById(context, payload.gatewayDeviceId)

    if (gatewayDevice && !isRuntimeGatewayDevice(gatewayDevice)) {
      fail('TARGET_GATEWAY_REQUIRED', `Gateway device expected: ${payload.gatewayDeviceId}`, {
        eventId: event.id,
        gatewayDeviceId: payload.gatewayDeviceId
      })
    }

    if (isLoRaCodecEncodedPacketPayload(payload.packet.payload)) {
      const report = new LoRaCodecReportService().decodeReceivedPayload(payload.packet.payload)

      context.logger?.info?.('gateway.packet_received', {
        gatewayDeviceId: payload.gatewayDeviceId,
        packetId: payload.packet.packetId,
        messageKind: report.messageKind,
        frameMode: report.frameMode,
        encodedBytesHex: report.encoded.encodedBytesHex,
        decodedMessage:
          report.messageKind === 'ping'
            ? report.decoded.decodedPing
            : report.decoded.decodedTelemetry,
        reconstructedMessageId: report.decoded.reconstructedMessageId,
        roundtrip: report.roundtrip.ok ? 'OK' : 'FAIL'
      })

      return {
        notes: [
          `gateway packet received: ${payload.packet.packetId}`,
          `gateway decoded LoRa codec packet: ${payload.packet.packetId}`,
          `${LORA_CODEC_REPORT_NOTE_PREFIX}${JSON.stringify(report)}`
        ]
      }
    }

    context.logger?.info?.('gateway.packet_received', {
      gatewayDeviceId: payload.gatewayDeviceId,
      packetId: payload.packet.packetId,
      sourceAddress: payload.packet.sourceAddress,
      targetAddress: payload.packet.targetAddress ?? payload.targetAddress,
      receivedAtSimulationMs: payload.receivedAtSimulationMs,
      telemetry: payload.packet.payload
    })

    return {
      notes: [`gateway packet received: ${payload.packet.packetId}`]
    }
  }

export const DeviceStateChangeHandler: EventHandler =
  function DeviceStateChangeHandler(event, context) {
    const payload = requireDeviceStateChangePayload(event)
    const device = findRuntimeDeviceById(context, payload.deviceId)

    if (!device) {
      fail('DEVICE_NOT_FOUND', `Device not found: ${payload.deviceId}`, {
        eventId: event.id,
        deviceId: payload.deviceId
      })
    }

    try {
      if (payload.lifecycleState) {
        device.transitionTo(
          payload.lifecycleState,
          payload.reason,
          context.simulationTimeMs,
          `${event.id}:lifecycle:${payload.lifecycleState}`
        )
      }

      if (payload.executionState) {
        device.setExecutionState(payload.executionState, context.simulationTimeMs)
      }
    } catch (error) {
      fail('INVALID_STATE_TRANSITION', 'Device state transition failed', {
        eventId: event.id,
        deviceId: payload.deviceId,
        error
      })
    }

    context.logger?.debug?.('device_state_changed', {
      deviceId: payload.deviceId,
      lifecycleState: payload.lifecycleState,
      executionState: payload.executionState
    })

    return {
      notes: [`device state changed: ${payload.deviceId}`]
    }
  }

function requireTelemetrySamplePayload(event: SimulationEvent): TelemetrySamplePayload {
  const payload = requireRecord(event.payload, event)
  const deviceId = requireNonEmptyString(payload.deviceId, event, 'DEVICE_ID_REQUIRED', 'deviceId')
  const targetAddress = requireNonEmptyString(
    payload.targetAddress,
    event,
    'TARGET_ADDRESS_REQUIRED',
    'targetAddress'
  )

  return {
    deviceId,
    targetAddress,
    ...(typeof payload.intervalMs === 'number' ? { intervalMs: payload.intervalMs } : {}),
    ...(typeof payload.profile === 'string' ? { profile: payload.profile } : {}),
    ...(typeof payload.repeat === 'boolean' ? { repeat: payload.repeat } : {}),
    ...(typeof payload.sendDelayMs === 'number' ? { sendDelayMs: payload.sendDelayMs } : {}),
    ...(typeof payload.deliveryDelayMs === 'number' ? { deliveryDelayMs: payload.deliveryDelayMs } : {}),
    ...(typeof payload.sequence === 'number' ? { sequence: payload.sequence } : {}),
    ...(typeof payload.measuredAtUnix === 'number' ? { measuredAtUnix: payload.measuredAtUnix } : {})
  }
}

function createEncodedLoRaPacket(input: {
  sourceAddress: string
  targetAddress: string
  encodedPayload: LoRaEncodedPacketPayload
  sourceModule: LoRaModule
  simulationTimeMs: number
}): LoRaPacket {
  const config = input.sourceModule.getConfig()
  const sourceMessage =
    input.encodedPayload.kind === 'lora-symbol-codec-ping'
      ? input.encodedPayload.sourcePing
      : input.encodedPayload.sourceTelemetry

  return {
    packetId: `pkt_lora_${input.encodedPayload.kind === 'lora-symbol-codec-ping' ? 'ping' : 'telemetry'}_${sourceMessage.sequence}_${input.encodedPayload.frameMode}_${input.encodedPayload.kind === 'lora-symbol-codec-ping' ? input.encodedPayload.sourcePing.sentAtUnix : input.encodedPayload.sourceTelemetry.measuredAtUnix}`,
    sourceAddress: input.sourceAddress,
    targetAddress: input.targetAddress,
    payload: input.encodedPayload,
    radio: {
      frequencyHz: config.radio.frequencyHz,
      bandwidthHz: config.radio.bandwidthHz,
      spreadingFactor: config.radio.spreadingFactor,
      codingRate: config.radio.codingRate,
      powerDbm: config.radio.txPowerDbm,
      rangeMeters: config.radio.maxRangeMeters
    },
    meta: {
      timestamp: input.simulationTimeMs,
      requiresAck: false,
      ttl: input.encodedPayload.frameMode === 'mesh' ? 8 : undefined,
      retries: 0
    }
  }
}

function runtimeTelemetryToLoRaTelemetry(
  telemetry: TelemetrySendPayload['telemetry'],
  sourceNumericAddress: number
): TelemetryPayloadV1 {
  let sensorFlags = 0
  const payload: TelemetryPayloadV1 = {
    schemaVersion: 1,
    messageId:
      telemetry.message_id ||
      `sim-${sourceNumericAddress}-${telemetry.sequence}-${Math.floor(telemetry.timestamp / 1000)}`,
    sequence: telemetry.sequence,
    measuredAtUnix: Math.max(0, Math.floor(telemetry.timestamp / 1000)),
    sensorFlags
  }

  const airTemperature = telemetry.sensors.air_temperature
  if (typeof airTemperature === 'number') {
    sensorFlags |= TelemetrySensorFlags.AIR_TEMPERATURE
    payload.airTempCentiC = Math.round(airTemperature * 100)
  }

  const airHumidity = telemetry.sensors.air_humidity
  if (typeof airHumidity === 'number') {
    sensorFlags |= TelemetrySensorFlags.AIR_HUMIDITY
    payload.airHumidityCentiPct = Math.round(airHumidity * 100)
  }

  const soilTemperature = telemetry.sensors.soil_temperature
  if (typeof soilTemperature === 'number') {
    sensorFlags |= TelemetrySensorFlags.SOIL_TEMPERATURE
    payload.soilTempCentiC = Math.round(soilTemperature * 100)
  }

  const soilMoisture = telemetry.sensors.soil_moisture
  if (typeof soilMoisture === 'number') {
    sensorFlags |= TelemetrySensorFlags.SOIL_MOISTURE
    payload.soilMoistureCentiPct = Math.round(soilMoisture * 100)
  }

  const co2ppm = telemetry.sensors.co2
  if (typeof co2ppm === 'number') {
    sensorFlags |= TelemetrySensorFlags.CO2
    payload.co2ppm = Math.round(co2ppm)
  }

  if (typeof telemetry.battery === 'number') {
    sensorFlags |= TelemetrySensorFlags.BATTERY
    payload.batteryPermille = Math.max(0, Math.min(1000, Math.round(telemetry.battery * 10)))
  }

  payload.sensorFlags = sensorFlags
  return payload
}

function requireTelemetrySendPayload(event: SimulationEvent): TelemetrySendPayload {
  const payload = requireRecord(event.payload, event)
  const deviceId = requireNonEmptyString(payload.deviceId, event, 'DEVICE_ID_REQUIRED', 'deviceId')
  const targetAddress = requireNonEmptyString(
    payload.targetAddress,
    event,
    'TARGET_ADDRESS_REQUIRED',
    'targetAddress'
  )

  if (!isRecord(payload.telemetry)) {
    fail('INVALID_EVENT_PAYLOAD', 'telemetry payload is required', { eventId: event.id })
  }

  const telemetry = payload.telemetry as TelemetrySendPayload['telemetry']

  if (
    typeof telemetry.message_id !== 'string' ||
    typeof telemetry.device_id !== 'string' ||
    typeof telemetry.timestamp !== 'number'
  ) {
    fail('INVALID_EVENT_PAYLOAD', 'telemetry payload is invalid', {
      eventId: event.id,
      telemetry
    })
  }

  return {
    deviceId,
    targetAddress,
    telemetry,
    ...(typeof payload.deliveryDelayMs === 'number' ? { deliveryDelayMs: payload.deliveryDelayMs } : {})
  }
}

function requireLoRaCodecSendPayload(event: SimulationEvent): LoRaCodecSendPayload {
  const payload = requireRecord(event.payload, event)
  const deviceId = requireNonEmptyString(payload.deviceId, event, 'DEVICE_ID_REQUIRED', 'deviceId')
  const targetAddress = requireNonEmptyString(
    payload.targetAddress,
    event,
    'TARGET_ADDRESS_REQUIRED',
    'targetAddress'
  )
  const mode = typeof payload.mode === 'string' ? payload.mode : 'both'

  if (mode !== 'direct' && mode !== 'mesh' && mode !== 'both') {
    fail('INVALID_EVENT_PAYLOAD', 'mode must be direct, mesh, or both', {
      eventId: event.id,
      mode
    })
  }

  if (!isRecord(payload.telemetry)) {
    fail('INVALID_EVENT_PAYLOAD', 'telemetry payload is required', { eventId: event.id })
  }

  const telemetry = payload.telemetry as LoRaCodecSendPayload['telemetry']

  if (
    telemetry.schemaVersion !== 1 ||
    typeof telemetry.messageId !== 'string' ||
    typeof telemetry.sequence !== 'number' ||
    typeof telemetry.measuredAtUnix !== 'number'
  ) {
    fail('INVALID_EVENT_PAYLOAD', 'LoRa codec telemetry payload is invalid', {
      eventId: event.id,
      telemetry
    })
  }

  return {
    deviceId,
    targetAddress,
    telemetry,
    mode,
    ...(typeof payload.deliveryDelayMs === 'number' ? { deliveryDelayMs: payload.deliveryDelayMs } : {})
  }
}

function requireLoRaPingSendPayload(event: SimulationEvent): LoRaPingSendPayload {
  const payload = requireRecord(event.payload, event)
  const deviceId = requireNonEmptyString(payload.deviceId, event, 'DEVICE_ID_REQUIRED', 'deviceId')
  const targetAddress = requireNonEmptyString(
    payload.targetAddress,
    event,
    'TARGET_ADDRESS_REQUIRED',
    'targetAddress'
  )

  if (!isRecord(payload.ping)) {
    fail('INVALID_EVENT_PAYLOAD', 'PING payload is required', { eventId: event.id })
  }

  const ping = payload.ping as LoRaPingSendPayload['ping']

  if (
    ping.schemaVersion !== 1 ||
    typeof ping.messageId !== 'string' ||
    typeof ping.sequence !== 'number' ||
    typeof ping.sentAtUnix !== 'number'
  ) {
    fail('INVALID_EVENT_PAYLOAD', 'PING payload is invalid', {
      eventId: event.id,
      ping
    })
  }

  const mode = typeof payload.mode === 'string' ? payload.mode : undefined

  if (mode !== undefined && mode !== 'direct' && mode !== 'mesh') {
    fail('INVALID_EVENT_PAYLOAD', 'PING mode must be direct or mesh', {
      eventId: event.id,
      mode
    })
  }

  return {
    deviceId,
    targetAddress,
    ping,
    ...(mode ? { mode } : {}),
    ...(typeof payload.deliveryDelayMs === 'number' ? { deliveryDelayMs: payload.deliveryDelayMs } : {})
  }
}

function requirePacketDeliveryPayload(event: SimulationEvent): PacketDeliveryPayload {
  const payload = requireRecord(event.payload, event)
  const targetAddress = requireNonEmptyString(
    payload.targetAddress,
    event,
    'TARGET_ADDRESS_REQUIRED',
    'targetAddress'
  )

  if (!isRecord(payload.packet) || typeof payload.packet.packetId !== 'string') {
    fail('INVALID_EVENT_PAYLOAD', 'packet payload is required', { eventId: event.id })
  }

  return {
    packet: payload.packet as LoRaPacket,
    targetAddress,
    ...(typeof payload.targetDeviceId === 'string' ? { targetDeviceId: payload.targetDeviceId } : {}),
    ...(typeof payload.sourceDeviceId === 'string' ? { sourceDeviceId: payload.sourceDeviceId } : {}),
    ...(typeof payload.sentAtSimulationMs === 'number'
      ? { sentAtSimulationMs: payload.sentAtSimulationMs }
      : {}),
    ...(isRecord(payload.link) ? { link: payload.link as PacketDeliveryPayload['link'] } : {})
  }
}

function requirePacketLostPayload(event: SimulationEvent): WirelessPacketLostPayload {
  const payload = requireRecord(event.payload, event)

  if (!isRecord(payload.radioPacket) || typeof payload.radioPacket.id !== 'string') {
    fail('INVALID_EVENT_PAYLOAD', 'radioPacket payload is required', { eventId: event.id })
  }

  if (!isRecord(payload.link)) {
    fail('INVALID_EVENT_PAYLOAD', 'link snapshot is required', { eventId: event.id })
  }

  const sourceDeviceId = requireNonEmptyString(
    payload.sourceDeviceId,
    event,
    'DEVICE_ID_REQUIRED',
    'sourceDeviceId'
  )
  const reason = requireNonEmptyString(
    payload.reason,
    event,
    'INVALID_EVENT_PAYLOAD',
    'reason'
  ) as WirelessPacketLostPayload['reason']

  return {
    radioPacket: payload.radioPacket as WirelessPacketLostPayload['radioPacket'],
    ...(isRecord(payload.packet) ? { packet: payload.packet as LoRaPacket } : {}),
    sourceDeviceId,
    ...(typeof payload.targetDeviceId === 'string' ? { targetDeviceId: payload.targetDeviceId } : {}),
    ...(typeof payload.targetAddress === 'string' ? { targetAddress: payload.targetAddress } : {}),
    reason,
    link: payload.link as WirelessPacketLostPayload['link'],
    lostAtSimulationMs:
      typeof payload.lostAtSimulationMs === 'number'
        ? payload.lostAtSimulationMs
        : event.scheduledAt
  }
}

function requireGatewayPacketReceivedPayload(event: SimulationEvent): GatewayPacketReceivedPayload {
  const payload = requireRecord(event.payload, event)
  const gatewayDeviceId = requireNonEmptyString(
    payload.gatewayDeviceId,
    event,
    'GATEWAY_DEVICE_ID_REQUIRED',
    'gatewayDeviceId'
  )

  if (!isRecord(payload.packet)) {
    fail('PACKET_REQUIRED', 'packet is required', { eventId: event.id })
  }

  const packet = payload.packet as LoRaPacket

  if (typeof packet.packetId !== 'string') {
    fail('INVALID_EVENT_PAYLOAD', 'packet payload is invalid', { eventId: event.id })
  }

  return {
    gatewayDeviceId,
    packet,
    receivedAtSimulationMs:
      typeof payload.receivedAtSimulationMs === 'number'
        ? payload.receivedAtSimulationMs
        : event.scheduledAt,
    ...(typeof payload.sourceDeviceId === 'string' ? { sourceDeviceId: payload.sourceDeviceId } : {}),
    ...(typeof payload.targetAddress === 'string' ? { targetAddress: payload.targetAddress } : {})
  }
}

function requireDeviceStateChangePayload(event: SimulationEvent): {
  deviceId: string
  lifecycleState?: DeviceLifecycleState
  executionState?: DeviceExecutionState
  reason?: string
} {
  const payload = requireRecord(event.payload, event)
  const deviceId = requireNonEmptyString(payload.deviceId, event, 'DEVICE_ID_REQUIRED', 'deviceId')
  const lifecycleState =
    payload.lifecycleState === undefined
      ? undefined
      : requireEnumValue(payload.lifecycleState, DeviceLifecycleState, event, 'lifecycleState')
  const executionState =
    payload.executionState === undefined
      ? undefined
      : requireEnumValue(payload.executionState, DeviceExecutionState, event, 'executionState')

  if (!lifecycleState && !executionState) {
    fail('INVALID_EVENT_PAYLOAD', 'lifecycleState or executionState is required', {
      eventId: event.id
    })
  }

  return {
    deviceId,
    ...(lifecycleState ? { lifecycleState } : {}),
    ...(executionState ? { executionState } : {}),
    ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {})
  }
}

function requireEnumValue<TEnum extends Record<string, string>>(
  value: unknown,
  enumObject: TEnum,
  event: SimulationEvent,
  field: string
): TEnum[keyof TEnum] {
  if (typeof value !== 'string' || !Object.values(enumObject).includes(value)) {
    fail('INVALID_EVENT_PAYLOAD', `${field} is invalid`, {
      eventId: event.id,
      field,
      value
    })
  }

  return value as TEnum[keyof TEnum]
}

function requireRecord(payload: unknown, event: SimulationEvent): Record<string, unknown> {
  if (!isRecord(payload)) {
    fail('INVALID_EVENT_PAYLOAD', 'Event payload must be an object', { eventId: event.id })
  }

  return payload
}

function requireNonEmptyString(
  value: unknown,
  event: SimulationEvent,
  code: EventDispatchErrorCode,
  field: string
): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(code, `${field} is required`, { eventId: event.id, field })
  }

  return value
}

function toWirelessMedium(value: unknown): WirelessMediumPort | undefined {
  if (!isRecord(value) || typeof value.transmit !== 'function') {
    return undefined
  }

  return value as WirelessMediumPort
}

function toMetricsCollector(value: unknown): RuntimeMetricsCollectorPort | undefined {
  return isRecord(value) ? (value as RuntimeMetricsCollectorPort) : undefined
}

function getScheduledEventIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.scheduledEventIds)) {
    return []
  }

  return value.scheduledEventIds.filter((eventId): eventId is string => typeof eventId === 'string')
}

function fail(code: EventDispatchErrorCode, message: string, details?: unknown): never {
  throw new EventDispatchError(code, 'recoverable', message, details)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
