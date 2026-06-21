import type {
  ChannelEvaluationInput,
  ChannelEvaluationResult,
  ChannelModel
} from '../ChannelModel'

export type SimpleChannelModelConfig = {
  maxRangeMeters?: number
  baseDelayMs?: number
  jitterMs?: number
  random?: () => number
}

export class SimpleChannelModel implements ChannelModel {
  private readonly maxRangeMeters?: number
  private readonly baseDelayMs: number
  private readonly jitterMs: number
  private readonly random: () => number

  constructor(config: SimpleChannelModelConfig = {}) {
    this.maxRangeMeters = config.maxRangeMeters
    this.baseDelayMs = config.baseDelayMs ?? 100
    this.jitterMs = config.jitterMs ?? 0
    this.random = config.random ?? Math.random
  }

  evaluate(input: ChannelEvaluationInput): ChannelEvaluationResult {
    const maxRangeMeters =
      this.maxRangeMeters ?? input.packet.radio.candidateSearchRadiusMeters
    const delayMs = this.baseDelayMs + this.random() * this.jitterMs
    const canDeliver = input.distanceMeters <= maxRangeMeters
    const reason = canDeliver ? undefined : 'OUT_OF_RANGE'

    return {
      canDeliver,
      delayMs,
      ...(reason ? { reason } : {}),
      link: {
        id: `${input.packet.id}:${input.source.deviceId}->${input.target.deviceId}`,
        sourceDeviceId: input.source.deviceId,
        targetDeviceId: input.target.deviceId,
        protocol: input.packet.protocol,
        status: canDeliver ? 'reachable' : 'lost',
        distanceMeters: input.distanceMeters,
        delayMs,
        ...(reason ? { reason } : {}),
        updatedAt: input.nowMs
      }
    }
  }
}
