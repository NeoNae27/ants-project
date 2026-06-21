import { BinaryReader, BinaryWriter, Crc16, concatBytes } from '../bytes'
import type { DecodedLoRaPingPayloadV1, LoRaPingPayloadV1 } from './LoRaPingPayloadTypes'

export class LoRaPingPayloadCodecError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PING_PAYLOAD_TOO_SHORT'
      | 'PING_SCHEMA_UNSUPPORTED'
      | 'PING_APP_CRC_FAILED'
      | 'PING_TRAILING_BYTES',
  ) {
    super(message)
    this.name = 'LoRaPingPayloadCodecError'
  }
}

export class LoRaPingPayloadCodec {
  encode(payload: LoRaPingPayloadV1): Uint8Array {
    if (payload.schemaVersion !== 1) {
      throw new LoRaPingPayloadCodecError(
        `Unsupported PING schema: ${payload.schemaVersion}`,
        'PING_SCHEMA_UNSUPPORTED',
      )
    }

    const writer = new BinaryWriter()
    writer.writeU8(payload.schemaVersion)
    writer.writeU32LE(payload.sequence)
    writer.writeU32LE(payload.sentAtUnix)

    const body = writer.toUint8Array()
    const crcWriter = new BinaryWriter()
    crcWriter.writeU16LE(Crc16.ccittFalse(body))

    return concatBytes(body, crcWriter.toUint8Array())
  }

  decode(bytes: Uint8Array): DecodedLoRaPingPayloadV1 {
    if (bytes.length < 11) {
      throw new LoRaPingPayloadCodecError('PING payload is too short', 'PING_PAYLOAD_TOO_SHORT')
    }

    const body = bytes.slice(0, bytes.length - 2)
    const expectedCrc = Crc16.ccittFalse(body)
    const actualCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)

    if (expectedCrc !== actualCrc) {
      throw new LoRaPingPayloadCodecError('PING CRC verification failed', 'PING_APP_CRC_FAILED')
    }

    const reader = new BinaryReader(body)
    const schemaVersion = reader.readU8()

    if (schemaVersion !== 1) {
      throw new LoRaPingPayloadCodecError(
        `Unsupported PING schema: ${schemaVersion}`,
        'PING_SCHEMA_UNSUPPORTED',
      )
    }

    const payload: DecodedLoRaPingPayloadV1 = {
      schemaVersion,
      sequence: reader.readU32LE(),
      sentAtUnix: reader.readU32LE(),
    }

    if (reader.remaining !== 0) {
      throw new LoRaPingPayloadCodecError('PING payload has trailing bytes', 'PING_TRAILING_BYTES')
    }

    return payload
  }
}
