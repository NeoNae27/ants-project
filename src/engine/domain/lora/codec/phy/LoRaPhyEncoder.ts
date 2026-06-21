import { BinaryWriter, Crc16, bytesToBits, concatBytes } from '../bytes'
import type { FrameMode } from '../frame'
import { bitsToSymbols } from './LoRaGray'
import { LoRaAirtime } from './LoRaAirtime'
import { LoRaFec } from './LoRaFec'
import { LoRaInterleaver } from './LoRaInterleaver'
import { LoRaPhyCodecError } from './LoRaPhyCodecError'
import { codingRateToId, type LoRaPhyConfig } from './LoRaPhyConfig'
import type { LoRaPhysicalSymbol, LoRaSymbolFrame } from './LoRaSymbolFrame'
import { LoRaWhitening } from './LoRaWhitening'

export type LoRaPhyEncodeInput = {
  phy: LoRaPhyConfig
  frameMode: FrameMode
  payloadBytes: Uint8Array
  sourceAddress?: number
  targetAddress?: number
}

export class LoRaPhyEncoder {
  private readonly airtime = new LoRaAirtime()

  encode(input: LoRaPhyEncodeInput): LoRaSymbolFrame {
    const phyPayloadBytes = input.phy.explicitHeader
      ? concatBytes(this.createExplicitHeader(input.phy, input.payloadBytes.length), input.payloadBytes)
      : input.payloadBytes
    const payloadWithCrcBytes = input.phy.payloadCrcEnabled
      ? concatBytes(phyPayloadBytes, this.createCrcBytes(phyPayloadBytes))
      : phyPayloadBytes
    const whitenedBits = LoRaWhitening.whiten(bytesToBits(payloadWithCrcBytes))
    const fecBits = LoRaFec.encode(whitenedBits, input.phy.codingRate)
    const interleavedBits = LoRaInterleaver.interleave(
      fecBits,
      input.phy.spreadingFactor,
      input.phy.codingRate,
    )
    const graySymbols = bitsToSymbols(interleavedBits, input.phy.spreadingFactor)
    const symbols = this.createPhysicalSymbols(input.phy, graySymbols)
    const timing = this.airtime.calculate({
      phy: input.phy,
      payloadLengthBytes: input.payloadBytes.length,
    })

    return {
      id: `lora-symbol-frame-${crypto.randomUUID()}`,
      config: input.phy,
      mode: input.phy.explicitHeader ? 'explicit' : 'implicit',
      frameMode: input.frameMode,
      rawPayloadBytes: input.payloadBytes,
      encoded: {
        phyPayloadBytes,
        payloadWithCrcBytes,
        whitenedBits,
        fecBits,
        interleavedBits,
        graySymbols,
      },
      symbols,
      timing: {
        ...timing,
        payloadSymbols: graySymbols.length,
        totalSymbols: symbols.length,
      },
      diagnostics: {
        rawPayloadSizeBytes: input.payloadBytes.length,
        phyPayloadSizeBytes: phyPayloadBytes.length,
        payloadWithCrcSizeBytes: payloadWithCrcBytes.length,
        whitenedBitsCount: whitenedBits.length,
        fecBitsCount: fecBits.length,
        interleavedBitsCount: interleavedBits.length,
        dataSymbolsCount: graySymbols.length,
      },
      meta: {
        sourceAddress: input.sourceAddress,
        targetAddress: input.targetAddress,
        createdAt: Date.now(),
      },
    }
  }

  private createExplicitHeader(phy: LoRaPhyConfig, payloadLength: number): Uint8Array {
    if (payloadLength > 255) {
      throw new LoRaPhyCodecError('PHY explicit header supports payloads up to 255 bytes', 'PHY_PAYLOAD_TOO_LARGE')
    }

    const writer = new BinaryWriter()
    writer.writeU8(payloadLength)
    writer.writeU8(codingRateToId(phy.codingRate))
    writer.writeU8(phy.payloadCrcEnabled ? 1 : 0)
    const headerWithoutCrc = writer.toUint8Array()
    const crcWriter = new BinaryWriter()
    crcWriter.writeU16LE(Crc16.ccittFalse(headerWithoutCrc))

    return concatBytes(headerWithoutCrc, crcWriter.toUint8Array())
  }

  private createCrcBytes(bytes: Uint8Array): Uint8Array {
    const writer = new BinaryWriter()
    writer.writeU16LE(Crc16.ccittFalse(bytes))
    return writer.toUint8Array()
  }

  private createPhysicalSymbols(
    phy: LoRaPhyConfig,
    dataSymbols: readonly number[],
  ): LoRaPhysicalSymbol[] {
    const preamble = Array.from({ length: phy.preambleLength }, () => ({
      kind: 'preamble_upchirp' as const,
    }))
    const data = dataSymbols.map((value) => ({ kind: 'data' as const, value }))

    return [
      ...preamble,
      { kind: 'sync_word', value: phy.syncWord },
      { kind: 'downchirp' },
      { kind: 'downchirp' },
      ...data,
    ]
  }
}
