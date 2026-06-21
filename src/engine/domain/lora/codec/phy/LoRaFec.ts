import { getCodingRateCodewordLength, type LoRaCodingRate } from './LoRaPhyConfig'

export type LoRaFecDecodeResult = {
  bits: number[]
  correctedErrors: number
  uncorrectableErrors: number
}

export class LoRaFec {
  static encode(bits: readonly number[], codingRate: LoRaCodingRate): number[] {
    const paddedBits = [...bits]

    while (paddedBits.length % 4 !== 0) {
      paddedBits.push(0)
    }

    const output: number[] = []

    for (let offset = 0; offset < paddedBits.length; offset += 4) {
      output.push(...this.encodeNibble(paddedBits.slice(offset, offset + 4), codingRate))
    }

    return output
  }

  static decode(bits: readonly number[], codingRate: LoRaCodingRate): LoRaFecDecodeResult {
    const codewordLength = getCodingRateCodewordLength(codingRate)
    let correctedErrors = 0
    let uncorrectableErrors = 0
    const output: number[] = []

    for (let offset = 0; offset + codewordLength <= bits.length; offset += codewordLength) {
      const decoded = this.decodeCodeword(bits.slice(offset, offset + codewordLength), codingRate)
      correctedErrors += decoded.correctedErrors
      uncorrectableErrors += decoded.uncorrectableErrors
      output.push(...decoded.bits)
    }

    return {
      bits: output,
      correctedErrors,
      uncorrectableErrors,
    }
  }

  private static encodeNibble(nibble: number[], codingRate: LoRaCodingRate): number[] {
    const [d0, d1, d2, d3] = nibble

    switch (codingRate) {
      case '4/5':
        return [d0, d1, d2, d3, d0 ^ d1 ^ d2 ^ d3]
      case '4/6':
        return [d0, d1, d2, d3, d0 ^ d1 ^ d2 ^ d3, d0 ^ d2]
      case '4/7': {
        const p1 = d0 ^ d1 ^ d3
        const p2 = d0 ^ d2 ^ d3
        const p4 = d1 ^ d2 ^ d3
        return [p1, p2, d0, p4, d1, d2, d3]
      }
      case '4/8': {
        const hamming = this.encodeNibble(nibble, '4/7')
        const parity = hamming.reduce((acc, bit) => acc ^ bit, 0)
        return [...hamming, parity]
      }
      default:
        return [d0, d1, d2, d3]
    }
  }

  private static decodeCodeword(
    codeword: readonly number[],
    codingRate: LoRaCodingRate,
  ): LoRaFecDecodeResult {
    switch (codingRate) {
      case '4/5':
        return this.decodeParityCodeword(codeword, 1)
      case '4/6':
        return this.decodeParityCodeword(codeword, 2)
      case '4/7':
        return this.decodeHamming74(codeword)
      case '4/8':
        return this.decodeExtendedHamming84(codeword)
      default:
        return { bits: codeword.slice(0, 4), correctedErrors: 0, uncorrectableErrors: 0 }
    }
  }

  private static decodeParityCodeword(
    codeword: readonly number[],
    parityBits: 1 | 2,
  ): LoRaFecDecodeResult {
    const data = codeword.slice(0, 4)
    const parity0 = data.reduce((acc, bit) => acc ^ bit, 0)
    const parity1 = data[0] ^ data[2]
    const mismatch =
      parity0 !== codeword[4] || (parityBits === 2 && parity1 !== codeword[5])

    return {
      bits: data,
      correctedErrors: 0,
      uncorrectableErrors: mismatch ? 1 : 0,
    }
  }

  private static decodeHamming74(codeword: readonly number[]): LoRaFecDecodeResult {
    const corrected = [...codeword]
    const syndrome = this.hammingSyndrome(corrected)
    let correctedErrors = 0

    if (syndrome >= 1 && syndrome <= 7) {
      corrected[syndrome - 1] ^= 1
      correctedErrors = 1
    }

    return {
      bits: [corrected[2], corrected[4], corrected[5], corrected[6]],
      correctedErrors,
      uncorrectableErrors: 0,
    }
  }

  private static decodeExtendedHamming84(codeword: readonly number[]): LoRaFecDecodeResult {
    const corrected = [...codeword]
    const syndrome = this.hammingSyndrome(corrected)
    const parity = corrected.reduce((acc, bit) => acc ^ bit, 0)
    let correctedErrors = 0
    let uncorrectableErrors = 0

    if (syndrome !== 0 && parity === 1) {
      corrected[syndrome - 1] ^= 1
      correctedErrors = 1
    } else if (syndrome === 0 && parity === 1) {
      corrected[7] ^= 1
      correctedErrors = 1
    } else if (syndrome !== 0 && parity === 0) {
      uncorrectableErrors = 1
    }

    return {
      bits: [corrected[2], corrected[4], corrected[5], corrected[6]],
      correctedErrors,
      uncorrectableErrors,
    }
  }

  private static hammingSyndrome(codeword: readonly number[]): number {
    const bit = (position: number) => codeword[position - 1] ?? 0
    const s1 = bit(1) ^ bit(3) ^ bit(5) ^ bit(7)
    const s2 = bit(2) ^ bit(3) ^ bit(6) ^ bit(7)
    const s4 = bit(4) ^ bit(5) ^ bit(6) ^ bit(7)
    return s1 | (s2 << 1) | (s4 << 2)
  }
}
