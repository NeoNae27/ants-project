import { BinaryReader, BinaryWriter, Crc16, concatBytes } from '../bytes'
import {
  TelemetrySensorFlags,
  type DecodedTelemetryPayloadV1,
  type TelemetryPayloadV1,
} from './TelemetryPayloadTypes'

export class TelemetryPayloadCodecError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TELEMETRY_PAYLOAD_TOO_SHORT'
      | 'TELEMETRY_SCHEMA_UNSUPPORTED'
      | 'TELEMETRY_FIELD_MISSING'
      | 'TELEMETRY_APP_CRC_FAILED'
      | 'TELEMETRY_TRAILING_BYTES',
  ) {
    super(message)
    this.name = 'TelemetryPayloadCodecError'
  }
}

export class TelemetryPayloadCodec {
  encode(payload: TelemetryPayloadV1): Uint8Array {
    if (payload.schemaVersion !== 1) {
      throw new TelemetryPayloadCodecError(
        `Unsupported telemetry schema: ${payload.schemaVersion}`,
        'TELEMETRY_SCHEMA_UNSUPPORTED',
      )
    }

    const writer = new BinaryWriter()

    writer.writeU8(payload.schemaVersion)
    writer.writeU32LE(payload.sequence)
    writer.writeU32LE(payload.measuredAtUnix)
    writer.writeU16LE(payload.sensorFlags)

    this.writeFlaggedI16(
      writer,
      payload,
      TelemetrySensorFlags.AIR_TEMPERATURE,
      'airTempCentiC',
    )
    this.writeFlaggedU16(
      writer,
      payload,
      TelemetrySensorFlags.AIR_HUMIDITY,
      'airHumidityCentiPct',
    )
    this.writeFlaggedI16(
      writer,
      payload,
      TelemetrySensorFlags.SOIL_TEMPERATURE,
      'soilTempCentiC',
    )
    this.writeFlaggedU16(
      writer,
      payload,
      TelemetrySensorFlags.SOIL_MOISTURE,
      'soilMoistureCentiPct',
    )
    this.writeFlaggedU16(writer, payload, TelemetrySensorFlags.CO2, 'co2ppm')
    this.writeFlaggedU16(
      writer,
      payload,
      TelemetrySensorFlags.BATTERY,
      'batteryPermille',
    )

    const body = writer.toUint8Array()
    const crc = Crc16.ccittFalse(body)
    const crcWriter = new BinaryWriter()
    crcWriter.writeU16LE(crc)

    return concatBytes(body, crcWriter.toUint8Array())
  }

  decode(bytes: Uint8Array): DecodedTelemetryPayloadV1 {
    if (bytes.length < 13) {
      throw new TelemetryPayloadCodecError(
        'Telemetry payload is too short',
        'TELEMETRY_PAYLOAD_TOO_SHORT',
      )
    }

    const body = bytes.slice(0, bytes.length - 2)
    const expectedCrc = Crc16.ccittFalse(body)
    const actualCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)

    if (expectedCrc !== actualCrc) {
      throw new TelemetryPayloadCodecError(
        'Telemetry app CRC verification failed',
        'TELEMETRY_APP_CRC_FAILED',
      )
    }

    const reader = new BinaryReader(body)
    const schemaVersion = reader.readU8()

    if (schemaVersion !== 1) {
      throw new TelemetryPayloadCodecError(
        `Unsupported telemetry schema: ${schemaVersion}`,
        'TELEMETRY_SCHEMA_UNSUPPORTED',
      )
    }

    const payload: DecodedTelemetryPayloadV1 = {
      schemaVersion,
      sequence: reader.readU32LE(),
      measuredAtUnix: reader.readU32LE(),
      sensorFlags: reader.readU16LE(),
    }

    this.readFlaggedI16(
      reader,
      payload,
      TelemetrySensorFlags.AIR_TEMPERATURE,
      'airTempCentiC',
    )
    this.readFlaggedU16(
      reader,
      payload,
      TelemetrySensorFlags.AIR_HUMIDITY,
      'airHumidityCentiPct',
    )
    this.readFlaggedI16(
      reader,
      payload,
      TelemetrySensorFlags.SOIL_TEMPERATURE,
      'soilTempCentiC',
    )
    this.readFlaggedU16(
      reader,
      payload,
      TelemetrySensorFlags.SOIL_MOISTURE,
      'soilMoistureCentiPct',
    )
    this.readFlaggedU16(reader, payload, TelemetrySensorFlags.CO2, 'co2ppm')
    this.readFlaggedU16(
      reader,
      payload,
      TelemetrySensorFlags.BATTERY,
      'batteryPermille',
    )

    if (reader.remaining !== 0) {
      throw new TelemetryPayloadCodecError(
        'Telemetry payload has trailing bytes',
        'TELEMETRY_TRAILING_BYTES',
      )
    }

    return payload
  }

  calculateSize(payload: TelemetryPayloadV1): number {
    return this.encode(payload).length
  }

  private writeFlaggedI16(
    writer: BinaryWriter,
    payload: TelemetryPayloadV1,
    flag: number,
    field: keyof Pick<TelemetryPayloadV1, 'airTempCentiC' | 'soilTempCentiC'>,
  ): void {
    if ((payload.sensorFlags & flag) === 0) {
      return
    }

    const value = payload[field]

    if (typeof value !== 'number') {
      throw new TelemetryPayloadCodecError(
        `Telemetry field is missing: ${field}`,
        'TELEMETRY_FIELD_MISSING',
      )
    }

    writer.writeI16LE(value)
  }

  private writeFlaggedU16(
    writer: BinaryWriter,
    payload: TelemetryPayloadV1,
    flag: number,
    field: keyof Pick<
      TelemetryPayloadV1,
      'airHumidityCentiPct' | 'soilMoistureCentiPct' | 'co2ppm' | 'batteryPermille'
    >,
  ): void {
    if ((payload.sensorFlags & flag) === 0) {
      return
    }

    const value = payload[field]

    if (typeof value !== 'number') {
      throw new TelemetryPayloadCodecError(
        `Telemetry field is missing: ${field}`,
        'TELEMETRY_FIELD_MISSING',
      )
    }

    writer.writeU16LE(value)
  }

  private readFlaggedI16(
    reader: BinaryReader,
    payload: DecodedTelemetryPayloadV1,
    flag: number,
    field: keyof Pick<DecodedTelemetryPayloadV1, 'airTempCentiC' | 'soilTempCentiC'>,
  ): void {
    if ((payload.sensorFlags & flag) !== 0) {
      payload[field] = reader.readI16LE()
    }
  }

  private readFlaggedU16(
    reader: BinaryReader,
    payload: DecodedTelemetryPayloadV1,
    flag: number,
    field: keyof Pick<
      DecodedTelemetryPayloadV1,
      'airHumidityCentiPct' | 'soilMoistureCentiPct' | 'co2ppm' | 'batteryPermille'
    >,
  ): void {
    if ((payload.sensorFlags & flag) !== 0) {
      payload[field] = reader.readU16LE()
    }
  }
}
