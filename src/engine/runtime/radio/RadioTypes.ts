import type { LoRaPacket } from '../../domain/modules/network/lora'
import type {
  RadioLinkSnapshot,
  RadioProtocol,
  TransmissionDropReason
} from './RadioLinkSnapshot'

export type { RadioLinkSnapshot, RadioLinkStatus, RadioProtocol, TransmissionDropReason } from './RadioLinkSnapshot'

export type RadioPacket<TOriginalPacket = unknown> = {
  id: string
  protocol: RadioProtocol
  sourceDeviceId?: string
  sourceAddress: string
  targetDeviceId?: string
  targetAddress?: string
  payload: unknown
  radio: {
    frequencyHz: number
    bandwidthHz: number
    spreadingFactor: number
    codingRate?: string
    txPowerDbm: number
    candidateSearchRadiusMeters: number
    preambleLength?: number
    crcEnabled?: boolean
    implicitHeader?: boolean
  }
  meta: {
    timestamp: number
    requiresAck?: boolean
    ttl?: number
    sequence?: number
    retries?: number
    originalPacket?: TOriginalPacket
  }
}

export type LoRaRadioPacket = RadioPacket<LoRaPacket>

export type TransmissionResult = {
  ok: boolean
  packetId: string
  sourceDeviceId: string
  targetDeviceIds: string[]
  scheduledDeliveries: number
  scheduledEventIds: string[]
  links: RadioLinkSnapshot[]
  reason?: TransmissionDropReason
}

export type ToRadioPacketFromLoRaPacketOptions = {
  sourceDeviceId?: string
  targetDeviceId?: string
}

export function toRadioPacketFromLoRaPacket(
  packet: LoRaPacket,
  options: ToRadioPacketFromLoRaPacketOptions = {}
): LoRaRadioPacket {
  return {
    id: packet.packetId,
    protocol: 'lora',
    ...(options.sourceDeviceId ? { sourceDeviceId: options.sourceDeviceId } : {}),
    sourceAddress: packet.sourceAddress,
    ...(options.targetDeviceId ? { targetDeviceId: options.targetDeviceId } : {}),
    targetAddress: packet.targetAddress,
    payload: packet.payload,
    radio: {
      frequencyHz: packet.radio.frequencyHz,
      bandwidthHz: packet.radio.bandwidthHz,
      spreadingFactor: packet.radio.spreadingFactor,
      codingRate: packet.radio.codingRate,
      txPowerDbm: packet.radio.powerDbm,
      candidateSearchRadiusMeters: packet.radio.rangeMeters
    },
    meta: {
      timestamp: packet.meta.timestamp,
      requiresAck: packet.meta.requiresAck,
      ...(packet.meta.ttl !== undefined ? { ttl: packet.meta.ttl } : {}),
      retries: packet.meta.retries,
      originalPacket: packet
    }
  }
}

export function isRadioPacket(value: unknown): value is RadioPacket {
  const candidate = value as Partial<RadioPacket>

  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.id === 'string' &&
    candidate.protocol === 'lora' &&
    typeof candidate.sourceAddress === 'string' &&
    typeof candidate.radio === 'object' &&
    candidate.radio !== null &&
    typeof candidate.radio.txPowerDbm === 'number'
  )
}

export function getOriginalLoRaPacket(packet: RadioPacket): LoRaPacket | undefined {
  const originalPacket = packet.meta.originalPacket as Partial<LoRaPacket> | undefined

  if (!originalPacket || typeof originalPacket.packetId !== 'string') {
    return undefined
  }

  return originalPacket as LoRaPacket
}
