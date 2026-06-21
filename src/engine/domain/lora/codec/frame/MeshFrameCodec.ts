import { BinaryReader, BinaryWriter, Crc16, concatBytes } from '../bytes'
import { FrameCodecError } from './FrameCodecError'
import { type MeshFrame } from './MeshFrameTypes'

const MESH_FRAME_HEADER_SIZE = 16
const CRC_SIZE = 2

export class MeshFrameCodec {
  encode(frame: MeshFrame): Uint8Array {
    if (frame.payload.length > 255) {
      throw new FrameCodecError(
        'Mesh frame payload is too large',
        'FRAME_PAYLOAD_TOO_LARGE',
      )
    }

    const writer = new BinaryWriter()
    writer.writeU8(frame.version)
    writer.writeU16LE(frame.src)
    writer.writeU16LE(frame.dst)
    writer.writeU16LE(frame.nextHop)
    writer.writeU16LE(frame.prevHop)
    writer.writeU16LE(frame.seq)
    writer.writeU8(frame.ttl)
    writer.writeU8(frame.hopCount)
    writer.writeU8(frame.type)
    writer.writeU8(frame.flags)
    writer.writeU8(frame.payload.length)
    writer.writeBytes(frame.payload)

    const body = writer.toUint8Array()
    const crcWriter = new BinaryWriter()
    crcWriter.writeU16LE(Crc16.ccittFalse(body))

    return concatBytes(body, crcWriter.toUint8Array())
  }

  decode(bytes: Uint8Array): MeshFrame {
    if (bytes.length < MESH_FRAME_HEADER_SIZE + CRC_SIZE) {
      throw new FrameCodecError('Mesh frame is too short', 'FRAME_TOO_SHORT')
    }

    const body = bytes.slice(0, bytes.length - CRC_SIZE)
    const expectedCrc = Crc16.ccittFalse(body)
    const actualCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)

    if (expectedCrc !== actualCrc) {
      throw new FrameCodecError('Mesh frame CRC verification failed', 'FRAME_CRC_FAILED')
    }

    const reader = new BinaryReader(body)
    const version = reader.readU8()

    if (version !== 1) {
      throw new FrameCodecError(
        `Unsupported mesh frame version: ${version}`,
        'FRAME_VERSION_UNSUPPORTED',
      )
    }

    const src = reader.readU16LE()
    const dst = reader.readU16LE()
    const nextHop = reader.readU16LE()
    const prevHop = reader.readU16LE()
    const seq = reader.readU16LE()
    const ttl = reader.readU8()
    const hopCount = reader.readU8()
    const type = reader.readU8() as MeshFrame['type']
    const flags = reader.readU8()
    const payloadLength = reader.readU8()

    if (reader.remaining !== payloadLength) {
      throw new FrameCodecError(
        'Mesh frame payload length does not match byte length',
        'FRAME_PAYLOAD_LENGTH_INVALID',
      )
    }

    return {
      version,
      src,
      dst,
      nextHop,
      prevHop,
      seq,
      ttl,
      hopCount,
      type,
      flags,
      payload: reader.readBytes(payloadLength),
    }
  }
}
