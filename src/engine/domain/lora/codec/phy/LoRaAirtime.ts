import { codingRateToId, type LoRaPhyConfig } from './LoRaPhyConfig'

export class LoRaAirtime {
  calculate(input: {
    phy: LoRaPhyConfig
    payloadLengthBytes: number
  }): {
    symbolTimeMs: number
    preambleTimeMs: number
    payloadTimeMs: number
    timeOnAirMs: number
    payloadSymbols: number
    totalSymbols: number
  } {
    const { phy, payloadLengthBytes } = input
    const symbolTimeMs = (2 ** phy.spreadingFactor / phy.bandwidthHz) * 1000
    const de = phy.lowDataRateOptimize ? 1 : 0
    const ih = phy.explicitHeader ? 0 : 1
    const crc = phy.payloadCrcEnabled ? 1 : 0
    const cr = codingRateToId(phy.codingRate)
    const numerator =
      8 * payloadLengthBytes -
      4 * phy.spreadingFactor +
      28 +
      16 * crc -
      20 * ih
    const denominator = 4 * (phy.spreadingFactor - 2 * de)
    const payloadSymbols =
      8 + Math.max(Math.ceil(numerator / denominator) * (cr + 4), 0)
    const preambleTimeMs = (phy.preambleLength + 4.25) * symbolTimeMs
    const payloadTimeMs = payloadSymbols * symbolTimeMs

    return {
      symbolTimeMs,
      preambleTimeMs,
      payloadTimeMs,
      timeOnAirMs: preambleTimeMs + payloadTimeMs,
      payloadSymbols,
      totalSymbols: phy.preambleLength + 3 + payloadSymbols,
    }
  }
}
