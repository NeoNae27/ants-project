export class BinaryReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset
  }

  get position(): number {
    return this.offset
  }

  readU8(): number {
    this.ensureAvailable(1)
    const value = this.bytes[this.offset]
    this.offset += 1
    return value
  }

  readU16LE(): number {
    this.ensureAvailable(2)
    const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8)
    this.offset += 2
    return value >>> 0
  }

  readI16LE(): number {
    const value = this.readU16LE()
    return value & 0x8000 ? value - 0x10000 : value
  }

  readU32LE(): number {
    this.ensureAvailable(4)
    const value =
      this.bytes[this.offset] |
      (this.bytes[this.offset + 1] << 8) |
      (this.bytes[this.offset + 2] << 16) |
      (this.bytes[this.offset + 3] << 24)
    this.offset += 4
    return value >>> 0
  }

  readBytes(length: number): Uint8Array {
    this.ensureAvailable(length)
    const value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  private ensureAvailable(length: number): void {
    if (this.offset + length > this.bytes.length) {
      throw new Error('BinaryReader out of bounds')
    }
  }
}
