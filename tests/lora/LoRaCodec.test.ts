import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SimulationRuntimeSessionManager } from '../../src/engine/application/simulation'
import {
  LORA_CODEC_REPORT_NOTE_PREFIX,
  isLoRaCodecEncodedPacketPayload,
} from '../../src/engine/application/simulation/LoRaCodecReportService'
import { DeviceFactory } from '../../src/engine/domain/device/DeviceFactory'
import { DeviceRole } from '../../src/engine/domain/device/DeviceRole'
import {
  DirectFrameCodec,
  DirectFrameType,
  FrameCodecError,
  MeshFrameCodec,
  MeshFrameType,
  TelemetryMessageFactory,
  TelemetryPayloadCodec,
  TelemetryPayloadCodecError,
  TelemetrySensorFlags,
  binaryToGray,
  defaultLoRaPhyConfig,
  grayToBinary,
  LoRaFec,
  LoRaPhyDecoder,
  LoRaPhyEncoder,
  type LoRaCodingRate,
  type TelemetryPayloadV1,
} from '../../src/engine/domain/lora/codec'
import {
  LoRaModule,
  LoRaProfile,
  LoRaRegion,
} from '../../src/engine/domain/modules/network/lora'
import { Workspace } from '../../src/engine/domain/workspace'
import type { SimulationLoRaCodecReport } from '../../src/shared/simulationRuntime'

function createTelemetry(sequence = 1): TelemetryPayloadV1 {
  return {
    schemaVersion: 1,
    messageId: `source-message-${sequence}`,
    sequence,
    measuredAtUnix: 1_782_060_000 + sequence,
    sensorFlags:
      TelemetrySensorFlags.AIR_TEMPERATURE |
      TelemetrySensorFlags.AIR_HUMIDITY |
      TelemetrySensorFlags.SOIL_TEMPERATURE |
      TelemetrySensorFlags.SOIL_MOISTURE |
      TelemetrySensorFlags.CO2 |
      TelemetrySensorFlags.BATTERY,
    airTempCentiC: 2135 + sequence,
    airHumidityCentiPct: 6420 + sequence,
    soilTempCentiC: 1280 + sequence,
    soilMoistureCentiPct: 4175 + sequence,
    co2ppm: 451 + sequence,
    batteryPermille: 899 - sequence,
  }
}

function createLoRaModule(id: string, address: string): LoRaModule {
  return new LoRaModule(id, 'SX1276', '1.0.0', address, {
    radio: {
      profile: LoRaProfile.LORA_MESH,
      region: LoRaRegion.EU868,
      frequencyHz: 868_100_000,
      bandwidthHz: 125_000,
      spreadingFactor: 7,
      codingRate: '4/5',
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
      nodeAddress: address,
      relayEnabled: false,
      maxHops: 8,
    },
  })
}

function createWorkspaceFixture(): {
  workspace: Workspace
  sensorModule: LoRaModule
  gatewayModule: LoRaModule
} {
  const workspace = new Workspace({
    id: 'project',
    name: 'LoRa codec',
    width: 1000,
    height: 1000,
    metersPerUnit: 10,
  })
  const sensorModule = createLoRaModule('sensor-lora', '1001')
  const gatewayModule = createLoRaModule('gateway-lora', '1')
  const sensor = DeviceFactory.createDevice({
    id: 'sensor-001',
    model: 'ANT-S',
    version: '1.0.0',
    role: DeviceRole.NODE,
    modules: [sensorModule],
  })
  const gateway = DeviceFactory.createDevice({
    id: 'gateway-001',
    model: 'ANT-G',
    version: '1.0.0',
    role: DeviceRole.GATEWAY,
    modules: [gatewayModule],
  })

  workspace.addDevice(sensor, { x: 10, y: 10 }, {
    endpoints: [
      {
        deviceId: sensor.getInfo().id,
        moduleId: sensorModule.id,
        protocol: 'lora',
        address: '1001',
      },
    ],
  })
  workspace.addDevice(gateway, { x: 20, y: 20 }, {
    endpoints: [
      {
        deviceId: gateway.getInfo().id,
        moduleId: gatewayModule.id,
        protocol: 'lora',
        address: '1',
      },
    ],
  })

  return { workspace, sensorModule, gatewayModule }
}

describe('LoRa codec', () => {
  it('encodes and decodes telemetry payloads without JSON payload encoding', () => {
    const codec = new TelemetryPayloadCodec()
    const telemetry = createTelemetry()
    const encoded = codec.encode(telemetry)
    const decoded = codec.decode(encoded)

    assert.equal(decoded.sequence, telemetry.sequence)
    assert.equal(decoded.measuredAtUnix, telemetry.measuredAtUnix)
    assert.equal(decoded.sensorFlags, telemetry.sensorFlags)
    assert.equal(decoded.airTempCentiC, telemetry.airTempCentiC)
    assert.equal(decoded.airHumidityCentiPct, telemetry.airHumidityCentiPct)
    assert.equal(decoded.soilTempCentiC, telemetry.soilTempCentiC)
    assert.equal(decoded.soilMoistureCentiPct, telemetry.soilMoistureCentiPct)
    assert.equal(decoded.co2ppm, telemetry.co2ppm)
    assert.equal(decoded.batteryPermille, telemetry.batteryPermille)
  })

  it('encodes and decodes direct and mesh frames', () => {
    const payload = new TelemetryPayloadCodec().encode(createTelemetry())
    const directCodec = new DirectFrameCodec()
    const meshCodec = new MeshFrameCodec()
    const direct = directCodec.decode(
      directCodec.encode({
        version: 1,
        src: 1001,
        dst: 1,
        seq: 1,
        type: DirectFrameType.DATA,
        flags: 0,
        payload,
      }),
    )
    const mesh = meshCodec.decode(
      meshCodec.encode({
        version: 1,
        src: 1001,
        dst: 1,
        nextHop: 1,
        prevHop: 1001,
        seq: 1,
        ttl: 8,
        hopCount: 0,
        type: MeshFrameType.DATA,
        flags: 0,
        payload,
      }),
    )

    assert.equal(direct.src, 1001)
    assert.equal(direct.payload.length, payload.length)
    assert.equal(mesh.nextHop, 1)
    assert.equal(mesh.payload.length, payload.length)
  })

  it('maps Gray symbols reversibly', () => {
    for (let value = 0; value < 128; value += 1) {
      assert.equal(grayToBinary(binaryToGray(value)), value)
    }
  })

  it('roundtrips FEC approximation without errors for all coding rates', () => {
    const bits = Array.from({ length: 64 }, (_, index) => index % 3 === 0 ? 1 : 0)
    const rates: LoRaCodingRate[] = ['4/5', '4/6', '4/7', '4/8']

    for (const rate of rates) {
      const encoded = LoRaFec.encode(bits, rate)
      const decoded = LoRaFec.decode(encoded, rate)

      assert.deepEqual(decoded.bits.slice(0, bits.length), bits)
      assert.equal(decoded.uncorrectableErrors, 0)
    }
  })

  it('decodes PHY direct and mesh frames from symbols/config/mode/frameMode only', () => {
    const telemetryCodec = new TelemetryPayloadCodec()
    const appPayload = telemetryCodec.encode(createTelemetry())
    const encoder = new LoRaPhyEncoder()
    const decoder = new LoRaPhyDecoder()
    const directCodec = new DirectFrameCodec()
    const meshCodec = new MeshFrameCodec()
    const directFrame = directCodec.encode({
      version: 1,
      src: 1001,
      dst: 1,
      seq: 1,
      type: DirectFrameType.DATA,
      flags: 0,
      payload: appPayload,
    })
    const meshFrame = meshCodec.encode({
      version: 1,
      src: 1001,
      dst: 1,
      nextHop: 1,
      prevHop: 1001,
      seq: 1,
      ttl: 8,
      hopCount: 0,
      type: MeshFrameType.DATA,
      flags: 0,
      payload: appPayload,
    })

    for (const [frameMode, payloadBytes] of [
      ['direct', directFrame],
      ['mesh', meshFrame],
    ] as const) {
      const encoded = encoder.encode({
        phy: defaultLoRaPhyConfig,
        frameMode,
        payloadBytes,
      })
      const decoded = decoder.decode({
        symbols: encoded.symbols,
        config: encoded.config,
        mode: encoded.mode,
        frameMode: encoded.frameMode,
      })

      assert.equal(decoded.ok, true)
      if (decoded.ok) {
        assert.deepEqual(Array.from(decoded.payloadBytes), Array.from(payloadBytes))
      }
    }
  })

  it('detects corrupted frame and app CRC values', () => {
    const telemetryCodec = new TelemetryPayloadCodec()
    const payload = telemetryCodec.encode(createTelemetry())
    const corruptedPayload = payload.slice()
    corruptedPayload[1] ^= 0xff

    assert.throws(() => telemetryCodec.decode(corruptedPayload), TelemetryPayloadCodecError)

    const frameCodec = new DirectFrameCodec()
    const frameBytes = frameCodec.encode({
      version: 1,
      src: 1001,
      dst: 1,
      seq: 1,
      type: DirectFrameType.DATA,
      flags: 0,
      payload,
    })
    const corruptedFrame = frameBytes.slice()
    corruptedFrame[2] ^= 0xff

    assert.throws(() => frameCodec.decode(corruptedFrame), FrameCodecError)
  })

  it('generates changing telemetry with monotonic measuredAtUnix', () => {
    const factory = new TelemetryMessageFactory({
      sourceAddress: 1001,
      sequenceStart: 1,
      seed: 42,
    })
    const first = factory.next()
    const second = factory.next()
    const third = factory.next()

    assert.equal(first.sequence, 1)
    assert.equal(second.sequence, 2)
    assert.equal(third.sequence, 3)
    assert.ok(second.measuredAtUnix > first.measuredAtUnix)
    assert.ok(third.measuredAtUnix > second.measuredAtUnix)
    assert.notEqual(first.messageId, second.messageId)
    assert.notEqual(first.airTempCentiC, second.airTempCentiC)
  })

  it('queues mode=both LoRa codec sends and decodes byte payloads at the Gateway', () => {
    const { workspace, gatewayModule } = createWorkspaceFixture()
    const manager = new SimulationRuntimeSessionManager({
      runtimeContextProvider: () => ({
        workspace,
        registry: workspace.getRegistryQueries(),
      }),
    })

    const first = manager.dispatch({
      type: 'simulation/send-typical-lora-message',
      deviceId: 'sensor-001',
      targetAddress: '1',
      mode: 'both',
    })

    assert.equal(first.ok, true)
    assert.equal(first.scheduledEventIds?.length, 1)
    assert.equal(gatewayModule.getInboundBuffer().length, 0)

    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 100 })
    const received = manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    const inbound = gatewayModule.getInboundBuffer()
    const reports = extractCodecReports(received.executions ?? [])

    assert.equal(inbound.length, 2)
    assert.ok(isLoRaCodecEncodedPacketPayload(inbound[0]?.payload))
    assert.ok(isLoRaCodecEncodedPacketPayload(inbound[1]?.payload))
    assert.equal(reports.length, 2)
    assert.equal(reports[0]?.sourceTelemetry.sequence, 1)
    assert.equal(reports[0]?.sourceTelemetry.messageId, reports[1]?.sourceTelemetry.messageId)
    assert.equal(reports[0]?.roundtrip.ok, true)
    assert.equal(reports[1]?.roundtrip.ok, true)

    const second = manager.dispatch({
      type: 'simulation/send-typical-lora-message',
      deviceId: 'sensor-001',
      targetAddress: '1',
      mode: 'both',
    })

    assert.equal(second.ok, true)
    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 100 })
    const secondReceived = manager.dispatch({ type: 'simulation/advance-clock', deltaRealMs: 1 })
    const secondReports = extractCodecReports(secondReceived.executions ?? []).filter(
      (report) => report.sourceTelemetry.sequence === 2,
    )

    assert.equal(secondReports.length, 2)
    assert.ok(
      Number(secondReports[0]?.sourceTelemetry.measuredAtUnix) >
        Number(reports[0]?.sourceTelemetry.measuredAtUnix),
    )
    assert.notEqual(secondReports[0]?.sourceTelemetry.messageId, reports[0]?.sourceTelemetry.messageId)
  })
})

function extractCodecReports(
  executions: NonNullable<ReturnType<SimulationRuntimeSessionManager['dispatch']>['executions']>,
): SimulationLoRaCodecReport[] {
  const reports: SimulationLoRaCodecReport[] = []

  for (const execution of executions) {
    for (const result of execution.dispatchResults) {
      for (const note of result.notes ?? []) {
        if (note.startsWith(LORA_CODEC_REPORT_NOTE_PREFIX)) {
          reports.push(JSON.parse(note.slice(LORA_CODEC_REPORT_NOTE_PREFIX.length)))
        }
      }
    }
  }

  return reports
}
