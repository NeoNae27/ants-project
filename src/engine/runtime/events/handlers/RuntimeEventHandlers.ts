import { DeviceExecutionState } from '../../../domain/device/DeviceExecutionState'
import { DeviceLifecycleState } from '../../../domain/device/DeviceLifecycleState'
import type { LoRaPacket } from '../../../domain/modules/network/lora'
import { EventDispatchError, type EventDispatchErrorCode } from '../EventDispatcherErrors'
import type { DispatchContext, EventHandler } from '../EventDispatcherTypes'
import { EventPriority, type SimulationEvent } from '../EventQueueTypes'
import { createDeterministicLoRaPacket } from '../DeterministicPacketFactory'
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
  PacketDeliveryPayload,
  TelemetrySamplePayload,
  TelemetrySendPayload
} from '../RuntimeEventPayloads'
import { RuntimeEventType } from '../RuntimeEventTypes'

const DEFAULT_SEND_DELAY_MS = 1
const DEFAULT_DELIVERY_DELAY_MS = 100

type WirelessMediumPort = {
  transmit(packet: LoRaPacket, context: DispatchContext): unknown
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

    const telemetry = createDeterministicTelemetry({
      deviceId: payload.deviceId,
      simulationTimeMs: context.simulationTimeMs,
      sequence: payload.sequence
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

      const scheduledNext = context.eventQueue.schedule<TelemetrySamplePayload>({
        id: `${event.id}:next:${nextScheduledAt}`,
        type: RuntimeEventType.TELEMETRY_SAMPLE,
        scheduledAt: nextScheduledAt,
        createdAt: context.simulationTimeMs,
        priority: EventPriority.TELEMETRY,
        source: event.source ? { ...event.source } : { type: 'device', id: payload.deviceId },
        target: event.target ? { ...event.target } : { deviceId: payload.deviceId },
        payload: { ...payload },
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

    const packet = createDeterministicLoRaPacket({
      sourceAddress,
      targetAddress: payload.targetAddress,
      telemetry: payload.telemetry,
      sourceModule,
      simulationTimeMs: context.simulationTimeMs
    })
    const wirelessMedium = toWirelessMedium(context.wirelessMedium)

    if (wirelessMedium) {
      wirelessMedium.transmit(packet, context)
      toMetricsCollector(context.metricsCollector)?.recordPacketSent?.({
        packet,
        simulationTimeMs: context.simulationTimeMs
      })
      context.logger?.debug?.('packet_transmit_requested', { packetId: packet.packetId })

      return {
        notes: [`packet transmit requested: ${packet.packetId}`]
      }
    }

    const deliveryDelayMs = payload.deliveryDelayMs ?? DEFAULT_DELIVERY_DELAY_MS

    if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
      fail('INVALID_EVENT_PAYLOAD', 'deliveryDelayMs must be greater than zero', {
        eventId: event.id,
        deliveryDelayMs
      })
    }

    const targetDevice = findRuntimeDeviceByAddress(context, payload.targetAddress)
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

    toMetricsCollector(context.metricsCollector)?.recordPacketSent?.({
      packet,
      simulationTimeMs: context.simulationTimeMs
    })
    context.logger?.debug?.('packet_delivery_scheduled', { packetId: packet.packetId })

    return {
      scheduledEventIds: [scheduledDelivery.id],
      notes: [`packet delivery scheduled: ${packet.packetId}`]
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
    ...(typeof payload.sequence === 'number' ? { sequence: payload.sequence } : {})
  }
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
    ...(typeof payload.sentAtSimulationMs === 'number'
      ? { sentAtSimulationMs: payload.sentAtSimulationMs }
      : {})
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

function fail(code: EventDispatchErrorCode, message: string, details?: unknown): never {
  throw new EventDispatchError(code, 'recoverable', message, details)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
