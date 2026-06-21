const DEFAULT_WHITENING_SEED = 0x1ff

export class LoRaWhitening {
  static whiten(bits: readonly number[], seed = DEFAULT_WHITENING_SEED): number[] {
    return this.apply(bits, seed)
  }

  static dewhiten(bits: readonly number[], seed = DEFAULT_WHITENING_SEED): number[] {
    return this.apply(bits, seed)
  }

  private static apply(bits: readonly number[], seed: number): number[] {
    let state = seed & 0x1ff
    const output: number[] = []

    for (const bit of bits) {
      const prbsBit = ((state >> 4) ^ (state >> 8)) & 1
      output.push((bit ^ prbsBit) & 1)
      state = ((state << 1) | prbsBit) & 0x1ff

      if (state === 0) {
        state = DEFAULT_WHITENING_SEED
      }
    }

    return output
  }
}
