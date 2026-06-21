import type { RadioLinkSnapshot, RadioPacket, TransmissionDropReason } from './RadioTypes'

export type ChannelEvaluationInput = {
  packet: RadioPacket
  source: {
    deviceId: string
    x: number
    y: number
  }
  target: {
    deviceId: string
    x: number
    y: number
    radio?: {
      frequencyHz?: number
      bandwidthHz?: number
      spreadingFactor?: number
      rxSensitivityDbm?: number
    }
  }
  distanceMeters: number
  nowMs: number
}

export type ChannelEvaluationResult = {
  canDeliver: boolean
  link: RadioLinkSnapshot
  delayMs: number
  reason?: TransmissionDropReason
}

export interface ChannelModel {
  evaluate(input: ChannelEvaluationInput): ChannelEvaluationResult
}
