import { TelemetrySensorFlags, type TelemetryPayloadV1 } from './TelemetryPayloadTypes'

export type TelemetryMessageFactoryOptions = {
  sourceAddress: number
  sequenceStart?: number
  seed?: number
}

const ALL_SENSOR_FLAGS =
  TelemetrySensorFlags.AIR_TEMPERATURE |
  TelemetrySensorFlags.AIR_HUMIDITY |
  TelemetrySensorFlags.SOIL_TEMPERATURE |
  TelemetrySensorFlags.SOIL_MOISTURE |
  TelemetrySensorFlags.CO2 |
  TelemetrySensorFlags.BATTERY

export class TelemetryMessageFactory {
  private nextSequence: number
  private lastMeasuredAtUnix = 0
  private rngState: number
  private readonly deterministicBaseUnix?: number

  constructor(private readonly options: TelemetryMessageFactoryOptions) {
    this.nextSequence = options.sequenceStart ?? 1
    this.rngState =
      options.seed ??
      ((Date.now() ^ (options.sourceAddress * 2654435761)) >>> 0)
    this.deterministicBaseUnix =
      options.seed === undefined ? undefined : 1_782_060_000 + Math.abs(options.seed % 100_000)
  }

  next(): TelemetryPayloadV1 {
    const sequence = this.nextSequence
    this.nextSequence += 1

    const measuredAtUnix = this.nextMeasuredAtUnix(sequence)
    const airTempCentiC = 2100 + this.noise(-150, 150) + (sequence % 7)
    const airHumidityCentiPct = 6400 + this.noise(-500, 500) + (sequence % 11)
    const soilTempCentiC = 1250 + this.noise(-120, 120) + (sequence % 5)
    const soilMoistureCentiPct = 4100 + this.noise(-400, 400) + (sequence % 13)
    const co2ppm = 430 + this.noise(-30, 80) + (sequence % 3)
    const batteryPermille = Math.max(0, 900 - Math.max(0, sequence - 1))

    return {
      schemaVersion: 1,
      messageId: `sim-${this.options.sourceAddress}-${sequence}-${measuredAtUnix}`,
      sequence,
      measuredAtUnix,
      sensorFlags: ALL_SENSOR_FLAGS,
      airTempCentiC,
      airHumidityCentiPct,
      soilTempCentiC,
      soilMoistureCentiPct,
      co2ppm,
      batteryPermille,
    }
  }

  private nextMeasuredAtUnix(sequence: number): number {
    const candidate =
      this.deterministicBaseUnix !== undefined
        ? this.deterministicBaseUnix + (sequence - (this.options.sequenceStart ?? 1))
        : Math.floor(Date.now() / 1000)

    this.lastMeasuredAtUnix = Math.max(candidate, this.lastMeasuredAtUnix + 1)
    return this.lastMeasuredAtUnix
  }

  private noise(min: number, max: number): number {
    const span = max - min + 1
    return min + Math.floor(this.nextRandom() * span)
  }

  private nextRandom(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0
    return this.rngState / 0x1_0000_0000
  }
}
