export type DeviceMeta = {
  createdAt: number
  updatedAt: number

  location?: {
    x?: number
    y?: number
    lat?: number
    lon?: number
  }

  tags?: string[]
  description?: string
}