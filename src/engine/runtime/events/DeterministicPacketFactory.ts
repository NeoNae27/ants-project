import type { LoRaModule, LoRaPacket } from '../../domain/modules/network/lora'
import type { RuntimeTelemetryPayload } from './RuntimeEventPayloads'

export type DeterministicPacketInput = {
  sourceAddress: string
  targetAddress: string
  telemetry: RuntimeTelemetryPayload
  sourceModule: LoRaModule
  simulationTimeMs: number
}

export function createDeterministicLoRaPacket(input: DeterministicPacketInput): LoRaPacket {
  const config = input.sourceModule.getConfig()

  return {
    packetId: `pkt_${input.telemetry.message_id}`,
    sourceAddress: input.sourceAddress,
    targetAddress: input.targetAddress,
    payload: input.telemetry,
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
      retries: 0
    }
  }
}
