import type { DeviceExecutionState } from '../../domain/device/DeviceExecutionState'
import type { DeviceLifecycleState } from '../../domain/device/DeviceLifecycleState'
import type { LoRaPacket } from '../../domain/modules/network/lora'
import type { RadioLinkSnapshot, RadioPacket, TransmissionDropReason } from '../radio'

export type RuntimeTelemetryPayload = {
  schema_version: '1.0'
  message_id: string
  sequence: number
  source: 'simulator'
  device_id: string
  timestamp: number
  battery: number
  sensors: Record<string, number>
  link: {
    hops: number
  }
}

export type TelemetrySamplePayload = {
  deviceId: string
  targetAddress: string
  intervalMs?: number
  profile?: string
  repeat?: boolean
  sendDelayMs?: number
  deliveryDelayMs?: number
  sequence?: number
}

export type TelemetrySendPayload = {
  deviceId: string
  targetAddress: string
  telemetry: RuntimeTelemetryPayload
  deliveryDelayMs?: number
}

export type PacketDeliveryPayload = {
  packet: LoRaPacket
  targetAddress: string
  targetDeviceId?: string
  sourceDeviceId?: string
  sentAtSimulationMs?: number
  link?: RadioLinkSnapshot
}

export type WirelessPacketLostPayload = {
  radioPacket: RadioPacket
  packet?: LoRaPacket
  sourceDeviceId: string
  targetDeviceId?: string
  targetAddress?: string
  reason: TransmissionDropReason
  link: RadioLinkSnapshot
  lostAtSimulationMs: number
}

export type GatewayPacketReceivedPayload = {
  gatewayDeviceId: string
  packet: LoRaPacket
  receivedAtSimulationMs: number
  sourceDeviceId?: string
  targetAddress?: string
}

export type DeviceStateChangePayload = {
  deviceId: string
  lifecycleState?: DeviceLifecycleState | string
  executionState?: DeviceExecutionState | string
  reason?: string
}
