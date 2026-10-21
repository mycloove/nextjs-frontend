'use client'

import KineticSphere from '@/components/KineticSphere'

/**
 * The dock's one inline loader: the same kinetic sphere a busy button uses, with
 * a plain label, for the states that are not attached to a button ("Checking the
 * connection…", "Listing the repository…", "reading…").
 *
 * It replaces the old CSS pulsing dot so the whole surface shows exactly one
 * loader — and because the sphere has no depth cue, it stays honestly
 * indeterminate: no percentage is ever invented for work GitHub is doing.
 */
export default function InlineLoader({ label, className = '' }: { label: string; className?: string }) {
  return (
    <p className={`mr-cfg-gh-inline-loader ${className}`.trim()} role="status">
      <KineticSphere className="mr-cfg-gh-sphere" size={16} points={48} dot={0.85} />
      <span>{label}</span>
    </p>
  )
}
