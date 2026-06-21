import { getCodingRateCodewordLength, type LoRaCodingRate } from './LoRaPhyConfig'

export class LoRaInterleaver {
  static interleave(
    bits: readonly number[],
    spreadingFactor: number,
    codingRate: LoRaCodingRate,
  ): number[] {
    const codewordLength = getCodingRateCodewordLength(codingRate)
    const blockSize = spreadingFactor * codewordLength
    const paddedBits = [...bits]

    while (paddedBits.length % blockSize !== 0) {
      paddedBits.push(0)
    }

    const output: number[] = []

    for (let offset = 0; offset < paddedBits.length; offset += blockSize) {
      const block = paddedBits.slice(offset, offset + blockSize)
      for (let col = 0; col < spreadingFactor; col += 1) {
        for (let row = 0; row < codewordLength; row += 1) {
          output.push(block[row * spreadingFactor + col])
        }
      }
    }

    return output
  }

  static deinterleave(
    bits: readonly number[],
    spreadingFactor: number,
    codingRate: LoRaCodingRate,
  ): number[] {
    const codewordLength = getCodingRateCodewordLength(codingRate)
    const blockSize = spreadingFactor * codewordLength
    const output: number[] = []

    for (let offset = 0; offset + blockSize <= bits.length; offset += blockSize) {
      const matrix = Array.from({ length: codewordLength }, () =>
        Array.from({ length: spreadingFactor }, () => 0),
      )
      let index = offset

      for (let col = 0; col < spreadingFactor; col += 1) {
        for (let row = 0; row < codewordLength; row += 1) {
          matrix[row][col] = bits[index] ?? 0
          index += 1
        }
      }

      for (let row = 0; row < codewordLength; row += 1) {
        for (let col = 0; col < spreadingFactor; col += 1) {
          output.push(matrix[row][col])
        }
      }
    }

    return output
  }
}
