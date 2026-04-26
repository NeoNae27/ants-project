/**
 * DeviceValidationIssue описывает одну проблему валидации устройства.
 *
 * Такой формат удобен для UI, логов и тестов:
 * можно показать code, message, path и severity отдельно.
 */
export type DeviceValidationIssue = {
  /**
   * Машиночитаемый код ошибки или предупреждения.
   */
  code: string

  /**
   * Человекочитаемое описание проблемы.
   */
  message: string

  /**
   * Опциональный путь к полю, где найдена проблема.
   */
  path?: string

  /**
   * Важность проблемы.
   */
  severity: 'info' | 'warning' | 'error'
}

/**
 * DeviceValidationResult — результат проверки устройства.
 */
export type DeviceValidationResult = {
  /**
   * true, если среди issues нет ошибок уровня error.
   */
  valid: boolean

  /**
   * Все найденные проблемы и предупреждения.
   */
  issues: DeviceValidationIssue[]
}
