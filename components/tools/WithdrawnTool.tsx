import Link from 'next/link'
import styles from './ToolWorkspace.module.css'

export default function WithdrawnTool({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={compact ? styles.withdrawnCompact : styles.withdrawn}>
      <p>Withdrawn</p>
      <h1>{label} is off the bench</h1>
      <span>An admin closed this instrument. It stays out of the library until they open it again.</span>
      <Link href="/">Back to the tools</Link>
    </div>
  )
}
