export type DeviceValidationIssue = {
  code: string
  message: string
  path?: string
  severity: 'info' | 'warning' | 'error'
}

export type DeviceValidationResult = {
  valid: boolean
  issues: DeviceValidationIssue[]
}