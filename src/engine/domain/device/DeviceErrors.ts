/**
 * DeviceDomainError — доменная ошибка устройства.
 *
 * code нужен, чтобы UI, тесты и сервисы могли реагировать на ошибку
 * без парсинга человекочитаемого message.
 */
export class DeviceDomainError extends Error {
  constructor(
    message: string,
    /**
     * Машиночитаемый код доменной ошибки.
     */
    public readonly code: string
  ) {
    super(message)
    this.name = 'DeviceDomainError'
  }
}
