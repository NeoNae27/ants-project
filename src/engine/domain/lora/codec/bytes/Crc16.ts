export class Crc16 {
  static ccittFalse(bytes: Uint8Array): number {
    let crc = 0xffff

    for (const byte of bytes) {
      crc ^= byte << 8

      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1
        crc &= 0xffff
      }
    }

    return crc & 0xffff
  }
}
