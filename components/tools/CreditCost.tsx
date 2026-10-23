'use client'

import { useEffect } from 'react'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import { listenCreditQuotes } from '@/lib/usage/credit-client'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import styles from './CreditCost.module.css'

type Props = { toolId: string; creditState?: CreditBalanceState }

function Readout({ toolId, state }: { toolId: string; state: CreditBalanceState }) {
  useEffect(() => listenCreditQuotes(state.snapshot), [state.snapshot])
  const snapshot = state.snapshot
  if (!snapshot && state.status === 'loading') return null
  if (snapshot?.prices[toolId]?.enabled === false) return null
  if (snapshot?.mode === 'legacy' || snapshot?.mode === 'unmetered') return null
  if (!snapshot || state.status === 'error' || snapshot.mode === 'unavailable') {
    return <div className={styles.readout}><span>{state.status === 'loading' ? 'Checking credits' : 'Credit price unavailable'}</span>
      {state.status === 'error' && <button type="button" onClick={state.refresh}>Retry</button>}</div>
  }
  const price = snapshot.prices[toolId]
  if (!price) return <div className={styles.readout}><span>Credit price unavailable</span><button type="button" onClick={state.refresh}>Retry</button></div>
  const enough = (snapshot.available ?? 0) >= price.cost
  return <div className={`${styles.readout} ${enough ? '' : styles.insufficient}`}>
    <span><b>{price.cost === 0 ? 'Free' : `${price.cost} credit${price.cost === 1 ? '' : 's'}`}</b>{price.cost > 0 && ' per successful action'}</span>
    {!enough && <span>Needs {price.cost}; {snapshot.available} available</span>}
    {state.refreshing && <span>Updating</span>}
  </div>
}

function OwnReadout({ toolId }: { toolId: string }) {
  const account = useAccountViewer()
  const credits = useCreditBalance(account.status === 'loading' ? null : account.viewer?.id ?? 'guest')
  return <Readout toolId={toolId} state={credits} />
}

export default function CreditCost({ toolId, creditState }: Props) {
  return creditState ? <Readout toolId={toolId} state={creditState} /> : <OwnReadout toolId={toolId} />
}
