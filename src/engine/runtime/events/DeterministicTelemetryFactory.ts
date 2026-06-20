import type { RuntimeTelemetryPayload } from './RuntimeEventPayloads'

export type DeterministicTelemetryInput = {
  deviceId: string
  simulationTimeMs: number
  sequence?: number
}

export function createDeterministicTelemetry(
  input: DeterministicTelemetryInput
): RuntimeTelemetryPayload {
  const deviceSeed = stableStringHash(input.deviceId)
  const sequence = input.sequence ?? Math.floor(input.simulationTimeMs / 1000)

  return {
    schema_version: '1.0',
    message_id: `sim_${input.deviceId}_${sequence}`,
    sequence,
    source: 'simulator',
    device_id: input.deviceId,
    timestamp: input.simulationTimeMs,
    battery: 100,
    sensors: {
      air_temperature: 20 + (deviceSeed % 5),
      air_humidity: 60 + (sequence % 10),
      soil_temperature: 12 + (deviceSeed % 3),
      soil_moisture: 40 + (sequence % 5),
      co2: 430 + (deviceSeed % 20)
    },
    link: {
      hops: 1
    }
  }
}

function stableStringHash(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash
}
