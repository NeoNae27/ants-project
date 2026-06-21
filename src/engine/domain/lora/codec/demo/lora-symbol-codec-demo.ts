import { LoRaCodecReportService } from '../../../../application/simulation/LoRaCodecReportService'
import { LoRaProfile, LoRaRegion, type LoRaModuleConfig } from '../../../modules/network/lora'
import { TelemetryMessageFactory, type LoRaCodingRate } from '..'
import type {
  SimulationLoRaCodecMode,
  SimulationLoRaCodecReport,
} from '../../../../../shared/simulationRuntime'

type DemoOptions = {
  mode: SimulationLoRaCodecMode
  count: number
  seed?: number
  sf: 7 | 8 | 9 | 10 | 11 | 12
  bw: 125000 | 250000 | 500000
  cr: LoRaCodingRate
}

const source = {
  deviceId: 'sensor-001',
  moduleId: 'sensor-lora',
  address: '1001',
  numericAddress: 1001,
}
const target = {
  deviceId: 'gateway-001',
  address: '1',
  numericAddress: 1,
}

function parseArgs(argv: string[]): DemoOptions {
  const options: DemoOptions = {
    mode: 'both',
    count: 1,
    sf: 7,
    bw: 125_000,
    cr: '4/5',
  }

  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=')

    switch (key) {
      case 'mode':
        if (value === 'direct' || value === 'mesh' || value === 'both') {
          options.mode = value
        }
        break
      case 'count':
        options.count = Math.max(1, Number(value) || 1)
        break
      case 'seed':
        options.seed = Number(value)
        break
      case 'sf':
        if (value && ['7', '8', '9', '10', '11', '12'].includes(value)) {
          options.sf = Number(value) as DemoOptions['sf']
        }
        break
      case 'bw':
        if (value === '125000' || value === '250000' || value === '500000') {
          options.bw = Number(value) as DemoOptions['bw']
        }
        break
      case 'cr':
        if (value === '4/5' || value === '4/6' || value === '4/7' || value === '4/8') {
          options.cr = value
        }
        break
      default:
        break
    }
  }

  return options
}

function createModuleConfig(options: DemoOptions): LoRaModuleConfig {
  return {
    radio: {
      profile: LoRaProfile.LORA_MESH,
      region: LoRaRegion.EU868,
      frequencyHz: 868_100_000,
      bandwidthHz: options.bw,
      spreadingFactor: options.sf,
      codingRate: options.cr,
      preambleLength: 8,
      crcEnabled: true,
      implicitHeader: false,
      txPowerDbm: 14,
      maxPayloadSizeBytes: 64,
      ackEnabled: false,
      retryLimit: 0,
      timeoutMs: 1_000,
      maxRangeMeters: 10_000,
      maxConnections: 8,
    },
    mesh: {
      enabled: true,
      nodeAddress: source.address,
      relayEnabled: false,
      maxHops: 8,
    },
  }
}

function printReports(reports: readonly SimulationLoRaCodecReport[]): void {
  for (const [index, report] of reports.entries()) {
    console.log('============================================================')
    console.log(`LoRa Symbol Codec Demo #${index + 1} mode=${report.frameMode}`)
    console.log('============================================================')
    console.log('')
    console.log('SOURCE TELEMETRY')
    console.log(JSON.stringify(report.sourceTelemetry, null, 2))
    console.log('')
    console.log('ENCODED MESSAGE')
    console.log(
      JSON.stringify(
        {
          frameMode: report.frameMode,
          phyMode: report.encoded.phyMode,
          source: report.source,
          target: report.target,
          phyConfig: report.encoded.phyConfig,
          appPayloadSizeBytes: report.encoded.appPayloadSizeBytes,
          networkFrameSizeBytes: report.encoded.networkFrameSizeBytes,
          phyPayloadSizeBytes: report.encoded.phyPayloadSizeBytes,
          payloadWithCrcSizeBytes: report.encoded.payloadWithCrcSizeBytes,
          whitenedBits: report.encoded.whitenedBits,
          fecBits: report.encoded.fecBits,
          interleavedBits: report.encoded.interleavedBits,
          encodedDataSymbols: report.encoded.encodedDataSymbols,
          totalPhysicalSymbols: report.encoded.totalPhysicalSymbols,
          timeOnAirMs: Number(report.encoded.timeOnAirMs.toFixed(3)),
          encodedBytesHex: report.encoded.encodedBytesHex,
          encodedSymbolsPreview: report.encoded.encodedSymbolsPreview,
        },
        null,
        2,
      ),
    )
    console.log('')
    console.log('DECODED MESSAGE')
    console.log(JSON.stringify(report.decoded, null, 2))
    console.log('')
    console.log('ROUNDTRIP')
    console.log(report.roundtrip.ok ? 'roundtrip: OK' : 'roundtrip: FAIL')
    console.log('')
  }
}

function main(): void {
  const options = parseArgs(process.argv)
  const factory = new TelemetryMessageFactory({
    sourceAddress: source.numericAddress,
    sequenceStart: 1,
    seed: options.seed,
  })
  const reportService = new LoRaCodecReportService()
  const sourceModuleConfig = createModuleConfig(options)

  for (let index = 0; index < options.count; index += 1) {
    const telemetry = factory.next()
    const reports = reportService.buildReports({
      mode: options.mode,
      telemetry,
      source,
      target,
      sourceModuleConfig,
    })

    printReports(reports)
  }
}

main()
