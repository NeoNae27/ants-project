export function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []

  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit += 1) {
      bits.push((byte >>> bit) & 1)
    }
  }

  return bits
}

export function bitsToBytes(bits: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8))

  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] !== 0) {
      bytes[Math.floor(index / 8)] |= 1 << index % 8
    }
  }

  return bytes
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
