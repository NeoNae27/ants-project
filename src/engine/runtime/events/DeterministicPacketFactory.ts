import type { LoRaModule, LoRaPacket } from '../../domain/modules/network/lora'
import {
  TelemetrySensorFlags,
  type TelemetryPayloadV1
} from '../../domain/lora/codec'
import {
  LoRaCodecReportService,
  loraAddressToNumericAddress
} from '../../application/simulation/LoRaCodecReportService'
import type { RuntimeTelemetryPayload } from './RuntimeEventPayloads'

export type DeterministicPacketInput = {
  sourceAddress: string
  targetAddress: string
  telemetry: RuntimeTelemetryPayload
  sourceModule: LoRaModule
  simulationTimeMs: number
}

export function createDeterministicLoRaPacket(input: DeterministicPacketInput): LoRaPacket {
  const config = input.sourceModule.getConfig()
  const sourceNumericAddress = loraAddressToNumericAddress(input.sourceAddress)
  const [encodedPayload] = new LoRaCodecReportService().buildEncodedPayloads({
    mode: 'direct',
    telemetry: runtimeTelemetryToLoRaTelemetry(input.telemetry, sourceNumericAddress),
    source: {
      deviceId: input.telemetry.device_id,
      moduleId: input.sourceModule.id,
      address: input.sourceAddress,
      numericAddress: sourceNumericAddress
    },
    target: {
      deviceId: input.targetAddress,
      address: input.targetAddress,
      numericAddress: loraAddressToNumericAddress(input.targetAddress)
    },
    sourceModuleConfig: config
  })

  return {
    packetId: `pkt_${input.telemetry.message_id}`,
    sourceAddress: input.sourceAddress,
    targetAddress: input.targetAddress,
    payload: encodedPayload,
    radio: {
      frequencyHz: config.radio.frequencyHz,
      bandwidthHz: config.radio.bandwidthHz,
      spreadingFactor: config.radio.spreadingFactor,
      codingRate: config.radio.codingRate,
      powerDbm: config.radio.txPowerDbm,
      rangeMeters: config.radio.maxRangeMeters
    },
    meta: {
      timestamp: input.simulationTimeMs,
      requiresAck: false,
      retries: 0
    }
  }
}

function runtimeTelemetryToLoRaTelemetry(
  telemetry: RuntimeTelemetryPayload,
  sourceNumericAddress: number
): TelemetryPayloadV1 {
  let sensorFlags = 0
  const payload: TelemetryPayloadV1 = {
    schemaVersion: 1,
    messageId:
      telemetry.message_id ||
      `sim-${sourceNumericAddress}-${telemetry.sequence}-${Math.floor(telemetry.timestamp / 1000)}`,
    sequence: telemetry.sequence,
    measuredAtUnix: Math.max(0, Math.floor(telemetry.timestamp / 1000)),
    sensorFlags
  }

  const airTemperature = telemetry.sensors.air_temperature
  if (typeof airTemperature === 'number') {
    sensorFlags |= TelemetrySensorFlags.AIR_TEMPERATURE
    payload.airTempCentiC = Math.round(airTemperature * 100)
  }

  const airHumidity = telemetry.sensors.air_humidity
  if (typeof airHumidity === 'number') {
    sensorFlags |= TelemetrySensorFlags.AIR_HUMIDITY
    payload.airHumidityCentiPct = Math.round(airHumidity * 100)
  }

  const soilTemperature = telemetry.sensors.soil_temperature
  if (typeof soilTemperature === 'number') {
    sensorFlags |= TelemetrySensorFlags.SOIL_TEMPERATURE
    payload.soilTempCentiC = Math.round(soilTemperature * 100)
  }

  const soilMoisture = telemetry.sensors.soil_moisture
  if (typeof soilMoisture === 'number') {
    sensorFlags |= TelemetrySensorFlags.SOIL_MOISTURE
    payload.soilMoistureCentiPct = Math.round(soilMoisture * 100)
  }

  const co2ppm = telemetry.sensors.co2
  if (typeof co2ppm === 'number') {
    sensorFlags |= TelemetrySensorFlags.CO2
    payload.co2ppm = Math.round(co2ppm)
  }

  if (typeof telemetry.battery === 'number') {
    sensorFlags |= TelemetrySensorFlags.BATTERY
    payload.batteryPermille = Math.max(0, Math.min(1000, Math.round(telemetry.battery * 10)))
  }

  payload.sensorFlags = sensorFlags
  return payload
}
