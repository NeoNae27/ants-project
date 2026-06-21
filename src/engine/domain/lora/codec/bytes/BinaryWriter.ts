export class BinaryWriter {
  private readonly bytes: number[] = []

  writeU8(value: number): void {
    this.bytes.push(value & 0xff)
  }

  writeU16LE(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
  }

  writeI16LE(value: number): void {
    this.writeU16LE(value & 0xffff)
  }

  writeU32LE(value: number): void {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    )
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.writeU8(byte)
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}
