import {
  DirectFrameCodec,
  DirectFrameType,
  MeshFrameCodec,
  MeshFrameType,
  TelemetryPayloadCodec,
  bytesToHex,
  Crc16,
  LoRaPingPayloadCodec,
  LoRaPhyDecoder,
  LoRaPhyEncoder,
  shouldUseLowDataRateOptimize,
  type DecodedTelemetryPayloadV1,
  type DirectFrame,
  type FrameMode,
  type LoRaPhyConfig,
  type LoRaPhysicalSymbol,
  type MeshFrame,
  type DecodedLoRaPingPayloadV1,
  type LoRaPingPayloadV1,
  type TelemetryPayloadV1,
} from '../../domain/lora/codec'
import type { LoRaModuleConfig } from '../../domain/modules/network/lora'
import type {
  SimulationLoRaCodecMode,
  SimulationLoRaCodecReport,
  SimulationLoRaCodecTelemetryDto,
  SimulationLoRaPingCodecReport,
  SimulationLoRaPingDto,
} from '../../../shared/simulationRuntime'

const DEFAULT_SYNC_WORD = 0x12
const SYMBOL_PREVIEW_LENGTH = 16

export const LORA_CODEC_REPORT_NOTE_PREFIX = 'lora-codec-report:'

export type LoRaCodecEndpointInfo = {
  deviceId: string
  moduleId?: string
  address: string
  numericAddress: number
}

export type LoRaCodecReportInput = {
  mode: SimulationLoRaCodecMode
  telemetry: TelemetryPayloadV1
  source: LoRaCodecEndpointInfo & { moduleId: string }
  target: LoRaCodecEndpointInfo
  sourceModuleConfig: Readonly<LoRaModuleConfig>
}

export type LoRaCodecEncodedPacketPayload = {
  kind: 'lora-symbol-codec-frame'
  frameMode: FrameMode
  sourceTelemetry: SimulationLoRaCodecTelemetryDto
  source: LoRaCodecEndpointInfo & { moduleId: string }
  target: LoRaCodecEndpointInfo
  encoded: SimulationLoRaCodecReport['encoded'] & {
    symbols: LoRaPhysicalSymbol[]
  }
}

export type LoRaPingEncodedPacketPayload = {
  kind: 'lora-symbol-codec-ping'
  frameMode: FrameMode
  sourcePing: SimulationLoRaPingDto
  source: LoRaCodecEndpointInfo & { moduleId: string }
  target: LoRaCodecEndpointInfo
  encoded: SimulationLoRaCodecReport['encoded'] & {
    symbols: LoRaPhysicalSymbol[]
  }
}

export type LoRaEncodedPacketPayload =
  | LoRaCodecEncodedPacketPayload
  | LoRaPingEncodedPacketPayload

export class LoRaCodecReportService {
  private readonly telemetryCodec = new TelemetryPayloadCodec()
  private readonly pingCodec = new LoRaPingPayloadCodec()
  private readonly directFrameCodec = new DirectFrameCodec()
  private readonly meshFrameCodec = new MeshFrameCodec()
  private readonly phyEncoder = new LoRaPhyEncoder()
  private readonly phyDecoder = new LoRaPhyDecoder()

  buildEncodedPayloads(input: LoRaCodecReportInput): LoRaCodecEncodedPacketPayload[] {
    const frameModes = this.resolveFrameModes(input.mode)
    const appPayloadBytes = this.telemetryCodec.encode(input.telemetry)
    const phyConfig = this.createPhyConfig(input.sourceModuleConfig)

    return frameModes.map((frameMode) =>
      this.buildEncodedPayloadForMode({
        ...input,
        frameMode,
        appPayloadBytes,
        phyConfig,
      }),
    )
  }

  buildReports(input: LoRaCodecReportInput): SimulationLoRaCodecReport[] {
    return this.buildEncodedPayloads(input).map((payload) =>
      this.decodeReceivedTelemetryPayload(payload),
    )
  }

  buildPingEncodedPayloads(input: Omit<LoRaCodecReportInput, 'telemetry'> & {
    ping: LoRaPingPayloadV1
  }): LoRaPingEncodedPacketPayload[] {
    const frameModes = this.resolveFrameModes(input.mode)
    const appPayloadBytes = this.pingCodec.encode(input.ping)
    const phyConfig = this.createPhyConfig(input.sourceModuleConfig)

    return frameModes.map((frameMode) =>
      this.buildPingEncodedPayloadForMode({
        ...input,
        frameMode,
        appPayloadBytes,
        phyConfig,
      }),
    )
  }

  decodeReceivedPayload(payload: LoRaEncodedPacketPayload): SimulationLoRaCodecReport | SimulationLoRaPingCodecReport {
    if (payload.kind === 'lora-symbol-codec-ping') {
      return this.decodeReceivedPingPayload(payload)
    }

    return this.decodeReceivedTelemetryPayload(payload)
  }

  private decodeReceivedTelemetryPayload(payload: LoRaCodecEncodedPacketPayload): SimulationLoRaCodecReport {
    const decodedPhy = this.phyDecoder.decode({
      symbols: payload.encoded.symbols,
      config: payload.encoded.phyConfig,
      mode: payload.encoded.phyMode,
      frameMode: payload.frameMode,
    })

    if (!decodedPhy.ok) {
      throw new Error(`LoRa PHY decode failed at Gateway: ${decodedPhy.reason}`)
    }

    const decodedFrame =
      payload.frameMode === 'mesh'
        ? this.meshFrameCodec.decode(decodedPhy.payloadBytes)
        : this.directFrameCodec.decode(decodedPhy.payloadBytes)
    const decodedTelemetry = this.telemetryCodec.decode(decodedFrame.payload)
    const reconstructedMessageId = this.reconstructMessageId(decodedFrame.src, decodedTelemetry)
    const expectedReconstructedMessageId = this.reconstructMessageId(
      payload.source.numericAddress,
      payload.sourceTelemetry,
    )
    const roundtrip = this.compareRoundtrip({
      sourceTelemetry: payload.sourceTelemetry,
      decodedTelemetry,
      reconstructedMessageId,
      expectedReconstructedMessageId,
    })

    const { symbols: _symbols, ...encodedReport } = payload.encoded

    return {
      messageKind: 'telemetry',
      frameMode: payload.frameMode,
      sourceTelemetry: { ...payload.sourceTelemetry },
      source: {
        deviceId: payload.source.deviceId,
        moduleId: payload.source.moduleId,
        address: payload.source.address,
        numericAddress: payload.source.numericAddress,
      },
      target: {
        deviceId: payload.target.deviceId,
        address: payload.target.address,
        numericAddress: payload.target.numericAddress,
      },
      encoded: {
        ...encodedReport,
        encodedSymbolsPreview: [...payload.encoded.encodedSymbolsPreview],
      },
      decoded: {
        frameMode: payload.frameMode,
        ...(payload.frameMode === 'mesh'
          ? { meshFrame: this.toMeshFrameDto(decodedFrame as MeshFrame) }
          : { directFrame: this.toDirectFrameDto(decodedFrame as DirectFrame) }),
        decodedTelemetry: this.toDecodedTelemetryDto(decodedTelemetry),
        reconstructedMessageId,
        decodedPayloadSizeBytes: decodedFrame.payload.length,
        phyDiagnostics: decodedPhy.diagnostics,
      },
      roundtrip: {
        ok: roundtrip.ok,
        expectedReconstructedMessageId,
        comparedFields: roundtrip.comparedFields,
      },
    }
  }

  private decodeReceivedPingPayload(payload: LoRaPingEncodedPacketPayload): SimulationLoRaPingCodecReport {
    const decodedPhy = this.phyDecoder.decode({
      symbols: payload.encoded.symbols,
      config: payload.encoded.phyConfig,
      mode: payload.encoded.phyMode,
      frameMode: payload.frameMode,
    })

    if (!decodedPhy.ok) {
      throw new Error(`LoRa PHY decode failed at Gateway: ${decodedPhy.reason}`)
    }

    const decodedFrame =
      payload.frameMode === 'mesh'
        ? this.meshFrameCodec.decode(decodedPhy.payloadBytes)
        : this.directFrameCodec.decode(decodedPhy.payloadBytes)
    const decodedPing = this.pingCodec.decode(decodedFrame.payload)
    const reconstructedMessageId = this.reconstructPingMessageId(decodedFrame.src, decodedPing)
    const expectedReconstructedMessageId = this.reconstructPingMessageId(
      payload.source.numericAddress,
      payload.sourcePing,
    )
    const roundtrip = this.comparePingRoundtrip({
      sourcePing: payload.sourcePing,
      decodedPing,
      reconstructedMessageId,
      expectedReconstructedMessageId,
    })

    const { symbols: _symbols, ...encodedReport } = payload.encoded

    return {
      messageKind: 'ping',
      frameMode: payload.frameMode,
      sourcePing: { ...payload.sourcePing },
      source: {
        deviceId: payload.source.deviceId,
        moduleId: payload.source.moduleId,
        address: payload.source.address,
        numericAddress: payload.source.numericAddress,
      },
      target: {
        deviceId: payload.target.deviceId,
        address: payload.target.address,
        numericAddress: payload.target.numericAddress,
      },
      encoded: {
        ...encodedReport,
        encodedSymbolsPreview: [...payload.encoded.encodedSymbolsPreview],
      },
      decoded: {
        frameMode: payload.frameMode,
        ...(payload.frameMode === 'mesh'
          ? { meshFrame: this.toMeshFrameDto(decodedFrame as MeshFrame) }
          : { directFrame: this.toDirectFrameDto(decodedFrame as DirectFrame) }),
        decodedPing: this.toDecodedPingDto(decodedPing),
        reconstructedMessageId,
        decodedPayloadSizeBytes: decodedFrame.payload.length,
        phyDiagnostics: decodedPhy.diagnostics,
      },
      roundtrip: {
        ok: roundtrip.ok,
        expectedReconstructedMessageId,
        comparedFields: roundtrip.comparedFields,
      },
    }
  }

  private buildEncodedPayloadForMode(input: LoRaCodecReportInput & {
    frameMode: FrameMode
    appPayloadBytes: Uint8Array
    phyConfig: LoRaPhyConfig
  }): LoRaCodecEncodedPacketPayload {
    const networkFrameBytes =
      input.frameMode === 'mesh'
        ? this.meshFrameCodec.encode({
            version: 1,
            src: input.source.numericAddress,
            dst: input.target.numericAddress,
            nextHop: input.target.numericAddress,
            prevHop: input.source.numericAddress,
            seq: input.telemetry.sequence,
            ttl: 8,
            hopCount: 0,
            type: MeshFrameType.DATA,
            flags: 0,
            payload: input.appPayloadBytes,
          })
        : this.directFrameCodec.encode({
            version: 1,
            src: input.source.numericAddress,
            dst: input.target.numericAddress,
            seq: input.telemetry.sequence,
            type: DirectFrameType.DATA,
            flags: 0,
            payload: input.appPayloadBytes,
          })
    const encoded = this.phyEncoder.encode({
      phy: input.phyConfig,
      frameMode: input.frameMode,
      payloadBytes: networkFrameBytes,
      sourceAddress: input.source.numericAddress,
      targetAddress: input.target.numericAddress,
    })

    return {
      kind: 'lora-symbol-codec-frame',
      frameMode: input.frameMode,
      sourceTelemetry: this.toTelemetryDto(input.telemetry),
      source: { ...input.source },
      target: { ...input.target },
      encoded: {
        phyConfig: encoded.config,
        phyMode: encoded.mode,
        appPayloadSizeBytes: input.appPayloadBytes.length,
        networkFrameSizeBytes: networkFrameBytes.length,
        phyPayloadSizeBytes: encoded.diagnostics.phyPayloadSizeBytes,
        payloadWithCrcSizeBytes: encoded.diagnostics.payloadWithCrcSizeBytes,
        whitenedBits: encoded.diagnostics.whitenedBitsCount,
        fecBits: encoded.diagnostics.fecBitsCount,
        interleavedBits: encoded.diagnostics.interleavedBitsCount,
        encodedDataSymbols: encoded.diagnostics.dataSymbolsCount,
        totalPhysicalSymbols: encoded.symbols.length,
        symbolTimeMs: encoded.timing.symbolTimeMs,
        timeOnAirMs: encoded.timing.timeOnAirMs,
        encodedBytesHex: bytesToHex(encoded.encoded.payloadWithCrcBytes),
        encodedSymbolsPreview: encoded.encoded.graySymbols.slice(0, SYMBOL_PREVIEW_LENGTH),
        symbols: encoded.symbols,
      },
    }
  }

  private buildPingEncodedPayloadForMode(input: Omit<LoRaCodecReportInput, 'telemetry'> & {
    ping: LoRaPingPayloadV1
    frameMode: FrameMode
    appPayloadBytes: Uint8Array
    phyConfig: LoRaPhyConfig
  }): LoRaPingEncodedPacketPayload {
    const networkFrameBytes =
      input.frameMode === 'mesh'
        ? this.meshFrameCodec.encode({
            version: 1,
            src: input.source.numericAddress,
            dst: input.target.numericAddress,
            nextHop: input.target.numericAddress,
            prevHop: input.source.numericAddress,
            seq: input.ping.sequence,
            ttl: 8,
            hopCount: 0,
            type: MeshFrameType.HELLO,
            flags: 0,
            payload: input.appPayloadBytes,
          })
        : this.directFrameCodec.encode({
            version: 1,
            src: input.source.numericAddress,
            dst: input.target.numericAddress,
            seq: input.ping.sequence,
            type: DirectFrameType.HELLO,
            flags: 0,
            payload: input.appPayloadBytes,
          })
    const encoded = this.phyEncoder.encode({
      phy: input.phyConfig,
      frameMode: input.frameMode,
      payloadBytes: networkFrameBytes,
      sourceAddress: input.source.numericAddress,
      targetAddress: input.target.numericAddress,
    })

    return {
      kind: 'lora-symbol-codec-ping',
      frameMode: input.frameMode,
      sourcePing: this.toPingDto(input.ping),
      source: { ...input.source },
      target: { ...input.target },
      encoded: {
        phyConfig: encoded.config,
        phyMode: encoded.mode,
        appPayloadSizeBytes: input.appPayloadBytes.length,
        networkFrameSizeBytes: networkFrameBytes.length,
        phyPayloadSizeBytes: encoded.diagnostics.phyPayloadSizeBytes,
        payloadWithCrcSizeBytes: encoded.diagnostics.payloadWithCrcSizeBytes,
        whitenedBits: encoded.diagnostics.whitenedBitsCount,
        fecBits: encoded.diagnostics.fecBitsCount,
        interleavedBits: encoded.diagnostics.interleavedBitsCount,
        encodedDataSymbols: encoded.diagnostics.dataSymbolsCount,
        totalPhysicalSymbols: encoded.symbols.length,
        symbolTimeMs: encoded.timing.symbolTimeMs,
        timeOnAirMs: encoded.timing.timeOnAirMs,
        encodedBytesHex: bytesToHex(encoded.encoded.payloadWithCrcBytes),
        encodedSymbolsPreview: encoded.encoded.graySymbols.slice(0, SYMBOL_PREVIEW_LENGTH),
        symbols: encoded.symbols,
      },
    }
  }

  private resolveFrameModes(mode: SimulationLoRaCodecMode): FrameMode[] {
    return mode === 'both' ? ['direct', 'mesh'] : [mode]
  }

  private createPhyConfig(config: Readonly<LoRaModuleConfig>): LoRaPhyConfig {
    const bandwidthHz = toSupportedBandwidth(config.radio.bandwidthHz)
    const spreadingFactor = config.radio.spreadingFactor

    return {
      frequencyHz: config.radio.frequencyHz,
      bandwidthHz,
      spreadingFactor,
      codingRate: config.radio.codingRate,
      preambleLength: config.radio.preambleLength,
      explicitHeader: !config.radio.implicitHeader,
      payloadCrcEnabled: config.radio.crcEnabled,
      lowDataRateOptimize: shouldUseLowDataRateOptimize({
        spreadingFactor,
        bandwidthHz,
      }),
      syncWord: DEFAULT_SYNC_WORD,
    }
  }

  private reconstructMessageId(
    src: number,
    telemetry: Pick<TelemetryPayloadV1, 'sequence' | 'measuredAtUnix'>,
  ): string {
    return `sim-${src}-${telemetry.sequence}-${telemetry.measuredAtUnix}`
  }

  private reconstructPingMessageId(
    src: number,
    ping: Pick<LoRaPingPayloadV1, 'sequence' | 'sentAtUnix'>,
  ): string {
    return `ping-${src}-${ping.sequence}-${ping.sentAtUnix}`
  }

  private compareRoundtrip(input: {
    sourceTelemetry: SimulationLoRaCodecTelemetryDto
    decodedTelemetry: DecodedTelemetryPayloadV1
    reconstructedMessageId: string
    expectedReconstructedMessageId: string
  }): { ok: boolean; comparedFields: string[] } {
    const comparedFields = [
      'schemaVersion',
      'sequence',
      'measuredAtUnix',
      'sensorFlags',
      'airTempCentiC',
      'airHumidityCentiPct',
      'soilTempCentiC',
      'soilMoistureCentiPct',
      'co2ppm',
      'batteryPermille',
      'reconstructedMessageId',
    ]
    const ok =
      input.sourceTelemetry.schemaVersion === input.decodedTelemetry.schemaVersion &&
      input.sourceTelemetry.sequence === input.decodedTelemetry.sequence &&
      input.sourceTelemetry.measuredAtUnix === input.decodedTelemetry.measuredAtUnix &&
      input.sourceTelemetry.sensorFlags === input.decodedTelemetry.sensorFlags &&
      input.sourceTelemetry.airTempCentiC === input.decodedTelemetry.airTempCentiC &&
      input.sourceTelemetry.airHumidityCentiPct === input.decodedTelemetry.airHumidityCentiPct &&
      input.sourceTelemetry.soilTempCentiC === input.decodedTelemetry.soilTempCentiC &&
      input.sourceTelemetry.soilMoistureCentiPct === input.decodedTelemetry.soilMoistureCentiPct &&
      input.sourceTelemetry.co2ppm === input.decodedTelemetry.co2ppm &&
      input.sourceTelemetry.batteryPermille === input.decodedTelemetry.batteryPermille &&
      input.reconstructedMessageId === input.expectedReconstructedMessageId

    return { ok, comparedFields }
  }

  private comparePingRoundtrip(input: {
    sourcePing: SimulationLoRaPingDto
    decodedPing: DecodedLoRaPingPayloadV1
    reconstructedMessageId: string
    expectedReconstructedMessageId: string
  }): { ok: boolean; comparedFields: string[] } {
    const comparedFields = ['schemaVersion', 'sequence', 'sentAtUnix', 'reconstructedMessageId']
    const ok =
      input.sourcePing.schemaVersion === input.decodedPing.schemaVersion &&
      input.sourcePing.sequence === input.decodedPing.sequence &&
      input.sourcePing.sentAtUnix === input.decodedPing.sentAtUnix &&
      input.reconstructedMessageId === input.expectedReconstructedMessageId

    return { ok, comparedFields }
  }

  private toTelemetryDto(payload: TelemetryPayloadV1): SimulationLoRaCodecTelemetryDto {
    return {
      schemaVersion: payload.schemaVersion,
      messageId: payload.messageId,
      sequence: payload.sequence,
      measuredAtUnix: payload.measuredAtUnix,
      sensorFlags: payload.sensorFlags,
      airTempCentiC: payload.airTempCentiC,
      airHumidityCentiPct: payload.airHumidityCentiPct,
      soilTempCentiC: payload.soilTempCentiC,
      soilMoistureCentiPct: payload.soilMoistureCentiPct,
      co2ppm: payload.co2ppm,
      batteryPermille: payload.batteryPermille,
    }
  }

  private toDecodedTelemetryDto(
    payload: DecodedTelemetryPayloadV1,
  ): Omit<SimulationLoRaCodecTelemetryDto, 'messageId'> {
    return {
      schemaVersion: payload.schemaVersion,
      sequence: payload.sequence,
      measuredAtUnix: payload.measuredAtUnix,
      sensorFlags: payload.sensorFlags,
      airTempCentiC: payload.airTempCentiC,
      airHumidityCentiPct: payload.airHumidityCentiPct,
      soilTempCentiC: payload.soilTempCentiC,
      soilMoistureCentiPct: payload.soilMoistureCentiPct,
      co2ppm: payload.co2ppm,
      batteryPermille: payload.batteryPermille,
    }
  }

  private toPingDto(payload: LoRaPingPayloadV1): SimulationLoRaPingDto {
    return {
      schemaVersion: payload.schemaVersion,
      messageId: payload.messageId,
      sequence: payload.sequence,
      sentAtUnix: payload.sentAtUnix,
    }
  }

  private toDecodedPingDto(payload: DecodedLoRaPingPayloadV1): Omit<SimulationLoRaPingDto, 'messageId'> {
    return {
      schemaVersion: payload.schemaVersion,
      sequence: payload.sequence,
      sentAtUnix: payload.sentAtUnix,
    }
  }

  private toDirectFrameDto(frame: DirectFrame): SimulationLoRaCodecReport['decoded']['directFrame'] {
    return {
      version: frame.version,
      src: frame.src,
      dst: frame.dst,
      seq: frame.seq,
      type: DirectFrameType[frame.type],
      flags: frame.flags,
      payloadSize: frame.payload.length,
    }
  }

  private toMeshFrameDto(frame: MeshFrame): SimulationLoRaCodecReport['decoded']['meshFrame'] {
    return {
      version: frame.version,
      src: frame.src,
      dst: frame.dst,
      nextHop: frame.nextHop,
      prevHop: frame.prevHop,
      seq: frame.seq,
      ttl: frame.ttl,
      hopCount: frame.hopCount,
      type: MeshFrameType[frame.type],
      flags: frame.flags,
      payloadSize: frame.payload.length,
    }
  }
}

export function isLoRaCodecEncodedPacketPayload(
  value: unknown,
): value is LoRaEncodedPacketPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((value as { kind?: unknown }).kind === 'lora-symbol-codec-frame' ||
      (value as { kind?: unknown }).kind === 'lora-symbol-codec-ping')
  )
}

export function loraAddressToNumericAddress(address: string): number {
  const numeric = Number(address)

  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffff) {
    return numeric
  }

  return Crc16.ccittFalse(Uint8Array.from(address, (char) => char.charCodeAt(0) & 0xff))
}

function toSupportedBandwidth(value: number): LoRaPhyConfig['bandwidthHz'] {
  if (value === 125_000 || value === 250_000 || value === 500_000) {
    return value
  }

  return 125_000
}
