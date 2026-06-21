export type PathLossInput = {
  distanceMeters: number
  frequencyHz: number
}

export interface PathLossModel {
  calculate(input: PathLossInput): number
}

export class FreeSpacePathLossModel implements PathLossModel {
  calculate(input: PathLossInput): number {
    const safeDistanceMeters = Math.max(input.distanceMeters, 1)
    const distanceKm = safeDistanceMeters / 1000
    const frequencyMhz = input.frequencyHz / 1_000_000

    return 32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMhz)
  }
}
