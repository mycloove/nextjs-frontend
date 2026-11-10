import type { ResumeLayoutId } from './resumeLayouts.ts'

export type ResumeTemplate = {
  id: string
  name: string
  detail: string
  purpose: 'Resume' | 'Academic CV' | 'Biodata' | 'Statement of purpose' | 'Cover letter'
  font: string
  enabled: readonly string[]
  fullName: string
  content: Readonly<Record<string, string>>
  /** English presets write their own placeholders; existing Bengali presets stay
   *  untranslated (undefined = Bengali, banglishMode on). */
  language?: 'English'
  /** Per-section heading overrides; undefined keeps the catalog titles. */
  titles?: Readonly<Record<string, string>>
  /** A custom accent preset applied on applyTemplate; undefined keeps accents[0]. */
  accentColor?: string
  /** Thin rule beneath every section heading, as the LaTeX-look template sets. */
  rulesUnderHeadings?: boolean
  /** The page arrangement this template is designed for (resumeLayouts.ts). */
  layout: ResumeLayoutId
  profileAlign?: 'left' | 'center' | 'right'
  /** Typographic settings the layout needs; undefined keeps the shared defaults. */
  settings?: { fontSize?: number; leading?: number; sectionGap?: number; margin?: number }
}

const fullName = '[\u0986\u09aa\u09a8\u09be\u09b0 \u09aa\u09c2\u09b0\u09cd\u09a3 \u09a8\u09be\u09ae]'
const profile = [
  '\u09aa\u09c7\u09b6\u09be \u09ac\u09be \u09b2\u0995\u09cd\u09b7\u09cd\u09af: [\u09aa\u09c7\u09b6\u09be \u0985\u09a5\u09ac\u09be \u0986\u09ac\u09c7\u09a6\u09a8\u09c7\u09b0 \u09b2\u0995\u09cd\u09b7\u09cd\u09af]',
  '\u09a0\u09bf\u0995\u09be\u09a8\u09be: [\u09af\u09cb\u0997\u09be\u09af\u09cb\u0997\u09c7\u09b0 \u09a0\u09bf\u0995\u09be\u09a8\u09be]',
  '\u0987\u09ae\u09c7\u0987\u09b2: [\u0986\u09aa\u09a8\u09be\u09b0 \u0987\u09ae\u09c7\u0987\u09b2]',
  '\u09ab\u09cb\u09a8: [\u0986\u09aa\u09a8\u09be\u09b0 \u09ab\u09cb\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0]',
].join('\n')
const education = [
  '\u09aa\u09b0\u09c0\u0995\u09cd\u09b7\u09be \u09ac\u09be \u09a1\u09bf\u0997\u09cd\u09b0\u09bf: [\u09aa\u09b0\u09c0\u0995\u09cd\u09b7\u09be \u09ac\u09be \u09a1\u09bf\u0997\u09cd\u09b0\u09bf\u09b0 \u09a8\u09be\u09ae]',
  '\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8: [\u09b6\u09bf\u0995\u09cd\u09b7\u09be\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8\u09c7\u09b0 \u09a8\u09be\u09ae]',
  '\u09ac\u09bf\u09b7\u09af\u09bc: [\u09ac\u09bf\u09b7\u09af\u09bc\u09c7\u09b0 \u09a8\u09be\u09ae]',
  '\u09b8\u09ae\u09af\u09bc\u0995\u09be\u09b2: [\u09b6\u09c1\u09b0\u09c1 \u0993 \u09b6\u09c7\u09b7\u09c7\u09b0 \u09b8\u09ae\u09af\u09bc]',
  '\u09ab\u09b2\u09be\u09ab\u09b2: [\u09b8\u09a8\u09a6 \u0985\u09a8\u09c1\u09af\u09be\u09af\u09bc\u09c0 \u09ab\u09b2\u09be\u09ab\u09b2, \u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09cd\u09af \u09b9\u09b2\u09c7]',
].join('\n')
const experience = '[\u09aa\u09a6\u09c7\u09b0 \u09a8\u09be\u09ae] | [\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8\u09c7\u09b0 \u09a8\u09be\u09ae]\n[\u0995\u09b0\u09cd\u09ae\u0995\u09be\u09b2]\n- [\u09aa\u09cd\u09b0\u09a7\u09be\u09a8 \u09a6\u09be\u09af\u09bc\u09bf\u09a4\u09cd\u09ac]\n- [\u0995\u09be\u099c\u09c7\u09b0 \u09ab\u09b2\u09be\u09ab\u09b2 \u0993 \u09aa\u09cd\u09b0\u09ae\u09be\u09a3, \u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09cd\u09af \u09b9\u09b2\u09c7]'
const skills = '- [\u09aa\u09a6\u09c7\u09b0 \u09b8\u0999\u09cd\u0997\u09c7 \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09a6\u0995\u09cd\u09b7\u09a4\u09be]\n- [\u09ac\u09be\u09b8\u09cd\u09a4\u09ac\u09c7 \u09ac\u09cd\u09af\u09ac\u09b9\u09c3\u09a4 \u099f\u09c1\u09b2 \u09ac\u09be \u09aa\u09a6\u09cd\u09a7\u09a4\u09bf]'
const languages = '[\u09ad\u09be\u09b7\u09be\u09b0 \u09a8\u09be\u09ae]: [\u0986\u09aa\u09a8\u09be\u09b0 \u09a6\u0995\u09cd\u09b7\u09a4\u09be\u09b0 \u09b8\u09cd\u09a4\u09b0]\n[\u0985\u09a8\u09cd\u09af \u09ad\u09be\u09b7\u09be\u09b0 \u09a8\u09be\u09ae]: [\u09a6\u0995\u09cd\u09b7\u09a4\u09be\u09b0 \u09b8\u09cd\u09a4\u09b0, \u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09cd\u09af \u09b9\u09b2\u09c7]'
const references = '[\u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09a8\u09c7\u0993\u09af\u09bc\u09be \u09b0\u09c7\u09ab\u09be\u09b0\u09c7\u09a8\u09cd\u09b8\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09aa\u09a6\u09ac\u09bf \u0993 \u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8: [\u09aa\u09a6\u09ac\u09bf \u0993 \u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8]\n\u09af\u09cb\u0997\u09be\u09af\u09cb\u0997: [\u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09a8\u09bf\u09af\u09bc\u09c7 \u09a6\u09c7\u0993\u09af\u09bc\u09be \u09af\u09cb\u0997\u09be\u09af\u09cb\u0997]'
const awards = '[\u09aa\u09c1\u09b0\u09b8\u09cd\u0995\u09be\u09b0 \u09ac\u09be \u09b8\u09cd\u09ac\u09c0\u0995\u09c3\u09a4\u09bf\u09b0 \u09a8\u09be\u09ae, \u09a5\u09be\u0995\u09b2\u09c7]\n\u09aa\u09cd\u09b0\u09a6\u09be\u09a8\u0995\u09be\u09b0\u09c0: [\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8\u09c7\u09b0 \u09a8\u09be\u09ae]\n[\u09b8\u09cd\u09ac\u09c0\u0995\u09c3\u09a4\u09bf\u09b0 \u0995\u09be\u09b0\u09a3]'

// Data only. Applying a template, removing inapplicable sections and autosaving
// remain explicit caller decisions; none of these placeholders assert a fact.
const baseTemplates = [
  {
    id: 'job-resume', name: 'Job Resume', detail: 'Relevant work, skills and evidence for a specific job.',
    purpose: 'Resume', font: 'Hind Siliguri', fullName, layout: 'classic',
    enabled: ['profile', 'summary', 'experience', 'education', 'skills', 'projects', 'languages', 'references'],
    content: {
      profile, education, experience, skills, languages, references,
      summary: '[\u09aa\u09c7\u09b6\u09be\u0997\u09a4 \u09aa\u09b0\u09bf\u099a\u09af\u09bc]\n\u09ae\u09c2\u09b2 \u09a6\u0995\u09cd\u09b7\u09a4\u09be: [\u0986\u09aa\u09a8\u09be\u09b0 \u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u09a6\u0995\u09cd\u09b7\u09a4\u09be]\n\u09b2\u0995\u09cd\u09b7\u09cd\u09af: [\u098f\u0987 \u09aa\u09a6\u09c7 \u09af\u09c7 \u0985\u09ac\u09a6\u09be\u09a8 \u09b0\u09be\u0996\u09a4\u09c7 \u099a\u09be\u09a8]',
      projects: '[\u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09ad\u09c2\u09ae\u09bf\u0995\u09be: [\u0986\u09aa\u09a8\u09be\u09b0 \u09ad\u09c2\u09ae\u09bf\u0995\u09be]\n- [\u0995\u09be\u099c \u0993 \u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u09ab\u09b2\u09be\u09ab\u09b2]',
    },
  },
  {
    id: 'government-biodata', name: 'Government Biodata', detail: 'General outline; follow the vacancy notice, not an official form.',
    purpose: 'Biodata', font: 'Noto Sans Bengali', fullName, layout: 'biodata',
    enabled: ['profile', 'education', 'experience', 'skills', 'personal'],
    content: {
      profile: `${profile}\n\u0986\u09ac\u09c7\u09a6\u09a8\u09c7\u09b0 \u09aa\u09a6: [\u09aa\u09a6\u09c7\u09b0 \u09a8\u09be\u09ae]`,
      education, experience, skills,
      personal: '\u09b6\u09c1\u09a7\u09c1 \u09ac\u09bf\u099c\u09cd\u099e\u09aa\u09cd\u09a4\u09bf\u09a4\u09c7 \u099a\u09be\u0993\u09af\u09bc\u09be \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09a4\u09a5\u09cd\u09af \u09af\u09c1\u0995\u09cd\u09a4 \u0995\u09b0\u09c1\u09a8\u0964\n[\u09ac\u09bf\u099c\u09cd\u099e\u09aa\u09cd\u09a4\u09bf \u0985\u09a8\u09c1\u09af\u09be\u09af\u09bc\u09c0 \u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09a4\u09a5\u09cd\u09af]\n[\u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09cd\u09af \u09a8\u09be \u09b9\u09b2\u09c7 \u098f\u0987 \u0985\u0982\u09b6 \u09ac\u09be\u09a6 \u09a6\u09bf\u09a8]',
    },
  },
  {
    id: 'teacher-cv', name: 'Teacher CV', detail: 'Teaching practice, academic preparation and references.',
    purpose: 'Academic CV', font: 'Noto Serif Bengali', fullName, layout: 'executive',
    enabled: ['profile', 'summary', 'education', 'experience', 'skills', 'awards', 'references'],
    content: {
      profile, education, awards, references,
      summary: '[\u09b6\u09bf\u0995\u09cd\u09b7\u09be\u09a6\u09be\u09a8\u09c7\u09b0 \u09ac\u09bf\u09b7\u09af\u09bc \u0993 \u09b8\u09cd\u09a4\u09b0]\n\u09b6\u09bf\u0995\u09cd\u09b7\u09a3 \u09aa\u09a6\u09cd\u09a7\u09a4\u09bf: [\u09ac\u09cd\u09af\u09ac\u09b9\u09c3\u09a4 \u09aa\u09a6\u09cd\u09a7\u09a4\u09bf]\n\u0986\u0997\u09cd\u09b0\u09b9: [\u09b6\u09bf\u0995\u09cd\u09b7\u09be\u09b0\u09cd\u09a5\u09c0\u09a6\u09c7\u09b0 \u09b8\u09b9\u09be\u09af\u09bc\u09a4\u09be\u09b0 \u09b2\u0995\u09cd\u09b7\u09cd\u09af]',
      experience: '[\u09b6\u09bf\u0995\u09cd\u09b7\u0995\u09a4\u09be\u09b0 \u09aa\u09a6]\n[\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8 \u0993 \u0995\u09b0\u09cd\u09ae\u0995\u09be\u09b2]\n- [\u09aa\u09a1\u09bc\u09be\u09a8\u09cb\u09b0 \u09ac\u09bf\u09b7\u09af\u09bc \u0993 \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf]\n- [\u09aa\u09be\u09a0 \u09aa\u09b0\u09bf\u0995\u09b2\u09cd\u09aa\u09a8\u09be \u0993 \u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8\u09c7\u09b0 \u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u0995\u09be\u099c]',
      skills: '- [\u09aa\u09be\u09a0 \u09aa\u09b0\u09bf\u0995\u09b2\u09cd\u09aa\u09a8\u09be\u09b0 \u09a6\u0995\u09cd\u09b7\u09a4\u09be]\n- [\u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8 \u0993 \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf \u09aa\u09b0\u09bf\u099a\u09be\u09b2\u09a8\u09be\u09b0 \u09a6\u0995\u09cd\u09b7\u09a4\u09be]',
    },
  },
  {
    id: 'engineering-cv', name: 'Engineering CV', detail: 'Technical methods, project responsibilities and verifiable work.',
    purpose: 'Resume', font: 'Anek Bangla', fullName, layout: 'ledger',
    enabled: ['profile', 'summary', 'skills', 'projects', 'experience', 'education', 'references'],
    content: {
      profile, education, experience, references,
      summary: '[\u09aa\u09cd\u09b0\u0995\u09cc\u09b6\u09b2 \u09b6\u09be\u0996\u09be \u09ac\u09be \u09ac\u09bf\u09b6\u09c7\u09b7\u09a4\u09cd\u09ac]\n\u0986\u0997\u09cd\u09b0\u09b9: [\u09af\u09c7 \u09b8\u09ae\u09b8\u09cd\u09af\u09be \u09b8\u09ae\u09be\u09a7\u09be\u09a8\u09c7 \u0995\u09be\u099c \u0995\u09b0\u09a4\u09c7 \u099a\u09be\u09a8]',
      skills: '- [\u09ac\u09bf\u09b6\u09cd\u09b2\u09c7\u09b7\u09a3 \u09ac\u09be \u09a8\u0995\u09b6\u09be\u09b0 \u09aa\u09a6\u09cd\u09a7\u09a4\u09bf]\n- [\u09ac\u09cd\u09af\u09ac\u09b9\u09c3\u09a4 \u09aa\u09cd\u09b0\u09af\u09c1\u0995\u09cd\u09a4\u09bf \u09ac\u09be \u09af\u09a8\u09cd\u09a4\u09cd\u09b0]\n- [\u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09a8\u09bf\u09b0\u09be\u09aa\u09a4\u09cd\u09a4\u09be \u0985\u09a8\u09c1\u09b6\u09c0\u09b2\u09a8]',
      projects: '[\u09aa\u09cd\u09b0\u0995\u09cc\u09b6\u09b2 \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09b8\u09ae\u09b8\u09cd\u09af\u09be: [\u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09b8\u09ae\u09b8\u09cd\u09af\u09be \u0993 \u09b8\u09c0\u09ae\u09be]\n- [\u0986\u09aa\u09a8\u09be\u09b0 \u09a6\u09be\u09af\u09bc\u09bf\u09a4\u09cd\u09ac \u0993 \u09aa\u09a6\u09cd\u09a7\u09a4\u09bf]\n- [\u09af\u09be\u099a\u09be\u0987\u09af\u09cb\u0997\u09cd\u09af \u09ab\u09b2\u09be\u09ab\u09b2]',
    },
  },
  {
    id: 'fresh-graduate', name: 'Fresh Graduate', detail: 'Learning, coursework and practical work without invented experience.',
    purpose: 'Resume', font: 'Hind Siliguri', fullName, layout: 'classic',
    enabled: ['profile', 'summary', 'education', 'projects', 'skills', 'volunteer', 'languages'],
    content: {
      profile, education, languages,
      summary: '[\u09b6\u09bf\u0995\u09cd\u09b7\u09be\u0997\u09a4 \u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09bf]\n\u0986\u0997\u09cd\u09b0\u09b9: [\u09aa\u09cd\u09b0\u09a5\u09ae \u0995\u09be\u099c \u09ac\u09be \u0987\u09a8\u09cd\u099f\u09be\u09b0\u09cd\u09a8\u09b6\u09bf\u09aa\u09c7\u09b0 \u09b2\u0995\u09cd\u09b7\u09cd\u09af]',
      projects: '[\u09aa\u09be\u09a0\u0995\u09cd\u09b0\u09ae \u09ac\u09be \u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u0995\u09be\u099c: [\u0986\u09aa\u09a8\u09be\u09b0 \u0985\u0982\u09b6]\n- [\u09b6\u09c7\u0996\u09be \u09ac\u09bf\u09b7\u09af\u09bc \u0993 \u09aa\u09cd\u09b0\u09a6\u09b0\u09cd\u09b6\u09a8\u09af\u09cb\u0997\u09cd\u09af \u09ab\u09b2\u09be\u09ab\u09b2]',
      skills: '- [\u0985\u09b0\u09cd\u099c\u09bf\u09a4 \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09a6\u0995\u09cd\u09b7\u09a4\u09be]\n- [\u09af\u09be \u0995\u09be\u099c \u0995\u09b0\u09c7 \u09a6\u09c7\u0996\u09be\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u09a8]',
      volunteer: '[\u09b8\u09cd\u09ac\u09c7\u099a\u09cd\u099b\u09be\u09b8\u09c7\u09ac\u09c0 \u0995\u09be\u099c, \u09a5\u09be\u0995\u09b2\u09c7]\n\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8: [\u09b8\u0982\u0997\u09a0\u09a8\u09c7\u09b0 \u09a8\u09be\u09ae]\n- [\u09a8\u09bf\u099c\u09c7\u09b0 \u09a6\u09be\u09af\u09bc\u09bf\u09a4\u09cd\u09ac \u0993 \u0985\u09ac\u09a6\u09be\u09a8]',
    },
  },
  {
    id: 'academic-research-cv', name: 'Academic Research CV', detail: 'Research questions, methods and accurately labelled publication status.',
    purpose: 'Academic CV', font: 'Noto Serif Bengali', fullName, layout: 'ledger',
    enabled: ['profile', 'summary', 'education', 'projects', 'publications', 'experience', 'awards', 'references'],
    content: {
      profile, education, awards, references,
      summary: '[\u0997\u09ac\u09c7\u09b7\u09a3\u09be\u09b0 \u0995\u09cd\u09b7\u09c7\u09a4\u09cd\u09b0]\n\u09aa\u09cd\u09b0\u09b6\u09cd\u09a8: [\u0997\u09ac\u09c7\u09b7\u09a3\u09be\u09b0 \u09aa\u09cd\u09b0\u09b6\u09cd\u09a8]\n\u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09bf: [\u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09b6\u09bf\u0995\u09cd\u09b7\u09be \u0993 \u0995\u09be\u099c]',
      projects: '[\u0997\u09ac\u09c7\u09b7\u09a3\u09be \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09aa\u09a6\u09cd\u09a7\u09a4\u09bf: [\u09aa\u09a6\u09cd\u09a7\u09a4\u09bf \u0993 \u0986\u09aa\u09a8\u09be\u09b0 \u09ad\u09c2\u09ae\u09bf\u0995\u09be]\n- [\u09af\u09be\u099a\u09be\u0987\u09af\u09cb\u0997\u09cd\u09af \u09ab\u09b2\u09be\u09ab\u09b2 \u09ac\u09be \u0995\u09be\u099c\u09c7\u09b0 \u09ac\u09b0\u09cd\u09a4\u09ae\u09be\u09a8 \u0985\u09ac\u09b8\u09cd\u09a5\u09be]',
      publications: '[\u0997\u09ac\u09c7\u09b7\u09a3\u09be\u09aa\u09a4\u09cd\u09b0\u09c7\u09b0 \u09b6\u09bf\u09b0\u09cb\u09a8\u09be\u09ae, \u09a5\u09be\u0995\u09b2\u09c7]\n\u09b2\u09c7\u0996\u0995: [\u09b2\u09c7\u0996\u0995\u09a6\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09aa\u09cd\u09b0\u0995\u09be\u09b6\u09a8\u09be: [\u099c\u09be\u09b0\u09cd\u09a8\u09be\u09b2 \u09ac\u09be \u09b8\u09ae\u09cd\u09ae\u09c7\u09b2\u09a8\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u0985\u09ac\u09b8\u09cd\u09a5\u09be: [\u09aa\u09cd\u09b0\u0995\u09be\u09b6\u09bf\u09a4, \u0997\u09c3\u09b9\u09c0\u09a4 \u09ac\u09be \u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09be\u09a7\u09c0\u09a8]\n\u09b8\u09c2\u09a4\u09cd\u09b0: [\u09b8\u09a0\u09bf\u0995 \u0989\u09a6\u09cd\u09a7\u09c3\u09a4\u09bf \u09ac\u09be \u09b2\u09bf\u0982\u0995]',
      experience: '[\u0997\u09ac\u09c7\u09b7\u09a3\u09be \u09ac\u09be \u09b6\u09bf\u0995\u09cd\u09b7\u09be\u0997\u09a4 \u0995\u09be\u099c\u09c7\u09b0 \u09aa\u09a6]\n[\u09aa\u09cd\u09b0\u09a4\u09bf\u09b7\u09cd\u09a0\u09be\u09a8 \u0993 \u0995\u09b0\u09cd\u09ae\u0995\u09be\u09b2]\n- [\u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u09a6\u09be\u09af\u09bc\u09bf\u09a4\u09cd\u09ac]',
    },
  },
  {
    id: 'personal-biodata', name: 'Personal Biodata', detail: 'A personal introduction with only relevant, voluntarily shared details.',
    purpose: 'Biodata', font: 'Tiro Bangla', fullName, layout: 'biodata',
    enabled: ['profile', 'personal', 'education', 'skills', 'languages'],
    content: {
      profile, education, skills, languages,
      personal: '[\u09a8\u09bf\u099c\u09c7\u09b0 \u09aa\u09b0\u09bf\u099a\u09af\u09bc]\n\u0986\u0997\u09cd\u09b0\u09b9: [\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u0986\u0997\u09cd\u09b0\u09b9]\n[\u09af\u09c7 \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09aa\u09be\u09b0\u09bf\u09ac\u09be\u09b0\u09bf\u0995 \u09a4\u09a5\u09cd\u09af \u09a6\u09bf\u09a4\u09c7 \u099a\u09be\u09a8]\n[\u09b6\u09c1\u09a7\u09c1 \u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09a8\u09c0\u09af\u09bc \u0993 \u09b8\u09cd\u09ac\u09c7\u099a\u09cd\u099b\u09be\u09af\u09bc \u09a6\u09c7\u0993\u09af\u09bc\u09be \u09a4\u09a5\u09cd\u09af]',
    },
  },
  {
    id: 'admission-sop', name: 'Admission SOP', detail: 'A writing scaffold connecting preparation, programme choice and goals.',
    purpose: 'Statement of purpose', font: 'Noto Serif Bengali', fullName, layout: 'classic',
    enabled: ['profile', 'education', 'motivation', 'projects'],
    content: {
      profile, education,
      motivation: '\u0986\u09ae\u09bf [\u09aa\u09cd\u09b0\u09cb\u0997\u09cd\u09b0\u09be\u09ae \u0993 \u09ac\u09bf\u09b7\u09af\u09bc\u09c7\u09b0 \u09a8\u09be\u09ae]-\u098f \u09aa\u09a1\u09bc\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u0986\u09ac\u09c7\u09a6\u09a8 \u0995\u09b0\u099b\u09bf\u0964\n\n[\u09aa\u09c2\u09b0\u09cd\u09ac\u09ac\u09b0\u09cd\u09a4\u09c0 \u09b6\u09bf\u0995\u09cd\u09b7\u09be \u09ac\u09be \u0995\u09be\u099c \u0995\u09c0\u09ad\u09be\u09ac\u09c7 \u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09bf \u09a6\u09bf\u09af\u09bc\u09c7\u099b\u09c7 \u09a4\u09be \u09b2\u09bf\u0996\u09c1\u09a8]\n\n\u098f\u0987 \u09aa\u09cd\u09b0\u09cb\u0997\u09cd\u09b0\u09be\u09ae \u09ac\u09c7\u099b\u09c7 \u09a8\u09c7\u0993\u09af\u09bc\u09be\u09b0 \u0995\u09be\u09b0\u09a3: [\u09aa\u09be\u09a0\u0995\u09cd\u09b0\u09ae \u09ac\u09be \u0997\u09ac\u09c7\u09b7\u09a3\u09be\u09b0 \u09b8\u0999\u09cd\u0997\u09c7 \u09a8\u09bf\u099c\u09c7\u09b0 \u09b2\u0995\u09cd\u09b7\u09cd\u09af \u09ae\u09bf\u09b2\u09bf\u09af\u09bc\u09c7 \u09b2\u09bf\u0996\u09c1\u09a8]\n\n\u09ad\u09ac\u09bf\u09b7\u09cd\u09af\u09ce \u09b2\u0995\u09cd\u09b7\u09cd\u09af: [\u0985\u09a7\u09cd\u09af\u09af\u09bc\u09a8\u09c7\u09b0 \u09aa\u09b0 \u0995\u09c0 \u0995\u09be\u099c\u09c7 \u0985\u09ac\u09a6\u09be\u09a8 \u09b0\u09be\u0996\u09a4\u09c7 \u099a\u09be\u09a8]',
      projects: '[\u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u0995\u09be\u099c \u09ac\u09be \u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa]\n- [\u09aa\u09cd\u09b0\u09cb\u0997\u09cd\u09b0\u09be\u09ae\u09c7\u09b0 \u099c\u09a8\u09cd\u09af \u09aa\u09cd\u09b0\u09b8\u09cd\u09a4\u09c1\u09a4\u09bf\u09b0 \u09aa\u09cd\u09b0\u09ae\u09be\u09a3]\n- [\u098f\u0987 \u0995\u09be\u099c \u09a5\u09c7\u0995\u09c7 \u09b6\u09c7\u0996\u09be \u09ac\u09bf\u09b7\u09af\u09bc]',
    },
  },
] as const satisfies readonly ResumeTemplate[]

// The LaTeX-look preset reproducing the reference document's register: Latin
// Modern (the family TeX itself sets), thin rules beneath each heading and the
// `left | right` entry convention for dates and credentials. No placeholder
// asserts a fact — every bracket is something the user replaces or deletes, the
// profile links only demonstrate the schemes that earn contact glyphs, and
// dates stay bracket text so nothing invented can read as a fact. Bengali
// falling through Noto Sans Bengali keeps any language's writing readable.
const latexProfile = [
  '[Your full name]',
  '[Your professional title]',
  '[Email address](mailto:you@yourmail.test)',
  '[Phone number](tel:+8801XXXXXXXXX)',
  '[LinkedIn profile](https://www.linkedin.test/in/your-handle)',
  '[GitHub or portfolio](https://github.test/your-handle)',
].join('\n')
const latexExperience = [
  '**[Job title]** [Employer name] | [Start month year – Present]',
  '[Shortest one-line summary of scope, if applicable]',
  '- [Main responsibility]',
  '- [Verifiable outcome or evidence, if any]',
].join('\n')
const latexSkills = [
  '- [Language or framework] — [how you used it]',
  '- [Tool or practice] — [where it applies]',
].join('\n')
const latexProjects = [
  '**[Project name]** [Repository or live link](https://gitprobe.test/your-handle/your-project) | [Year]',
  '[One-line problem and scope]',
  '- [Your role and method]',
  '- [Observable result, if any]',
].join('\n')
const latexEducation = [
  '**[Degree name]** [Institution name] | [End year]',
  'Subject: [Subject or concentration]',
  'Result: [Result per your comfort, if any]',
].join('\n')
const latexAwards = [
  '**[Award or recognition name]** [Issuer name] | [Year]',
  '- [Reason for the recognition]',
].join('\n')
const latexPublications = [
  '**[Paper title]** [Author listing as printed] | [Year]',
  'Venue: [Journal or conference name]',
  'Status: [Published, under review or preprint]',
  '[Correct permanent link, if any](https://doi.test/your-handle)',
].join('\n')
const latexReferences = [
  '**[Reference name]** [Position, organisation] | [Contact line if permitted]',
  '[How they know your work]',
].join('\n')
const latexVolunteer = [
  '**[Role]** [Organisation name] | [Period]',
  '- [Your contribution]',
].join('\n')
const latexSummary = [
  '[One or two-sentence professional summary]',
  'Core strengths: [Your actual strengths]',
  'Target: [The role you want to contribute to]',
].join('\n')
// Every enabled heading is authored here — a template that overrides titles
// must speak its full set, or fallback headings leak into its register.
const latexTitles = {
  profile: 'Profile',
  summary: 'Summary',
  experience: 'Experience',
  skills: 'Core Technical Skills',
  projects: 'Projects',
  education: 'Education',
  volunteer: 'Volunteering',
  awards: 'Awards',
  publications: 'Publications',
  references: 'References',
} as const

// English scaffolds for the professional gallery. Same honesty rule as above:
// every bracket names what to write; nothing reads as a fact about anyone.
const enProfile = [
  '[Your professional title] | [City, country]',
  '[Email address](mailto:you@yourmail.test)',
  '[Phone number](tel:+8801XXXXXXXXX)',
  '[LinkedIn profile](https://www.linkedin.test/in/your-handle)',
].join('\n')
const enPortfolioProfile = [
  '[Your professional title] | [City, country]',
  '[Email address](mailto:you@yourmail.test)',
  '[Portfolio link](https://portfolio.test/your-handle)',
  '[Phone number](tel:+8801XXXXXXXXX)',
].join('\n')
const enTechProfile = [
  '[Your professional title] | [City, country]',
  '[Email address](mailto:you@yourmail.test)',
  '[GitHub profile](https://github.test/your-handle)',
  '[LinkedIn profile](https://www.linkedin.test/in/your-handle)',
].join('\n')
const enExperience = [
  '**[Job title]** [Employer name] | [Start month year – Present]',
  '- [Main responsibility, in one line]',
  '- [Verifiable result with a number, if you have one]',
  '',
  '**[Previous job title]** [Employer name] | [Start – End]',
  '- [Responsibility or achievement]',
].join('\n')
const enEducation = [
  '**[Degree name]** [Institution name] | [Graduation year]',
  'Result: [CGPA or division, if you choose to share it]',
].join('\n')
const enSkills = [
  '- [Skill area]: [tools or methods you actually use]',
  '- [Second skill area]: [tools or methods]',
].join('\n')
const enLanguages = '[Language]: [Proficiency level]\n[Second language]: [Proficiency level]'
const enReferences = '**[Reference name]** [Position, organisation] | [Contact, with permission]\n[How they know your work]'
const enCertifications = '**[Certificate or training name]** [Issuing body] | [Year]\n- [What it qualifies you to do, if relevant]'
const enSummary = '[Two sentences: who you are professionally and the value you bring]\nFocus: [The role or field you are applying for]'

const englishTemplates = [
  {
    id: 'corporate-en', name: 'Corporate Resume', detail: 'Ruled single column for private-sector and corporate applications.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'ledger', accentColor: '#2f4a6d',
    enabled: ['profile', 'summary', 'experience', 'education', 'skills', 'awards', 'references'],
    content: { profile: enProfile, summary: enSummary, experience: enExperience, education: enEducation, skills: enSkills, awards: enCertifications, references: enReferences },
    titles: { awards: 'Certifications' },
  },
  {
    id: 'corporate-sidebar', name: 'Corporate Sidebar', detail: 'Main work history beside a tinted rail for skills and languages.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'sidebar', accentColor: '#456f77',
    enabled: ['profile', 'summary', 'experience', 'education', 'skills', 'languages', 'references'],
    content: { profile: enProfile, summary: enSummary, experience: enExperience, education: enEducation, skills: enSkills, languages: enLanguages, references: enReferences },
  },
  {
    id: 'bank-officer', name: 'Bank Officer CV', detail: 'Formal two-page CV for bank and financial-institution vacancies.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'classic', accentColor: '#405444',
    enabled: ['profile', 'summary', 'education', 'experience', 'skills', 'awards', 'languages', 'personal', 'references'],
    content: {
      profile: enProfile, summary: enSummary, experience: enExperience, skills: enSkills, languages: enLanguages, references: enReferences,
      education: '**[SSC / O level]** [Board or school] | [Year]\nResult: [GPA]\n\n**[HSC / A level]** [Board or college] | [Year]\nResult: [GPA]\n\n**[Bachelor degree]** [University] | [Year]\nResult: [CGPA]',
      awards: '**[Banking diploma or certificate]** [Institute] | [Year]\n- [Relevant training, if any]',
      personal: 'Include only what the vacancy notice asks for.\n[Requested personal detail]: [Value]',
    },
    titles: { awards: 'Professional qualifications', personal: 'Personal information' },
  },
  {
    id: 'bcs-biodata-en', name: 'BCS and Government Biodata', detail: 'English biodata outline; the vacancy notice and official forms take priority.',
    purpose: 'Biodata', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'biodata', accentColor: '#405444',
    enabled: ['profile', 'personal', 'education', 'experience', 'skills', 'languages', 'references'],
    content: {
      profile: 'Applied post: [Post name and circular reference]\n[Email address](mailto:you@yourmail.test)\n[Phone number](tel:+8801XXXXXXXXX)',
      personal: 'Add only the fields the circular requires.\n[Field named in the circular]: [Value as on your certificates]\n[Present or permanent address, if requested]: [Address]',
      education: '**[Examination]** [Board or university] | [Passing year]\nResult: [Division, GPA or CGPA]\n\n**[Next examination]** [Board or university] | [Passing year]\nResult: [Result]',
      experience: '**[Post held, if any]** [Office or organisation] | [Period]\n- [Duty related to the applied post]',
      skills: '- Computer: [Applications you can use]\n- [Other relevant skill]: [Level]',
      languages: enLanguages, references: enReferences,
    },
    titles: { personal: 'Personal information', education: 'Educational qualifications', experience: 'Experience' },
  },
  {
    id: 'fresher-en', name: 'Fresh Graduate Resume', detail: 'Coursework, projects and activities first, without invented experience.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'compact', accentColor: '#567a61',
    settings: { fontSize: 10.5, leading: 1.4, sectionGap: 16, margin: 16 },
    enabled: ['profile', 'summary', 'education', 'projects', 'skills', 'volunteer', 'languages'],
    content: {
      profile: enProfile, skills: enSkills, languages: enLanguages,
      summary: '[One sentence: your degree and the role you are seeking]\nStrengths: [Two strengths you can show evidence for]',
      education: '**[Degree name]** [Institution name] | [Graduation year]\nRelevant courses: [Course], [Course], [Course]\nResult: [CGPA, if you choose to share it]',
      projects: '**[Project or thesis title]** [Course or supervisor] | [Year]\n- [What you built or studied, and your part]\n- [Result or what you learned]',
      volunteer: '**[Club, society or internship role]** [Organisation] | [Period]\n- [What you did]',
    },
    titles: { volunteer: 'Activities and internships' },
  },
  {
    id: 'software-engineer', name: 'Software Engineer', detail: 'Dense one-page engineering resume with projects and linked work.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'compact', accentColor: '#456f77',
    settings: { fontSize: 10.5, leading: 1.4, sectionGap: 16, margin: 15 },
    enabled: ['profile', 'skills', 'experience', 'projects', 'education'],
    content: {
      profile: enTechProfile, experience: enExperience, education: enEducation,
      skills: '- Languages: [Programming languages you use]\n- Frameworks and tools: [Frameworks, databases, cloud]\n- Practices: [Testing, CI, code review, and so on]',
      projects: '**[Project name]** [Repository or live link](https://gitprobe.test/your-handle/your-project) | [Year]\n- [Problem, your role and the stack]\n- [Measured result, if any]',
    },
    titles: { skills: 'Technical skills' },
  },
  {
    id: 'school-teacher-en', name: 'School Teacher CV', detail: 'Teaching subjects, classroom practice, training and referees.',
    purpose: 'Academic CV', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'executive', accentColor: '#765a48',
    enabled: ['profile', 'summary', 'experience', 'education', 'awards', 'skills', 'references'],
    content: {
      profile: enProfile, education: enEducation, references: enReferences,
      summary: '[Subjects and levels you teach]\nApproach: [How you teach and assess]',
      experience: '**[Teaching post]** [School or college] | [Period]\n- [Classes and subjects taught]\n- [A responsibility beyond teaching, if any]',
      awards: '**[Teacher training, e.g. B.Ed]** [Institute] | [Year]\n- [Other workshop or certificate]',
      skills: '- Classroom: [Methods, lesson planning, assessment]\n- Digital: [Tools you use for teaching]',
    },
    titles: { awards: 'Training and certification' },
  },
  {
    id: 'creative-portfolio', name: 'Creative Portfolio', detail: 'A colour band header for designers, writers and media roles.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'banner', accentColor: '#6753b5',
    enabled: ['profile', 'summary', 'projects', 'experience', 'skills', 'education'],
    content: {
      profile: enPortfolioProfile, summary: enSummary, experience: enExperience, skills: enSkills, education: enEducation,
      projects: '**[Selected work title]** [Link to the piece](https://portfolio.test/your-handle/work) | [Year]\n- [Brief, your role and the outcome]\n\n**[Second piece]** [Client or publication] | [Year]\n- [What made it work]',
    },
    titles: { projects: 'Selected work' },
  },
  {
    id: 'marketing-sales', name: 'Marketing and Sales', detail: 'Two columns: results on the left, skills and education on the right.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'twocol', accentColor: '#765a48',
    enabled: ['profile', 'summary', 'experience', 'projects', 'education', 'skills', 'languages'],
    content: {
      profile: enProfile, summary: enSummary, education: enEducation, skills: enSkills, languages: enLanguages,
      experience: '**[Marketing or sales role]** [Company] | [Period]\n- [Target or campaign you owned]\n- [Result: revenue, leads or growth, if you can verify it]',
      projects: '**[Campaign name]** [Channel or market] | [Year]\n- [Goal, your part and what changed]',
    },
    titles: { projects: 'Campaigns' },
  },
  {
    id: 'executive-leader', name: 'Executive Leader', detail: 'Two-page leadership CV with a framed executive summary.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'executive', accentColor: '#2f3b52',
    settings: { margin: 22 },
    enabled: ['profile', 'summary', 'experience', 'awards', 'education', 'skills'],
    content: {
      profile: enProfile, education: enEducation, skills: enSkills,
      summary: '[Three sentences on the scale you lead: teams, budgets, markets]\nKey outcomes: [Two verifiable outcomes]',
      experience: '**[Executive title]** [Organisation] | [Period]\n- [Scope: people, budget or regions]\n- [Strategic outcome you can evidence]\n\n**[Earlier leadership title]** [Organisation] | [Period]\n- [Turnaround, launch or growth you led]',
      awards: '**[Board seat, award or recognition]** [Body] | [Year]\n- [Why it matters to this role]',
    },
    titles: { summary: 'Executive summary', awards: 'Board roles and recognition', skills: 'Leadership strengths' },
  },
  {
    id: 'ngo-development', name: 'NGO and Development', detail: 'Programme, field and donor-reporting experience for development roles.',
    purpose: 'Resume', font: 'Inter', language: 'English', fullName: '[Your full name]', layout: 'ledger', accentColor: '#567a61',
    enabled: ['profile', 'summary', 'experience', 'projects', 'education', 'skills', 'languages', 'references'],
    content: {
      profile: enProfile, summary: enSummary, education: enEducation, languages: enLanguages, references: enReferences,
      experience: '**[Programme role]** [Organisation] | [Period]\n- [Programme, area and people reached]\n- [Reporting or donor responsibility]',
      projects: '**[Project name]** [Donor or partner] | [Period]\n- [Your role in design, monitoring or evaluation]',
      skills: '- Programme: [MEAL, field coordination, reporting]\n- Tools: [Survey or data tools you use]',
    },
    titles: { projects: 'Programmes and projects' },
  },
  {
    id: 'healthcare-cv', name: 'Healthcare CV', detail: 'Registration, clinical placements and training for doctors and nurses.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'classic', accentColor: '#456f77',
    enabled: ['profile', 'summary', 'experience', 'education', 'awards', 'skills', 'references'],
    content: {
      profile: '[Your clinical title] | [City, country]\nRegistration: [Council and registration number]\n[Email address](mailto:you@yourmail.test)\n[Phone number](tel:+8801XXXXXXXXX)',
      summary: enSummary, education: enEducation, references: enReferences,
      experience: '**[Clinical post]** [Hospital or clinic] | [Period]\n- [Department and responsibilities]\n- [Procedures or duties you are competent in]',
      awards: '**[Licence, training or course]** [Issuing body] | [Year]\n- [Validity or scope, if relevant]',
      skills: '- Clinical: [Areas of competence]\n- Systems: [Records or equipment you use]',
    },
    titles: { experience: 'Clinical experience', awards: 'Licences and training' },
  },
  {
    id: 'cover-letter-en', name: 'Cover Letter', detail: 'A one-page letter that pairs with any English resume template.',
    purpose: 'Cover letter', font: 'Latin Modern', language: 'English', fullName: '[Your full name]', layout: 'classic', accentColor: '#2f4a6d',
    enabled: ['profile', 'summary', 'motivation'],
    content: {
      profile: '[Email address](mailto:you@yourmail.test)\n[Phone number](tel:+8801XXXXXXXXX)\n[City, country]',
      summary: '[Date]\n[Hiring manager name]\n[Organisation name]\n[Organisation address]',
      motivation: 'Dear [Hiring manager name],\n\n[Opening: the role you are applying for and why this organisation]\n\n[Middle: one or two examples of work that match the role]\n\n[Close: what you would bring and a request for an interview]\n\nSincerely,\n[Your full name]',
    },
    titles: { summary: 'Recipient', motivation: 'Letter' },
  },
] as const satisfies readonly ResumeTemplate[]

export const resumeTemplates = [
  ...baseTemplates,
  ...englishTemplates,
  {
    id: 'latex-classic', name: 'LaTeX Classic', detail: 'A TeX-set resume: Latin Modern type, thin heading rules and edge-aligned entry dates.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]',
    accentColor: '#3159a8', rulesUnderHeadings: true, titles: latexTitles, layout: 'ledger',
    enabled: ['profile', 'summary', 'experience', 'skills', 'projects', 'education', 'volunteer', 'awards', 'publications', 'references'],
    content: {
      profile: latexProfile,
      summary: latexSummary,
      experience: latexExperience,
      skills: latexSkills,
      projects: latexProjects,
      education: latexEducation,
      volunteer: latexVolunteer,
      awards: latexAwards,
      publications: latexPublications,
      references: latexReferences,
    },
  },
] as const satisfies readonly ResumeTemplate[]

/**
 * The preview dialog must read like the document this template will actually
 * produce. The template's own title overrides speak first (an English preset
 * never shows a Bengali heading); a template without overrides falls through
 * to the register the applied paper would use for its document language —
 * the translated headings for Bangla, the catalog headings for English.
 */
export function templateSectionTitle(
  template: ResumeTemplate | (typeof baseTemplates)[number],
  section: string,
  registers: { english: (section: string) => string; bangla: (section: string) => string },
): string {
  const override = 'titles' in template ? template.titles?.[section] : undefined
  return override ?? ('language' in template && template.language === 'English' ? registers.english : registers.bangla)(section)
}
