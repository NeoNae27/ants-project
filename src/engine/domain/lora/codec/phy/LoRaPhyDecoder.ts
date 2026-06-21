import { bitsToBytes } from '../bytes'
import type { FrameMode } from '../frame'
import { Crc16 } from '../bytes/Crc16'
import { symbolsToBits } from './LoRaGray'
import { LoRaFec } from './LoRaFec'
import { LoRaInterleaver } from './LoRaInterleaver'
import { LoRaPhyCodecError } from './LoRaPhyCodecError'
import {
  codingRateIdToValue,
  codingRateToId,
  type LoRaPhyConfig,
} from './LoRaPhyConfig'
import type { LoRaPhysicalSymbol } from './LoRaSymbolFrame'
import { LoRaWhitening } from './LoRaWhitening'

export type LoRaPhyDecodeInput = {
  symbols: readonly LoRaPhysicalSymbol[]
  config: LoRaPhyConfig
  mode: 'explicit' | 'implicit'
  frameMode: FrameMode
}

export type LoRaPhyDecodeDiagnostics = {
  receivedSymbols: number
  dataSymbols: number
  correctedErrors: number
  uncorrectableErrors: number
  decodedBytes: number
}

export type LoRaPhyDecodeResult =
  | {
      ok: true
      frameMode: FrameMode
      payloadBytes: Uint8Array
      diagnostics: LoRaPhyDecodeDiagnostics
    }
  | {
      ok: false
      reason:
        | 'PREAMBLE_NOT_FOUND'
        | 'SYNC_WORD_MISMATCH'
        | 'HEADER_CRC_FAILED'
        | 'PAYLOAD_CRC_FAILED'
        | 'FEC_UNCORRECTABLE'
        | 'INVALID_PAYLOAD_LENGTH'
      diagnostics: LoRaPhyDecodeDiagnostics
    }

export class LoRaPhyDecoder {
  decode(input: LoRaPhyDecodeInput): LoRaPhyDecodeResult {
    const baseDiagnostics: LoRaPhyDecodeDiagnostics = {
      receivedSymbols: input.symbols.length,
      dataSymbols: 0,
      correctedErrors: 0,
      uncorrectableErrors: 0,
      decodedBytes: 0,
    }

    try {
      this.verifyPreamble(input)
      this.verifySync(input)

      const dataSymbols = this.extractDataSymbols(input)
      const demappedBits = symbolsToBits(dataSymbols, input.config.spreadingFactor)
      const deinterleavedBits = LoRaInterleaver.deinterleave(
        demappedBits,
        input.config.spreadingFactor,
        input.config.codingRate,
      )
      const fecDecoded = LoRaFec.decode(deinterleavedBits, input.config.codingRate)
      const diagnostics = {
        ...baseDiagnostics,
        dataSymbols: dataSymbols.length,
        correctedErrors: fecDecoded.correctedErrors,
        uncorrectableErrors: fecDecoded.uncorrectableErrors,
      }

      if (fecDecoded.uncorrectableErrors > 0) {
        return {
          ok: false,
          reason: 'FEC_UNCORRECTABLE',
          diagnostics,
        }
      }

      const dewhitenedBits = LoRaWhitening.dewhiten(fecDecoded.bits)
      const decodedBytes = bitsToBytes(dewhitenedBits)

      if (input.mode === 'implicit') {
        throw new LoRaPhyCodecError(
          'Implicit mode cannot recover exact payload length from symbols in this simulator codec',
          'PHY_IMPLICIT_LENGTH_UNSUPPORTED',
        )
      }

      const payloadBytes = this.decodeExplicitPayload(decodedBytes, input.config)

      return {
        ok: true,
        frameMode: input.frameMode,
        payloadBytes,
        diagnostics: {
          ...diagnostics,
          decodedBytes: payloadBytes.length,
        },
      }
    } catch (error) {
      return {
        ok: false,
        reason: this.mapErrorToReason(error),
        diagnostics: baseDiagnostics,
      }
    }
  }

  private verifyPreamble(input: LoRaPhyDecodeInput): void {
    if (input.symbols.length < input.config.preambleLength + 3) {
      throw new LoRaPhyCodecError('LoRa preamble is missing', 'PHY_PREAMBLE_NOT_FOUND')
    }

    for (let index = 0; index < input.config.preambleLength; index += 1) {
      if (input.symbols[index]?.kind !== 'preamble_upchirp') {
        throw new LoRaPhyCodecError('LoRa preamble is missing', 'PHY_PREAMBLE_NOT_FOUND')
      }
    }
  }

  private verifySync(input: LoRaPhyDecodeInput): void {
    const sync = input.symbols[input.config.preambleLength]

    if (sync?.kind !== 'sync_word' || sync.value !== input.config.syncWord) {
      throw new LoRaPhyCodecError('LoRa sync word mismatch', 'PHY_SYNC_WORD_MISMATCH')
    }

    const firstDownchirp = input.symbols[input.config.preambleLength + 1]
    const secondDownchirp = input.symbols[input.config.preambleLength + 2]

    if (firstDownchirp?.kind !== 'downchirp' || secondDownchirp?.kind !== 'downchirp') {
      throw new LoRaPhyCodecError('LoRa sync word mismatch', 'PHY_SYNC_WORD_MISMATCH')
    }
  }

  private extractDataSymbols(input: LoRaPhyDecodeInput): number[] {
    return input.symbols
      .slice(input.config.preambleLength + 3)
      .map((symbol) => {
        if (symbol.kind !== 'data') {
          throw new LoRaPhyCodecError('LoRa sync word mismatch', 'PHY_SYNC_WORD_MISMATCH')
        }

        return symbol.value
      })
  }

  private decodeExplicitPayload(decodedBytes: Uint8Array, config: LoRaPhyConfig): Uint8Array {
    if (decodedBytes.length < 5) {
      throw new LoRaPhyCodecError(
        'Decoded PHY payload is too short for explicit header',
        'PHY_INVALID_PAYLOAD_LENGTH',
      )
    }

    const headerWithoutCrc = decodedBytes.slice(0, 3)
    const expectedHeaderCrc = Crc16.ccittFalse(headerWithoutCrc)
    const actualHeaderCrc = decodedBytes[3] | (decodedBytes[4] << 8)

    if (expectedHeaderCrc !== actualHeaderCrc) {
      throw new LoRaPhyCodecError('Explicit PHY header CRC failed', 'PHY_HEADER_CRC_FAILED')
    }

    const payloadLength = decodedBytes[0]
    const codingRate = codingRateIdToValue(decodedBytes[1])
    const crcEnabled = decodedBytes[2] === 1

    if (
      !codingRate ||
      codingRateToId(codingRate) !== codingRateToId(config.codingRate) ||
      crcEnabled !== config.payloadCrcEnabled
    ) {
      throw new LoRaPhyCodecError(
        'Explicit PHY header metadata does not match decoder config',
        'PHY_INVALID_PAYLOAD_LENGTH',
      )
    }

    const phyPayloadLength = 5 + payloadLength
    const totalPayloadLength = phyPayloadLength + (crcEnabled ? 2 : 0)

    if (decodedBytes.length < totalPayloadLength) {
      throw new LoRaPhyCodecError(
        'Decoded PHY payload length is invalid',
        'PHY_INVALID_PAYLOAD_LENGTH',
      )
    }

    const phyPayloadBytes = decodedBytes.slice(0, phyPayloadLength)

    if (crcEnabled) {
      const expectedPayloadCrc = Crc16.ccittFalse(phyPayloadBytes)
      const actualPayloadCrc =
        decodedBytes[phyPayloadLength] | (decodedBytes[phyPayloadLength + 1] << 8)

      if (expectedPayloadCrc !== actualPayloadCrc) {
        throw new LoRaPhyCodecError('PHY payload CRC failed', 'PHY_PAYLOAD_CRC_FAILED')
      }
    }

    return decodedBytes.slice(5, phyPayloadLength)
  }

  private mapErrorToReason(error: unknown): LoRaPhyDecodeResult extends infer Result
    ? Result extends { ok: false; reason: infer Reason }
      ? Reason
      : never
    : never {
    if (error instanceof LoRaPhyCodecError) {
      switch (error.code) {
        case 'PHY_PREAMBLE_NOT_FOUND':
          return 'PREAMBLE_NOT_FOUND'
        case 'PHY_SYNC_WORD_MISMATCH':
          return 'SYNC_WORD_MISMATCH'
        case 'PHY_HEADER_CRC_FAILED':
          return 'HEADER_CRC_FAILED'
        case 'PHY_PAYLOAD_CRC_FAILED':
          return 'PAYLOAD_CRC_FAILED'
        case 'PHY_FEC_UNCORRECTABLE':
          return 'FEC_UNCORRECTABLE'
        case 'PHY_INVALID_PAYLOAD_LENGTH':
        case 'PHY_IMPLICIT_LENGTH_UNSUPPORTED':
        case 'PHY_PAYLOAD_TOO_LARGE':
          return 'INVALID_PAYLOAD_LENGTH'
        default:
          return 'INVALID_PAYLOAD_LENGTH'
      }
    }

    return 'INVALID_PAYLOAD_LENGTH'
  }
}
