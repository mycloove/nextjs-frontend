import {
  accountGlyph, activityGlyph, aboutGlyph, appearanceGlyph,
  connectionsGlyph, editorGlyph, securityGlyph, shortcutsGlyph,
} from './icons'
import type { SettingsContext, SettingsSectionGroup, SettingsSectionSpec } from './settingsContext'
import { SECTION_GROUP_ORDER } from './settingsContext'
import IdentitySection from './sections/IdentitySection'
import SecuritySection from './sections/SecuritySection'
import ActivitySection from './sections/ActivitySection'
import WorkspaceAppearanceSection from './sections/WorkspaceAppearanceSection'
import EditorDefaultsSection from './sections/EditorDefaultsSection'
import ShortcutsSection from './sections/ShortcutsSection'
import ConnectionsSection from './sections/ConnectionsSection'
import AboutSection from './sections/AboutSection'

/**
 * The single source of truth for what the console shows.
 *
 * Adding a section is one entry in this array — the shell reads `group`, `order`
 * and `visible`, and renders `render(ctx)`. It owns no navigation logic of its
 * own, so new sections (Notifications, Billing, Language…) never touch the
 * console's shell.
 *
 * `visible` is the guest rule: an account that is signed out can still configure
 * the workspace (Appearance, Editor, Shortcuts, Connections, About) and Identity
 * shows a sign-in gate, but Security and Activity have nothing truthful to show
 * and are hidden rather than rendered empty.
 */
export const SECTION_SPECS: SettingsSectionSpec[] = [
  {
    id: 'identity',
    label: 'Identity',
    group: 'Account',
    order: 1,
    icon: accountGlyph,
    render: (ctx) => <IdentitySection ctx={ctx} />,
  },
  {
    id: 'security',
    label: 'Security',
    group: 'Account',
    order: 2,
    icon: securityGlyph,
    visible: (ctx) => Boolean(ctx.viewer),
    render: (ctx) => <SecuritySection ctx={ctx} />,
  },
  {
    id: 'activity',
    label: 'Activity',
    group: 'Account',
    order: 3,
    icon: activityGlyph,
    visible: (ctx) => Boolean(ctx.viewer),
    render: (ctx) => <ActivitySection ctx={ctx} />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    group: 'Workspace',
    order: 1,
    icon: appearanceGlyph,
    render: (ctx) => <WorkspaceAppearanceSection ctx={ctx} />,
  },
  {
    id: 'editor',
    label: 'Editor',
    group: 'Workspace',
    order: 2,
    icon: editorGlyph,
    render: (ctx) => <EditorDefaultsSection ctx={ctx} />,
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    group: 'Workspace',
    order: 3,
    icon: shortcutsGlyph,
    render: () => <ShortcutsSection />,
  },
  {
    id: 'about',
    label: 'About',
    group: 'Workspace',
    order: 4,
    icon: aboutGlyph,
    render: () => <AboutSection />,
  },
  {
    id: 'connections',
    label: 'Connections',
    group: 'Connections',
    order: 1,
    icon: connectionsGlyph,
    // Connections needs the identity (a connection is bound to an account), so it
    // reads the shared `SettingsContext` like the Account panes do.
    render: (ctx) => <ConnectionsSection ctx={ctx} />,
  },
]

export type SectionGroup = { group: SettingsSectionGroup; specs: SettingsSectionSpec[] }

/** Visible sections, grouped and ordered for the nav rail. */
export function visibleSectionGroups(ctx: SettingsContext): SectionGroup[] {
  return SECTION_GROUP_ORDER.map((group) => ({
    group,
    specs: SECTION_SPECS
      .filter((spec) => spec.group === group && (spec.visible ? spec.visible(ctx) : true))
      .sort((a, b) => a.order - b.order),
  })).filter((entry) => entry.specs.length > 0)
}
