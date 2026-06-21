import type { FrameMode } from '../frame'
import type { LoRaPhyConfig } from './LoRaPhyConfig'

export type LoRaSymbolValue = number

export type LoRaPhysicalSymbol =
  | { kind: 'preamble_upchirp' }
  | { kind: 'sync_word'; value: number }
  | { kind: 'downchirp' }
  | { kind: 'data'; value: LoRaSymbolValue }

export type LoRaSymbolFrame = {
  id: string
  config: LoRaPhyConfig
  mode: 'explicit' | 'implicit'
  frameMode: FrameMode
  rawPayloadBytes: Uint8Array
  encoded: {
    phyPayloadBytes: Uint8Array
    payloadWithCrcBytes: Uint8Array
    whitenedBits: number[]
    fecBits: number[]
    interleavedBits: number[]
    graySymbols: LoRaSymbolValue[]
  }
  symbols: LoRaPhysicalSymbol[]
  timing: {
    symbolTimeMs: number
    preambleTimeMs: number
    payloadTimeMs: number
    timeOnAirMs: number
    payloadSymbols: number
    totalSymbols: number
  }
  diagnostics: {
    rawPayloadSizeBytes: number
    phyPayloadSizeBytes: number
    payloadWithCrcSizeBytes: number
    whitenedBitsCount: number
    fecBitsCount: number
    interleavedBitsCount: number
    dataSymbolsCount: number
  }
  meta: {
    sourceAddress?: number
    targetAddress?: number
    createdAt: number
  }
}
