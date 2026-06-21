import type { SimulationClockSnapshot, SimulationClockSpeed } from '../engine/runtime/clock'
import type {
  EventQueueSnapshot,
  RadioLinkSnapshot,
  SimulationEngineSnapshot,
  SimulationStepResult
} from '../engine/runtime'

export type { SimulationClockSnapshot, SimulationClockSpeed } from '../engine/runtime/clock'
export type {
  EventQueueSnapshot,
  RadioLinkSnapshot,
  SimulationEngineSnapshot,
  SimulationStepResult
} from '../engine/runtime'

export type SimulationStartCommand = {
  type: 'simulation/start'
}

export type SimulationPauseCommand = {
  type: 'simulation/pause'
}

export type SimulationStopCommand = {
  type: 'simulation/stop'
}

export type SimulationResetCommand = {
  type: 'simulation/reset'
}

export type SimulationSetSpeedCommand = {
  type: 'simulation/set-speed'
  speed: SimulationClockSpeed
}

export type SimulationAdvanceClockCommand = {
  type: 'simulation/advance-clock'
  deltaRealMs: number
}

export type SimulationGetClockSnapshotCommand = {
  type: 'simulation/get-clock-snapshot'
}

export type SimulationScheduleBasicTelemetryCommand = {
  type: 'simulation/schedule-basic-telemetry'
  deviceId: string
  targetAddress: string
  dueInMs?: number
  repeat?: boolean
  intervalMs?: number
  sendDelayMs?: number
  deliveryDelayMs?: number
}

export type SimulationSendPingToGatewayCommand = {
  type: 'simulation/send-ping-to-gateway'
  deviceId: string
  targetAddress: string
  dueInMs?: number
  deliveryDelayMs?: number
}

export type SimulationLoRaCodecMode = 'direct' | 'mesh' | 'both'

export type SimulationSendTypicalLoRaMessageCommand = {
  type: 'simulation/send-typical-lora-message'
  deviceId: string
  targetAddress: string
  mode?: SimulationLoRaCodecMode
}

export type SimulationCommand =
  | SimulationStartCommand
  | SimulationPauseCommand
  | SimulationStopCommand
  | SimulationResetCommand
  | SimulationSetSpeedCommand
  | SimulationAdvanceClockCommand
  | SimulationGetClockSnapshotCommand
  | SimulationScheduleBasicTelemetryCommand
  | SimulationSendPingToGatewayCommand
  | SimulationSendTypicalLoRaMessageCommand

export type SimulationLoRaCodecTelemetryDto = {
  schemaVersion: 1
  messageId?: string
  sequence: number
  measuredAtUnix: number
  sensorFlags: number
  airTempCentiC?: number
  airHumidityCentiPct?: number
  soilTempCentiC?: number
  soilMoistureCentiPct?: number
  co2ppm?: number
  batteryPermille?: number
}

export type SimulationLoRaPingDto = {
  schemaVersion: 1
  messageId?: string
  sequence: number
  sentAtUnix: number
}

export type SimulationLoRaCodecPhyConfigDto = {
  frequencyHz: number
  bandwidthHz: 125000 | 250000 | 500000
  spreadingFactor: 7 | 8 | 9 | 10 | 11 | 12
  codingRate: '4/5' | '4/6' | '4/7' | '4/8'
  preambleLength: number
  explicitHeader: boolean
  payloadCrcEnabled: boolean
  lowDataRateOptimize: boolean
  syncWord: number
}

export type SimulationLoRaCodecDirectFrameDto = {
  version: 1
  src: number
  dst: number
  seq: number
  type: string
  flags: number
  payloadSize: number
}

export type SimulationLoRaCodecMeshFrameDto = {
  version: 1
  src: number
  dst: number
  nextHop: number
  prevHop: number
  seq: number
  ttl: number
  hopCount: number
  type: string
  flags: number
  payloadSize: number
}

export type SimulationLoRaCodecReport = {
  messageKind: 'telemetry'
  frameMode: 'direct' | 'mesh'
  sourceTelemetry: SimulationLoRaCodecTelemetryDto
  source: {
    deviceId: string
    moduleId: string
    address: string
    numericAddress: number
  }
  target: {
    deviceId: string
    address: string
    numericAddress: number
  }
  encoded: {
    phyConfig: SimulationLoRaCodecPhyConfigDto
    phyMode: 'explicit' | 'implicit'
    appPayloadSizeBytes: number
    networkFrameSizeBytes: number
    phyPayloadSizeBytes: number
    payloadWithCrcSizeBytes: number
    whitenedBits: number
    fecBits: number
    interleavedBits: number
    encodedDataSymbols: number
    totalPhysicalSymbols: number
    symbolTimeMs: number
    timeOnAirMs: number
    encodedBytesHex: string
    encodedSymbolsPreview: number[]
  }
  decoded: {
    frameMode: 'direct' | 'mesh'
    directFrame?: SimulationLoRaCodecDirectFrameDto
    meshFrame?: SimulationLoRaCodecMeshFrameDto
    decodedTelemetry: Omit<SimulationLoRaCodecTelemetryDto, 'messageId'>
    reconstructedMessageId: string
    decodedPayloadSizeBytes: number
    phyDiagnostics: {
      receivedSymbols: number
      dataSymbols: number
      correctedErrors: number
      uncorrectableErrors: number
      decodedBytes: number
    }
  }
  roundtrip: {
    ok: boolean
    expectedReconstructedMessageId: string
    comparedFields: string[]
  }
}

export type SimulationLoRaPingCodecReport = {
  messageKind: 'ping'
  frameMode: 'direct' | 'mesh'
  sourcePing: SimulationLoRaPingDto
  source: {
    deviceId: string
    moduleId: string
    address: string
    numericAddress: number
  }
  target: {
    deviceId: string
    address: string
    numericAddress: number
  }
  encoded: SimulationLoRaCodecReport['encoded']
  decoded: {
    frameMode: 'direct' | 'mesh'
    directFrame?: SimulationLoRaCodecDirectFrameDto
    meshFrame?: SimulationLoRaCodecMeshFrameDto
    decodedPing: Omit<SimulationLoRaPingDto, 'messageId'>
    reconstructedMessageId: string
    decodedPayloadSizeBytes: number
    phyDiagnostics: SimulationLoRaCodecReport['decoded']['phyDiagnostics']
  }
  roundtrip: {
    ok: boolean
    expectedReconstructedMessageId: string
    comparedFields: string[]
  }
}

export type SimulationLoRaAnyCodecReport =
  | SimulationLoRaCodecReport
  | SimulationLoRaPingCodecReport

export type SimulationRuntimeExecutionLogEntry = {
  sequence: number
  mode: 'manual' | 'auto'
  ok: boolean
  status: string
  startedAtMs: number
  endedAtMs: number
  deltaRealMs: number
  deltaSimulationMs: number
  processedEventCount: number
  failedEventCount: number
  pendingEventCount: number
  processedEvents: Array<{
    id: string
    type: string
    scheduledAt: number
  }>
  dispatchResults: Array<{
    eventId: string
    eventType: string
    ok: boolean
    handlerName?: string
    scheduledEventIds: string[]
    notes?: string[]
    error?: {
      code: string
      message: string
      severity: string
    }
  }>
  errors: Array<{
    code: string
    message: string
  }>
}

export type SimulationCommandResult = {
  ok: boolean
  clock?: SimulationClockSnapshot
  engine?: SimulationEngineSnapshot
  queue?: EventQueueSnapshot
  radioLinks?: RadioLinkSnapshot[]
  step?: SimulationStepResult
  executions?: SimulationRuntimeExecutionLogEntry[]
  scheduledEventIds?: string[]
  loraCodecReports?: SimulationLoRaAnyCodecReport[]
  error?: {
    code: string
    message: string
  }
}
