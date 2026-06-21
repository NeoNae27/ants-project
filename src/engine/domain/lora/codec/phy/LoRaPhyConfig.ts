export type LoRaCodingRate = '4/5' | '4/6' | '4/7' | '4/8'

export type LoRaPhyConfig = {
  frequencyHz: number
  bandwidthHz: 125000 | 250000 | 500000
  spreadingFactor: 7 | 8 | 9 | 10 | 11 | 12
  codingRate: LoRaCodingRate
  preambleLength: number
  explicitHeader: boolean
  payloadCrcEnabled: boolean
  lowDataRateOptimize: boolean
  syncWord: number
}

export const defaultLoRaPhyConfig: LoRaPhyConfig = {
  frequencyHz: 868_100_000,
  bandwidthHz: 125_000,
  spreadingFactor: 7,
  codingRate: '4/5',
  preambleLength: 8,
  explicitHeader: true,
  payloadCrcEnabled: true,
  lowDataRateOptimize: false,
  syncWord: 0x12,
}

export function shouldUseLowDataRateOptimize(input: {
  spreadingFactor: LoRaPhyConfig['spreadingFactor']
  bandwidthHz: LoRaPhyConfig['bandwidthHz']
}): boolean {
  const symbolTimeMs = (2 ** input.spreadingFactor / input.bandwidthHz) * 1000
  return symbolTimeMs > 16
}

export function codingRateToId(codingRate: LoRaCodingRate): number {
  switch (codingRate) {
    case '4/5':
      return 1
    case '4/6':
      return 2
    case '4/7':
      return 3
    case '4/8':
      return 4
    default:
      return 1
  }
}

export function codingRateIdToValue(id: number): LoRaCodingRate | undefined {
  switch (id) {
    case 1:
      return '4/5'
    case 2:
      return '4/6'
    case 3:
      return '4/7'
    case 4:
      return '4/8'
    default:
      return undefined
  }
}

export function getCodingRateParityBits(codingRate: LoRaCodingRate): 1 | 2 | 3 | 4 {
  return codingRateToId(codingRate) as 1 | 2 | 3 | 4
}

export function getCodingRateCodewordLength(codingRate: LoRaCodingRate): number {
  return 4 + getCodingRateParityBits(codingRate)
}
