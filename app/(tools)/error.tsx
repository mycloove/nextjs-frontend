'use client'

import Link from 'next/link'

export default function ToolsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}><section style={{ maxWidth: 460, textAlign: 'center' }}><h1>Tool unavailable</h1><p>This tool encountered an unexpected problem. Your other mycloove tools remain available.</p><button onClick={reset}>Try again</button><p><Link href="/#tools">Browse other tools</Link></p></section></main>
}
