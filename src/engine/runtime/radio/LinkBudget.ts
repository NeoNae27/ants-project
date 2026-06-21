export type LinkBudgetInput = {
  txPowerDbm: number
  txAntennaGainDb?: number
  rxAntennaGainDb?: number
  pathLossDb: number
  additionalLossDb?: number
  rxSensitivityDbm: number
}

export type LinkBudgetResult = {
  rxPowerDbm: number
  linkMarginDb: number
}

export function calculateLinkBudget(input: LinkBudgetInput): LinkBudgetResult {
  const rxPowerDbm =
    input.txPowerDbm +
    (input.txAntennaGainDb ?? 0) +
    (input.rxAntennaGainDb ?? 0) -
    input.pathLossDb -
    (input.additionalLossDb ?? 0)

  return {
    rxPowerDbm,
    linkMarginDb: rxPowerDbm - input.rxSensitivityDbm
  }
}
