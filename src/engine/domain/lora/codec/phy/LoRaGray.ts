export function binaryToGray(value: number): number {
  return value ^ (value >>> 1)
}

export function grayToBinary(value: number): number {
  let binary = value

  for (let shift = 1; shift < 32; shift <<= 1) {
    binary ^= binary >>> shift
  }

  return binary >>> 0
}

export function bitsToSymbols(bits: readonly number[], spreadingFactor: number): number[] {
  const symbols: number[] = []
  const maxSymbolValue = 2 ** spreadingFactor

  for (let offset = 0; offset < bits.length; offset += spreadingFactor) {
    let value = 0

    for (let bit = 0; bit < spreadingFactor; bit += 1) {
      value |= (bits[offset + bit] ?? 0) << bit
    }

    const symbol = binaryToGray(value)

    if (symbol < 0 || symbol >= maxSymbolValue) {
      throw new Error(`LoRa symbol is out of range: ${symbol}`)
    }

    symbols.push(symbol)
  }

  return symbols
}

export function symbolsToBits(symbols: readonly number[], spreadingFactor: number): number[] {
  const bits: number[] = []
  const maxSymbolValue = 2 ** spreadingFactor

  for (const symbol of symbols) {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= maxSymbolValue) {
      throw new Error(`LoRa symbol is out of range: ${symbol}`)
    }

    const value = grayToBinary(symbol)

    for (let bit = 0; bit < spreadingFactor; bit += 1) {
      bits.push((value >>> bit) & 1)
    }
  }

  return bits
}
