import { calculateLinkBudget } from '../LinkBudget'
import {
  FreeSpacePathLossModel,
  type PathLossModel
} from '../PathLossModel'
import type {
  ChannelEvaluationInput,
  ChannelEvaluationResult,
  ChannelModel
} from '../ChannelModel'
import type { TransmissionDropReason } from '../RadioTypes'

export type LoRaSensitivityResolver = {
  getSensitivityDbm(params: {
    spreadingFactor: number
    bandwidthHz: number
  }): number
}

export type LoRaSensitivityTable = Record<number, Record<number, number>>

export const DEFAULT_LORA_SENSITIVITY_TABLE: LoRaSensitivityTable = {
  125_000: {
    7: -123,
    8: -126,
    9: -129,
    10: -132,
    11: -134.5,
    12: -137
  },
  250_000: {
    7: -120,
    8: -123,
    9: -126,
    10: -129,
    11: -131.5,
    12: -134
  },
  500_000: {
    7: -117,
    8: -120,
    9: -123,
    10: -126,
    11: -128.5,
    12: -131
  }
}

export class TableLoRaSensitivityResolver implements LoRaSensitivityResolver {
  constructor(private readonly table: LoRaSensitivityTable = DEFAULT_LORA_SENSITIVITY_TABLE) {}

  getSensitivityDbm(params: { spreadingFactor: number; bandwidthHz: number }): number {
    return (
      this.table[params.bandwidthHz]?.[params.spreadingFactor] ??
      this.table[125_000]?.[params.spreadingFactor] ??
      -123
    )
  }
}

export type LinkBudgetChannelModelConfig = {
  baseDelayMs?: number
  reachableMarginDb?: number
  weakMarginDb?: number
  txAntennaGainDb?: number
  rxAntennaGainDb?: number
  additionalLossDb?: number
  frequencyToleranceHz?: number
  pathLossModel?: PathLossModel
  sensitivityResolver?: LoRaSensitivityResolver
}

export class LinkBudgetChannelModel implements ChannelModel {
  private readonly baseDelayMs: number
  private readonly reachableMarginDb: number
  private readonly weakMarginDb: number
  private readonly txAntennaGainDb: number
  private readonly rxAntennaGainDb: number
  private readonly additionalLossDb: number
  private readonly frequencyToleranceHz: number
  private readonly pathLossModel: PathLossModel
  private readonly sensitivityResolver: LoRaSensitivityResolver

  constructor(config: LinkBudgetChannelModelConfig = {}) {
    this.baseDelayMs = config.baseDelayMs ?? 100
    this.reachableMarginDb = config.reachableMarginDb ?? 10
    this.weakMarginDb = config.weakMarginDb ?? 0
    this.txAntennaGainDb = config.txAntennaGainDb ?? 0
    this.rxAntennaGainDb = config.rxAntennaGainDb ?? 0
    this.additionalLossDb = config.additionalLossDb ?? 0
    this.frequencyToleranceHz = config.frequencyToleranceHz ?? 0
    this.pathLossModel = config.pathLossModel ?? new FreeSpacePathLossModel()
    this.sensitivityResolver =
      config.sensitivityResolver ?? new TableLoRaSensitivityResolver()
  }

  evaluate(input: ChannelEvaluationInput): ChannelEvaluationResult {
    const delayMs = this.baseDelayMs
    const incompatibleReason = this.getCompatibilityReason(input)

    if (incompatibleReason) {
      return {
        canDeliver: false,
        delayMs,
        reason: incompatibleReason,
        link: {
          id: `${input.packet.id}:${input.source.deviceId}->${input.target.deviceId}`,
          sourceDeviceId: input.source.deviceId,
          targetDeviceId: input.target.deviceId,
          protocol: input.packet.protocol,
          status: 'invalid_config',
          distanceMeters: input.distanceMeters,
          delayMs,
          reason: incompatibleReason,
          updatedAt: input.nowMs
        }
      }
    }

    const pathLossDb = this.pathLossModel.calculate({
      distanceMeters: input.distanceMeters,
      frequencyHz: input.packet.radio.frequencyHz
    })
    const rxSensitivityDbm =
      input.target.radio?.rxSensitivityDbm ??
      this.sensitivityResolver.getSensitivityDbm({
        spreadingFactor: input.packet.radio.spreadingFactor,
        bandwidthHz: input.packet.radio.bandwidthHz
      })
    const budget = calculateLinkBudget({
      txPowerDbm: input.packet.radio.txPowerDbm,
      txAntennaGainDb: this.txAntennaGainDb,
      rxAntennaGainDb: this.rxAntennaGainDb,
      pathLossDb,
      additionalLossDb: this.additionalLossDb,
      rxSensitivityDbm
    })
    const status =
      budget.linkMarginDb >= this.reachableMarginDb
        ? 'reachable'
        : budget.linkMarginDb >= this.weakMarginDb
          ? 'weak'
          : 'lost'
    const reason: TransmissionDropReason | undefined =
      status === 'lost' ? 'LINK_BUDGET_TOO_LOW' : undefined

    return {
      canDeliver: status !== 'lost',
      delayMs,
      ...(reason ? { reason } : {}),
      link: {
        id: `${input.packet.id}:${input.source.deviceId}->${input.target.deviceId}`,
        sourceDeviceId: input.source.deviceId,
        targetDeviceId: input.target.deviceId,
        protocol: input.packet.protocol,
        status,
        distanceMeters: input.distanceMeters,
        pathLossDb,
        rxPowerDbm: budget.rxPowerDbm,
        rssiDbm: budget.rxPowerDbm,
        rxSensitivityDbm,
        linkMarginDb: budget.linkMarginDb,
        delayMs,
        ...(reason ? { reason } : {}),
        updatedAt: input.nowMs
      }
    }
  }

  private getCompatibilityReason(input: ChannelEvaluationInput): TransmissionDropReason | undefined {
    const targetRadio = input.target.radio

    if (!targetRadio) {
      return undefined
    }

    if (
      targetRadio.frequencyHz !== undefined &&
      Math.abs(targetRadio.frequencyHz - input.packet.radio.frequencyHz) > this.frequencyToleranceHz
    ) {
      return 'FREQUENCY_MISMATCH'
    }

    if (
      targetRadio.bandwidthHz !== undefined &&
      targetRadio.bandwidthHz !== input.packet.radio.bandwidthHz
    ) {
      return 'BANDWIDTH_MISMATCH'
    }

    if (
      targetRadio.spreadingFactor !== undefined &&
      targetRadio.spreadingFactor !== input.packet.radio.spreadingFactor
    ) {
      return 'SPREADING_FACTOR_MISMATCH'
    }

    return undefined
  }
}
