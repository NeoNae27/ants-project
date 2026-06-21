import { BinaryReader, BinaryWriter, Crc16, concatBytes } from '../bytes'
import { FrameCodecError } from './FrameCodecError'
import { type DirectFrame } from './DirectFrameTypes'

const DIRECT_FRAME_HEADER_SIZE = 10
const CRC_SIZE = 2

export class DirectFrameCodec {
  encode(frame: DirectFrame): Uint8Array {
    if (frame.payload.length > 255) {
      throw new FrameCodecError(
        'Direct frame payload is too large',
        'FRAME_PAYLOAD_TOO_LARGE',
      )
    }

    const writer = new BinaryWriter()
    writer.writeU8(frame.version)
    writer.writeU16LE(frame.src)
    writer.writeU16LE(frame.dst)
    writer.writeU16LE(frame.seq)
    writer.writeU8(frame.type)
    writer.writeU8(frame.flags)
    writer.writeU8(frame.payload.length)
    writer.writeBytes(frame.payload)

    const body = writer.toUint8Array()
    const crcWriter = new BinaryWriter()
    crcWriter.writeU16LE(Crc16.ccittFalse(body))

    return concatBytes(body, crcWriter.toUint8Array())
  }

  decode(bytes: Uint8Array): DirectFrame {
    if (bytes.length < DIRECT_FRAME_HEADER_SIZE + CRC_SIZE) {
      throw new FrameCodecError('Direct frame is too short', 'FRAME_TOO_SHORT')
    }

    const body = bytes.slice(0, bytes.length - CRC_SIZE)
    const expectedCrc = Crc16.ccittFalse(body)
    const actualCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)

    if (expectedCrc !== actualCrc) {
      throw new FrameCodecError('Direct frame CRC verification failed', 'FRAME_CRC_FAILED')
    }

    const reader = new BinaryReader(body)
    const version = reader.readU8()

    if (version !== 1) {
      throw new FrameCodecError(
        `Unsupported direct frame version: ${version}`,
        'FRAME_VERSION_UNSUPPORTED',
      )
    }

    const src = reader.readU16LE()
    const dst = reader.readU16LE()
    const seq = reader.readU16LE()
    const type = reader.readU8() as DirectFrame['type']
    const flags = reader.readU8()
    const payloadLength = reader.readU8()

    if (reader.remaining !== payloadLength) {
      throw new FrameCodecError(
        'Direct frame payload length does not match byte length',
        'FRAME_PAYLOAD_LENGTH_INVALID',
      )
    }

    return {
      version,
      src,
      dst,
      seq,
      type,
      flags,
      payload: reader.readBytes(payloadLength),
    }
  }
}
