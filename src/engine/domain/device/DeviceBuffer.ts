export type MessageBuffer<T> = {
  capacity: number
  queue: T[]
}