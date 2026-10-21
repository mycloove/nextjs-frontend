'use client'

import { createClient } from '@/lib/supabase/client'
import KineticSphere from '@/components/KineticSphere'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import BenchIcon, { type BenchIconName } from './BenchIcon'
import type { AppRole } from '@/lib/supabase/roles'
import styles from './bench.module.css'

/**
 * The bench spine.
 *
 * Route order is fixed by what an operator does during an incident, not by what
 * the module grew: read the state, check who can act, move an instrument, look
 * at a person, change the setup. `/admin` stays the Admins page on purpose — it
 * is the target of the home nav button, the login landing and the bench redirect,
 * so moving Admins elsewhere would silently change where every admin in the
 * product lands after signing in.
 */
const LEAVES: { href: string; label: string; icon: BenchIconName; exact?: boolean }[] = [
  { href: '/admin/overview', label: 'Overview', icon: 'overview' },
  { href: '/admin/analytics', label: 'Feature use', icon: 'usage' },
  { href: '/admin/audit', label: 'Audit log', icon: 'audit' },
  { href: '/admin', label: 'Admins', icon: 'admins', exact: true },
  { href: '/admin/tools', label: 'Tools', icon: 'tools' },
  { href: '/admin/users', label: 'Users', icon: 'accounts' },
  { href: '/admin/ai', label: 'AI Providers', icon: 'ai' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
]

function initials(email: string | null) {
  if (!email) return '?'
  const head = email.trim().charAt(0)
  return head ? head.toUpperCase() : '?'
}

export default function AdminFrame({
  email,
  role,
  children,
}: {
  email: string | null
  role: AppRole | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  /*
   * Reload every panel from the store without a browser reload.
   *
   * `router.refresh()` re-runs the server components so each page re-reads the
   * database. The client desks seed their state from the `initial*` props once
   * and would keep showing the data they mounted with, so when the refreshed
   * tree arrives the desk subtree is remounted (via `stageKey`) and picks up the
   * new props. The remount is keyed off the children prop actually changing —
   * that is the one deterministic signal the read finished, unlike a transition
   * flag React may coalesce — while the transition itself only drives the
   * busy state so the button cannot be double-fired.
   */
  const [stageKey, setStageKey] = useState(0)
  const [refreshing, startRefresh] = useTransition()
  const refreshRequested = useRef(false)
  const lastChildren = useRef(children)

  useEffect(() => {
    if (children === lastChildren.current) return
    lastChildren.current = children
    if (refreshRequested.current) {
      refreshRequested.current = false
      setStageKey((key) => key + 1)
    }
  }, [children])

  const refresh = () => {
    if (refreshing) return
    refreshRequested.current = true
    startRefresh(() => {
      router.refresh()
    })
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.replace('/login')
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className={styles.shell}>
      {/* A read, not a lock: the reload shows a hairline bar over the top of the
          bench and leaves the current readings in place until the new ones land. */}
      {refreshing ? (
        <div className={styles.refreshBar} role="progressbar" aria-label="Reloading bench data">
          <span className={styles.refreshBarFill} />
        </div>
      ) : null}
      <aside className={styles.spine}>
        <p className={styles.spineBrand}>
          {/* Brand lockup — the nameplate reads left, the product mark sits on
              the right. The mark is the blue brand artwork with its outer paper
              removed by a border flood-fill (brand-logo-premium-blue.png), so
              enclosed details like the eye survive; it is only sized by CSS,
              never recoloured and never given a backing plate. The mark and the
              sub-label are decoration, so assistive tech reads "Bench"
              alone. */}
          <span className={styles.spineBrandText}>
            <span className={styles.spineBrandName}>Bench</span>
            <span className={styles.spineBrandSub} aria-hidden="true">console</span>
          </span>
          <span className={styles.spineBrandMark} aria-hidden="true">
            <Image
              className={styles.spineBrandMarkImg}
              src="/brand-logo-premium-blue.png"
              alt=""
              width={1024}
              height={1024}
              sizes="28px"
              draggable={false}
            />
          </span>
        </p>
        <nav className={styles.spineNav} aria-label="Bench pages">
          {LEAVES.filter((leaf) => role === 'Owner' || (role === 'Operator' && leaf.href !== '/admin') || (role === 'Viewer' && ['/admin/overview', '/admin/analytics', '/admin/audit', '/admin/users', '/admin/ai', '/admin/settings'].includes(leaf.href))).map((leaf) => {
            const current = leaf.exact ? pathname === leaf.href : pathname.startsWith(leaf.href)
            return (
              <Link
                key={leaf.href}
                href={leaf.href}
                className={styles.navItem}
                aria-current={current ? 'page' : undefined}
              >
                <BenchIcon className={styles.navIcon} name={leaf.icon} />
                <span>{leaf.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className={styles.spineFoot}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(email)}
            </span>
            <span className={styles.identityText}>
              <span className={styles.identityEmail} title={email ?? undefined}>
                {email ?? 'Signed in'}
              </span>
              <span className={styles.identityRole}>{role ?? 'Admin'}</span>
            </span>
          </div>
          <div className={`${styles.cardActions} ${styles.spineActions}`}>
            <button
              type="button"
              className={styles.spineAction}
              onClick={refresh}
              disabled={refreshing}
              aria-busy={refreshing}
              aria-label="Reload every panel from the database"
            >
              {refreshing ? (
                <KineticSphere className={styles.refreshOrb} size={18} points={36} dot={0.9} />
              ) : (
                <BenchIcon className={styles.navIcon} name="refresh" />
              )}
              <span className={styles.spineActionTip} aria-hidden="true">
                {refreshing ? 'Reloading…' : 'Refresh'}
              </span>
            </button>
            <Link className={styles.spineAction} href="/" aria-label="Open the tools page">
              <BenchIcon className={styles.navIcon} name="home" />
              <span className={styles.spineActionTip} aria-hidden="true">Tools</span>
            </Link>
            <button
              type="button"
              className={styles.spineAction}
              onClick={() => void signOut()}
              disabled={signingOut}
              aria-label="Sign out of the bench"
            >
              <BenchIcon className={styles.navIcon} name="signOut" />
              <span className={styles.spineActionTip} aria-hidden="true">
                {signingOut ? 'Leaving…' : 'Sign out'}
              </span>
            </button>
          </div>
        </div>
      </aside>
      <div className={styles.stage} key={stageKey}>{children}</div>
    </div>
  )
}
