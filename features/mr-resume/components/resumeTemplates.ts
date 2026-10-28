export type ResumeTemplate = {
  id: string
  name: string
  detail: string
  purpose: 'Resume' | 'Academic CV' | 'Biodata' | 'Statement of purpose'
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
    purpose: 'Resume', font: 'Hind Siliguri', fullName,
    enabled: ['profile', 'summary', 'experience', 'education', 'skills', 'projects', 'languages', 'references'],
    content: {
      profile, education, experience, skills, languages, references,
      summary: '[\u09aa\u09c7\u09b6\u09be\u0997\u09a4 \u09aa\u09b0\u09bf\u099a\u09af\u09bc]\n\u09ae\u09c2\u09b2 \u09a6\u0995\u09cd\u09b7\u09a4\u09be: [\u0986\u09aa\u09a8\u09be\u09b0 \u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u09a6\u0995\u09cd\u09b7\u09a4\u09be]\n\u09b2\u0995\u09cd\u09b7\u09cd\u09af: [\u098f\u0987 \u09aa\u09a6\u09c7 \u09af\u09c7 \u0985\u09ac\u09a6\u09be\u09a8 \u09b0\u09be\u0996\u09a4\u09c7 \u099a\u09be\u09a8]',
      projects: '[\u09aa\u09cd\u09b0\u0995\u09b2\u09cd\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae]\n\u09ad\u09c2\u09ae\u09bf\u0995\u09be: [\u0986\u09aa\u09a8\u09be\u09b0 \u09ad\u09c2\u09ae\u09bf\u0995\u09be]\n- [\u0995\u09be\u099c \u0993 \u09ac\u09be\u09b8\u09cd\u09a4\u09ac \u09ab\u09b2\u09be\u09ab\u09b2]',
    },
  },
  {
    id: 'government-biodata', name: 'Government Biodata', detail: 'General outline; follow the vacancy notice, not an official form.',
    purpose: 'Biodata', font: 'Noto Sans Bengali', fullName,
    enabled: ['profile', 'education', 'experience', 'skills', 'personal'],
    content: {
      profile: `${profile}\n\u0986\u09ac\u09c7\u09a6\u09a8\u09c7\u09b0 \u09aa\u09a6: [\u09aa\u09a6\u09c7\u09b0 \u09a8\u09be\u09ae]`,
      education, experience, skills,
      personal: '\u09b6\u09c1\u09a7\u09c1 \u09ac\u09bf\u099c\u09cd\u099e\u09aa\u09cd\u09a4\u09bf\u09a4\u09c7 \u099a\u09be\u0993\u09af\u09bc\u09be \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09a4\u09a5\u09cd\u09af \u09af\u09c1\u0995\u09cd\u09a4 \u0995\u09b0\u09c1\u09a8\u0964\n[\u09ac\u09bf\u099c\u09cd\u099e\u09aa\u09cd\u09a4\u09bf \u0985\u09a8\u09c1\u09af\u09be\u09af\u09bc\u09c0 \u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09a4\u09a5\u09cd\u09af]\n[\u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09cd\u09af \u09a8\u09be \u09b9\u09b2\u09c7 \u098f\u0987 \u0985\u0982\u09b6 \u09ac\u09be\u09a6 \u09a6\u09bf\u09a8]',
    },
  },
  {
    id: 'teacher-cv', name: 'Teacher CV', detail: 'Teaching practice, academic preparation and references.',
    purpose: 'Academic CV', font: 'Noto Serif Bengali', fullName,
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
    purpose: 'Resume', font: 'Anek Bangla', fullName,
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
    purpose: 'Resume', font: 'Hind Siliguri', fullName,
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
    purpose: 'Academic CV', font: 'Noto Serif Bengali', fullName,
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
    purpose: 'Biodata', font: 'Tiro Bangla', fullName,
    enabled: ['profile', 'personal', 'education', 'skills', 'languages'],
    content: {
      profile, education, skills, languages,
      personal: '[\u09a8\u09bf\u099c\u09c7\u09b0 \u09aa\u09b0\u09bf\u099a\u09af\u09bc]\n\u0986\u0997\u09cd\u09b0\u09b9: [\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u0986\u0997\u09cd\u09b0\u09b9]\n[\u09af\u09c7 \u09aa\u09cd\u09b0\u09be\u09b8\u0999\u09cd\u0997\u09bf\u0995 \u09aa\u09be\u09b0\u09bf\u09ac\u09be\u09b0\u09bf\u0995 \u09a4\u09a5\u09cd\u09af \u09a6\u09bf\u09a4\u09c7 \u099a\u09be\u09a8]\n[\u09b6\u09c1\u09a7\u09c1 \u09aa\u09cd\u09b0\u09af\u09cb\u099c\u09a8\u09c0\u09af\u09bc \u0993 \u09b8\u09cd\u09ac\u09c7\u099a\u09cd\u099b\u09be\u09af\u09bc \u09a6\u09c7\u0993\u09af\u09bc\u09be \u09a4\u09a5\u09cd\u09af]',
    },
  },
  {
    id: 'admission-sop', name: 'Admission SOP', detail: 'A writing scaffold connecting preparation, programme choice and goals.',
    purpose: 'Statement of purpose', font: 'Noto Serif Bengali', fullName,
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
const latexTitles = {
  profile: 'Profile',
  summary: 'Summary',
  experience: 'Experience',
  skills: 'Core Technical Skills',
  projects: 'Projects',
  education: 'Education',
  publications: 'Publications',
  references: 'References',
} as const

export const resumeTemplates = [
  ...baseTemplates,
  {
    id: 'latex-classic', name: 'LaTeX Classic', detail: 'A TeX-set resume: Latin Modern type, thin heading rules and edge-aligned entry dates.',
    purpose: 'Resume', font: 'Latin Modern', language: 'English', fullName: '[Your full name]',
    accentColor: '#3159a8', rulesUnderHeadings: true, titles: latexTitles,
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
