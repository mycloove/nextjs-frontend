/**
 * A filled example for every Regular template: the page a gallery card shows,
 * and the text a guest gets only if they choose "Start with the sample text".
 *
 * resumeTemplates.ts stays what it was: bracketed prompts that assert nothing.
 * A page of brackets cannot show what a layout looks like in use, so the
 * gallery needs words on it. Those words live here, apart from the templates,
 * and they describe nobody:
 *   - every person named (the subject and, in a biodata, their parents) is
 *     invented for this file, and so is every employer, client and award-giver;
 *   - places of study and examining bodies are real institutions, because a
 *     made-up university reads as a mistake; they are named as places only;
 *   - every email is on example.com and every link on a .test host, which
 *     cannot resolve; the phone number is the product's own placeholder and a
 *     registration number is zeros marked "sample";
 *   - referees are never named: a common name beside a real institution
 *     could be taken for a real person.
 * Keys are template ids; `content` has exactly the template's enabled sections.
 */
export type ResumeSpecimen = {
  readonly fullName: string
  readonly content: Readonly<Record<string, string>>
}

const PHONE = '[+880 1700 000 000](tel:+8801700000000)'
const mail = (name: string) => `[${name}@example.com](mailto:${name}@example.com)`
const linkedIn = (handle: string) => `[linkedin.test/in/${handle}](https://www.linkedin.test/in/${handle})`
const lines = (...rows: string[]) => rows.join('\n')
const REFERENCES = 'Available on request.'
const BN_REFERENCES = 'অনুরোধ করলে রেফারেন্স দেওয়া হবে।'
const BN_PHONE = '+880 1700 000 000'

const english: Readonly<Record<string, ResumeSpecimen>> = {
  'corporate-en': {
    fullName: 'Nusrat Jahan',
    content: {
      profile: lines('Operations Executive | Dhaka, Bangladesh', mail('nusrat.jahan'), PHONE, linkedIn('nusrat-jahan')),
      summary: lines('Operations executive with five years in retail supply, known for turning scattered spreadsheets into routines a team can follow.', 'Focus: operations and process improvement roles in consumer goods.'),
      experience: lines(
        '**Operations Executive** Shapla Retail Group | March 2022 – Present',
        '- Plan weekly replenishment for 38 outlets with the purchasing and warehouse teams.',
        '- Cut stock-out days from 11 to 4 a month by introducing a shared reorder sheet.',
        '',
        '**Junior Operations Officer** Padma Home Supplies | January 2020 – February 2022',
        '- Reconciled daily delivery notes against invoices for two distribution points.',
        '- Prepared the monthly vendor performance report used in supplier reviews.',
      ),
      education: lines('**BBA in Management** University of Dhaka | 2019', 'Result: CGPA 3.52 out of 4.00'),
      skills: lines('- Operations: inventory planning, vendor follow-up, process documentation', '- Tools: Excel (pivot tables, lookups), Google Sheets, ERP order entry'),
      awards: '**Certificate in Supply Chain Fundamentals** Dhaka Business Training Institute | 2021',
      references: REFERENCES,
    },
  },
  'corporate-sidebar': {
    fullName: 'Tanvir Hasan',
    content: {
      profile: lines('Business Analyst | Chattogram, Bangladesh', mail('tanvir.hasan'), PHONE, linkedIn('tanvir-hasan')),
      summary: lines('Business analyst who turns sales and operations data into decisions managers can act on the same week.', 'Focus: analyst roles in logistics and distribution.'),
      experience: lines(
        '**Business Analyst** Meghdoot Logistics Ltd. | July 2021 – Present',
        '- Build the weekly route-cost dashboard used by six depot managers.',
        '- Found a billing gap worth Tk 1.8 million a year and worked with finance to close it.',
        '- Write requirements for the dispatch system with the software vendor.',
        '',
        '**Reporting Officer** Karnaphuli Traders | February 2019 – June 2021',
        '- Prepared monthly sales and collection reports for the regional head.',
        '- Replaced four manual spreadsheets with one checked template.',
      ),
      education: lines('**BSc in Statistics** University of Chittagong | 2018', 'Result: CGPA 3.41 out of 4.00'),
      skills: lines('- Analysis: SQL, Excel modelling, Power BI', '- Methods: requirements writing, process mapping', '- Domain: route costing, receivables'),
      languages: lines('Bangla: Native', 'English: Professional working'),
      references: REFERENCES,
    },
  },
  'bank-officer': {
    fullName: 'Farhana Akter',
    content: {
      profile: lines('Officer, General Banking | Dhaka, Bangladesh', mail('farhana.akter'), PHONE, linkedIn('farhana-akter')),
      summary: lines('Banking officer with four years in branch operations: account services, clearing and customer due diligence.', 'Focus: officer and senior officer positions in retail and SME banking.'),
      education: lines(
        '**Secondary School Certificate, Business Studies** Dhaka Board | 2011', 'Result: GPA 5.00', '',
        '**Higher Secondary Certificate, Business Studies** Dhaka Board | 2013', 'Result: GPA 4.90', '',
        '**BBA in Finance** Jahangirnagar University | 2017', 'Result: CGPA 3.61 out of 4.00', '',
        '**MBA in Finance** Jahangirnagar University | 2019', 'Result: CGPA 3.68 out of 4.00',
      ),
      experience: lines(
        '**Officer, General Banking** Sonali Delta Bank Ltd., Motijheel Branch | April 2021 – Present',
        '- Open and maintain savings, current and term deposit accounts in line with KYC rules.',
        '- Handle inward and outward clearing, pay orders and fund transfers.',
        '- Prepare the daily cash position and the month-end affairs statement with the branch manager.',
        '- Resolved 96% of front-desk complaints within the same working day in 2024.',
        '',
        '**Trainee Assistant Officer** Sonali Delta Bank Ltd., Mirpur Branch | January 2020 – March 2021',
        '- Rotated through cash, accounts and foreign remittance desks.',
        '- Verified documents for remittance payments and updated beneficiary records.',
        '',
        '**Intern** Rupali Crescent Finance | July 2019 – September 2019',
        '- Assisted loan officers with file checks for SME applicants.',
      ),
      skills: lines('- Banking: account services, clearing, remittance, KYC and AML screening', '- Systems: core banking entry, Excel, MS Word', '- Service: bilingual customer handling, complaint follow-up'),
      awards: lines('**Banking Professional Examination, Part I** The Institute of Bankers, Bangladesh | 2022', '- Completed all six papers.', '', '**Certificate in Anti-Money Laundering** Bankers Training Academy | 2021', '- Three-day course on customer due diligence and transaction monitoring.'),
      languages: lines('Bangla: Native', 'English: Professional working'),
      personal: lines("Father's name: Abdul Karim", "Mother's name: Rokeya Begum", 'Date of birth: 14 March 1995', 'Nationality: Bangladeshi', 'Permanent address: Sample Road, Savar, Dhaka'),
      references: REFERENCES,
    },
  },
  'bcs-biodata-en': {
    fullName: 'Md. Rakibul Islam',
    content: {
      profile: lines('Applied post: Assistant Director (circular reference: sample)', mail('rakibul.islam'), PHONE),
      personal: lines("Father's name: Md. Nurul Islam", "Mother's name: Rahima Begum", 'Date of birth: 2 June 1996', 'Nationality: Bangladeshi', 'Permanent address: Sample Village, Sadar, Bogura'),
      education: lines(
        '**Higher Secondary Certificate, Science** Rajshahi Board | 2014', 'Result: GPA 5.00', '',
        '**BSS in Public Administration** University of Rajshahi | 2018', 'Result: First class, CGPA 3.58 out of 4.00',
      ),
      experience: lines('**Programme Assistant** Prottasha Foundation, Bogura | March 2020 – Present', '- Keep registers and monthly returns for a rural livelihood programme.', '- Draft official letters and meeting minutes in Bangla and English.'),
      skills: '- Computer: MS Word, Excel, PowerPoint, Bangla and English typing',
      languages: lines('Bangla: Native', 'English: Good in reading, writing and speaking'),
      references: REFERENCES,
    },
  },
  'fresher-en': {
    fullName: 'Sadia Rahman',
    content: {
      profile: lines('Fresh graduate, Economics | Sylhet, Bangladesh', mail('sadia.rahman'), PHONE, linkedIn('sadia-rahman')),
      summary: lines('Economics graduate seeking an entry-level research or analyst role.', 'Strengths: careful data work and clear writing, both shown in the thesis and club work below.'),
      education: lines('**BSS in Economics** Shahjalal University of Science and Technology | 2025', 'Relevant courses: Econometrics, Development Economics, Research Methods', 'Result: CGPA 3.47 out of 4.00'),
      projects: lines(
        '**Thesis: Mobile banking use among tea-garden workers** Supervised by the Department of Economics | 2025',
        '- Surveyed 212 households in two gardens and cleaned the data in Stata.',
        '- Found that distance to an agent predicted use more strongly than income.',
        '',
        '**Course project: Price tracking of ten kitchen staples** Research Methods | 2024',
        '- Collected weekly prices from three markets for twelve weeks and charted the changes.',
      ),
      skills: lines('- Data: Excel, Stata basics, survey design', '- Writing: reports and summaries in Bangla and English', '- Office: Word, PowerPoint, Google Workspace'),
      volunteer: lines('**General Secretary** University Economics Club | 2023 – 2024', '- Organised a two-day student research fair with 40 poster entries.', '', '**Intern** Surma Valley Development Trust | June 2024 – August 2024', '- Entered and checked field survey forms for a nutrition project.'),
      languages: lines('Bangla: Native', 'English: Professional working'),
    },
  },
  'software-engineer': {
    fullName: 'Arif Chowdhury',
    content: {
      profile: lines('Software Engineer | Dhaka, Bangladesh', mail('arif.chowdhury'), '[github.test/arif-chowdhury](https://github.test/arif-chowdhury)', linkedIn('arif-chowdhury')),
      skills: lines('- Languages: TypeScript, Python, SQL', '- Frameworks and tools: React, Next.js, Node.js, PostgreSQL, Docker', '- Practices: unit and integration testing, code review, CI pipelines'),
      experience: lines(
        '**Software Engineer** Dhrubo Technologies | August 2022 – Present',
        '- Build and maintain the order-management web app used by 120 pharmacy outlets.',
        '- Cut the checkout API median response time from 480 ms to 190 ms by fixing N+1 queries.',
        '- Introduced integration tests that now gate every release.',
        '',
        '**Junior Developer** Nirjhor Softworks | July 2020 – July 2022',
        '- Developed admin dashboards in React for three client projects.',
        '- Wrote the import scripts that moved 1.2 million legacy records to PostgreSQL.',
      ),
      projects: lines(
        '**Bus-seat booking prototype** [gitprobe.test/arif-chowdhury/seat-booking](https://gitprobe.test/arif-chowdhury/seat-booking) | 2024',
        '- Seat locking with row-level database locks; React front end, Node.js API.',
        '- Load-tested to 300 concurrent bookings without a double sale.',
        '',
        '**Bangla text search library** [gitprobe.test/arif-chowdhury/bn-search](https://gitprobe.test/arif-chowdhury/bn-search) | 2023',
        '- Normalises conjuncts and vowel signs so spelling variants match.',
      ),
      education: lines('**BSc in Computer Science and Engineering** Bangladesh University of Engineering and Technology | 2020', 'Result: CGPA 3.38 out of 4.00'),
    },
  },
  'school-teacher-en': {
    fullName: 'Salma Begum',
    content: {
      profile: lines('Assistant Teacher, English | Khulna, Bangladesh', mail('salma.begum'), PHONE, linkedIn('salma-begum')),
      summary: lines('English teacher for classes six to ten, with eight years of classroom practice.', 'Approach: short daily writing tasks, pair reading, and marking that shows students the next step.'),
      experience: lines(
        '**Assistant Teacher, English** Anirban School and College, Khulna | January 2019 – Present',
        '- Teach English First and Second Paper to classes eight, nine and ten.',
        '- Lead the school debating club; the team reached the district final in 2023.',
        '- Prepare half-yearly question papers with the English department.',
        '',
        '**Junior Teacher** Rupsha Model High School | February 2016 – December 2018',
        '- Taught English and Social Science to classes six and seven.',
      ),
      education: lines('**MA in English** Khulna University | 2015', 'Result: CGPA 3.44 out of 4.00'),
      awards: lines('**Bachelor of Education (B.Ed)** Teachers Training College, Khulna | 2018', '- First class.'),
      skills: lines('- Classroom: lesson planning, continuous assessment, mixed-ability groups', '- Digital: multimedia lessons, Google Classroom, question banks in Word'),
      references: REFERENCES,
    },
  },
  'creative-portfolio': {
    fullName: 'Tania Sultana',
    content: {
      profile: lines('Graphic Designer | Dhaka, Bangladesh', mail('tania.sultana'), '[portfolio.test/tania-sultana](https://portfolio.test/tania-sultana)', PHONE),
      summary: lines('Graphic designer for print and packaging who starts from the shelf, not the screen.', 'Focus: brand and packaging design for food and lifestyle products.'),
      projects: lines(
        '**Packaging for a tea brand** [portfolio.test/tania-sultana/tea](https://portfolio.test/tania-sultana/tea) | 2024',
        '- Six-box range with a shared grid; the client reported a clearer shelf block in two retail chains.',
        '',
        '**Annual report for a rural health trust** Prottasha Foundation | 2023',
        '- 48 pages in Bangla and English; infographics drawn from the field data.',
        '',
        '**Identity for a neighbourhood bakery** Shurjomukhi Bakery | 2022',
        '- Logo, menu boards and paper bags, printed in two colours to keep costs down.',
      ),
      experience: lines(
        '**Senior Designer** Rongdhonu Studio | May 2021 – Present',
        '- Lead packaging projects from brief to press check.',
        '',
        '**Designer** Aalpona Print House | March 2018 – April 2021',
        '- Designed brochures, calendars and festival campaigns for retail clients.',
      ),
      skills: lines('- Design: packaging, editorial layout, Bangla and Latin typography', '- Tools: Illustrator, InDesign, Photoshop, Figma', '- Production: die lines, colour separation, press checks'),
      education: lines('**BFA in Graphic Design** University of Dhaka | 2017', 'Result: First class'),
    },
  },
  'marketing-sales': {
    fullName: 'Sabbir Ahmed',
    content: {
      profile: lines('Marketing and Sales Executive | Dhaka, Bangladesh', mail('sabbir.ahmed'), PHONE, linkedIn('sabbir-ahmed')),
      summary: lines('Marketing executive who plans campaigns around what the sales team can actually follow up.', 'Focus: brand and trade marketing roles in consumer goods.'),
      experience: lines(
        '**Marketing Executive** Nirjhor Foods Ltd. | April 2022 – Present',
        '- Own the trade-marketing calendar for the snacks range in Dhaka division.',
        '- Grew distributor orders by 18% in 2024 with a retailer display programme.',
        '- Brief the agency and approve creative for digital and outdoor.',
        '',
        '**Sales Officer** Padma Home Supplies | January 2020 – March 2022',
        '- Managed 140 retail accounts across Mirpur and Uttara.',
        '- Reached 104% of the annual sales target in 2021.',
      ),
      projects: lines('**Eid display campaign** 600 retail outlets, Dhaka | 2024', '- Planned stands and retailer incentives; sell-through rose 23% over the previous Eid.', '', '**Campus sampling drive** Six universities | 2023', '- 14,000 samples with a QR survey; 2,300 responses shaped the next flavour launch.'),
      education: lines('**BBA in Marketing** University of Rajshahi | 2019', 'Result: CGPA 3.36 out of 4.00'),
      skills: lines('- Marketing: campaign planning, trade promotion, agency briefs', '- Sales: account management, target tracking', '- Tools: Excel, Meta Ads Manager, Canva'),
      languages: lines('Bangla: Native', 'English: Professional working'),
    },
  },
  'executive-leader': {
    fullName: 'Mahmudul Hasan',
    content: {
      profile: lines('Chief Operating Officer | Dhaka, Bangladesh', mail('mahmudul.hasan'), PHONE, linkedIn('mahmudul-hasan')),
      summary: lines(
        'Operations leader with eighteen years in manufacturing and distribution, the last seven at executive level. Has led teams of up to 1,400 people across four plants and a national distribution network, with full responsibility for an operating budget of Tk 2.6 billion.',
        'Key outcomes: on-time delivery raised from 81% to 96% in three years; unit conversion cost reduced by 14% without a single plant closure.',
      ),
      experience: lines(
        '**Chief Operating Officer** Shapla Consumer Industries Ltd. | January 2019 – Present',
        '- Lead manufacturing, supply chain and customer service: 1,400 people, four plants, nine depots.',
        '- Raised on-time, in-full delivery from 81% to 96% by rebuilding demand planning with sales.',
        '- Commissioned the Gazipur plant four weeks ahead of schedule and 3% under budget.',
        '- Chair the monthly sales and operations review with the managing director.',
        '',
        '**General Manager, Supply Chain** Meghdoot Logistics Ltd. | March 2014 – December 2018',
        '- Ran a 260-vehicle fleet and six regional hubs serving 11,000 retail points.',
        '- Cut cost per delivered case by 12% through route redesign and backhaul contracts.',
        '- Built the first in-house driver training school, reducing accidents by 40%.',
        '',
        '**Plant Manager** Padma Home Supplies | June 2009 – February 2014',
        '- Managed a 320-person plant producing household plastics on three shifts.',
        '- Introduced daily line reviews that lifted output per shift by 17%.',
        '',
        '**Production Engineer** Karnaphuli Polymers | August 2006 – May 2009',
        '- Supervised injection-moulding lines and preventive maintenance schedules.',
      ),
      awards: lines(
        '**Independent Director** Prottasha Foundation | 2021 – Present',
        '- Advise the board on procurement and logistics for its relief programmes.',
        '',
        '**Operations Leader of the Year** Supply Chain Leaders Forum | 2023',
        '- Recognised for the delivery-performance turnaround across the depot network.',
      ),
      education: lines('**MBA, Operations Management** Institute of Business Administration, University of Dhaka | 2012', 'Result: CGPA 3.57 out of 4.00', '', '**BSc in Mechanical Engineering** Bangladesh University of Engineering and Technology | 2006', 'Result: First class'),
      skills: lines('- Strategy: multi-site operations, capital projects, sales and operations planning', '- People: succession planning, union relations, safety culture', '- Finance: operating budgets, cost-to-serve analysis, vendor contracts'),
    },
  },
  'ngo-development': {
    fullName: 'Rumana Akter',
    content: {
      profile: lines('Programme Officer | Rangpur, Bangladesh', mail('rumana.akter'), PHONE, linkedIn('rumana-akter')),
      summary: 'Programme officer with six years in livelihood and nutrition projects in northern districts.',
      experience: lines(
        '**Programme Officer** Prottasha Foundation | February 2021 – Present',
        '- Coordinate a women-led livelihood programme reaching 3,200 households in Kurigram.',
        '- Write the quarterly narrative report and contribute to donor proposals.',
        '',
        '**Field Coordinator** Teesta Community Trust | March 2019 – January 2021',
        '- Ran courtyard sessions on homestead gardening in 46 villages.',
      ),
      projects: lines('**Resilient Homesteads Project** Funded by an international partner | 2021 – 2024', '- Member of the design team; led the monitoring plan and indicator tracking.'),
      education: lines('**MSS in Sociology** Begum Rokeya University, Rangpur | 2018', 'Result: CGPA 3.49 out of 4.00'),
      skills: '- Programme: monitoring and evaluation, field coordination, reporting; KoboToolbox, Excel',
      languages: 'Bangla: Native. English: Professional working.',
      references: REFERENCES,
    },
  },
  'healthcare-cv': {
    fullName: 'Dr. Fahim Rahman',
    content: {
      profile: lines('Medical Officer | Rajshahi, Bangladesh', 'Registration: BM&DC A-00000 (sample)', mail('fahim.rahman'), PHONE),
      summary: lines('Medical officer with three years in internal medicine and emergency care at a district hospital.', 'Focus: medical officer posts with inpatient and emergency duties.'),
      experience: lines(
        '**Medical Officer, Medicine** Shurjomukhi General Hospital, Rajshahi | July 2022 – Present',
        '- Manage a 30-bed medicine ward under the consultant; daily rounds and discharge planning.',
        '- Cover the emergency room on a one-in-four night rota.',
        '- Competent in lumbar puncture, pleural tap and central line assistance.',
        '',
        '**Intern Doctor** Rajshahi Medical College Hospital | June 2021 – June 2022',
        '- Rotations in medicine, surgery, gynaecology and paediatrics.',
      ),
      education: lines('**MBBS** Rajshahi Medical College | 2021', 'Result: Passed all professional examinations at first attempt'),
      awards: lines('**Basic Life Support** Resuscitation Training Centre | 2024', '', '**Infection Prevention and Control** Directorate of Health training programme | 2023'),
      skills: lines('- Clinical: acute medicine, diabetes and hypertension follow-up, emergency triage', '- Systems: hospital information system, e-prescription entry'),
      references: REFERENCES,
    },
  },
  'cover-letter-en': {
    fullName: 'Nusrat Jahan',
    content: {
      profile: lines(mail('nusrat.jahan'), PHONE, 'Dhaka, Bangladesh'),
      summary: lines('12 November 2026', 'The Hiring Manager', 'Nirjhor Foods Ltd.', 'Tejgaon Industrial Area, Dhaka'),
      motivation: lines(
        'Dear Hiring Manager,',
        '',
        'I am writing to apply for the post of Senior Operations Executive advertised on your careers page. Nirjhor Foods has grown its outlet network quickly, and the work of keeping shelves full through that growth is the work I enjoy most.',
        '',
        'At Shapla Retail Group I plan weekly replenishment for 38 outlets. When stock-outs were running at eleven days a month, I introduced a shared reorder sheet with purchasing and the warehouse; within two quarters the figure was four. I also train new store supervisors on receiving and returns, which has made month-end counts faster and calmer.',
        '',
        'I would bring the same habit of simple, written routines to your team, along with five years of working closely with vendors. I would welcome the chance to discuss the role in an interview.',
        '',
        'Sincerely,',
        'Nusrat Jahan',
      ),
    },
  },
  'latex-classic': {
    fullName: 'Rafiq Ahmed',
    content: {
      profile: lines('Rafiq Ahmed', 'Data Engineer', mail('rafiq.ahmed'), PHONE, linkedIn('rafiq-ahmed'), '[github.test/rafiq-ahmed](https://github.test/rafiq-ahmed)'),
      summary: lines('Data engineer who builds pipelines that analysts can trust without asking.', 'Core strengths: SQL modelling, batch orchestration, data quality checks', 'Target: a senior data engineering role in a product company'),
      experience: lines(
        '**Data Engineer** Dhrubo Technologies | September 2021 – Present',
        'Own the nightly warehouse load for the pharmacy order platform.',
        '- Rebuilt the ingestion jobs in Airflow; failures fell from weekly to twice a quarter.',
        '- Added row-count and freshness checks that page the on-call engineer.',
        '',
        '**Junior Data Analyst** Padma Analytics Ltd. | March 2019 – August 2021',
        '- Wrote the SQL behind the weekly sales report for 40 client stores.',
      ),
      skills: lines('- SQL and PostgreSQL — dimensional modelling, query tuning', '- Python — pipeline code, tests, small command-line tools', '- Airflow and Docker — scheduling and repeatable local runs'),
      projects: lines('**Open rainfall dataset loader** [gitprobe.test/rafiq-ahmed/rainfall](https://gitprobe.test/rafiq-ahmed/rainfall) | 2024', 'Loads forty years of station rainfall into a tidy table.', '- Wrote the parser and the validation rules.', '- Used by two university course projects.'),
      education: lines('**BSc in Computer Science** Jahangirnagar University | 2018', 'Subject: Computer Science and Engineering', 'Result: CGPA 3.45 out of 4.00'),
      volunteer: lines('**Mentor** Community coding club | 2022 – Present', '- Teach an eight-week SQL evening course for beginners.'),
      awards: lines('**Engineering Excellence Award** Dhrubo Technologies | 2023', '- For the warehouse reliability work.'),
      publications: lines('**Checking freshness in batch pipelines** Rafiq Ahmed | 2024', 'Venue: Dhaka Data Meetup, talk notes', 'Status: Published', '[doi.test/rafiq-ahmed-freshness](https://doi.test/rafiq-ahmed-freshness)'),
      references: REFERENCES,
    },
  },
}

const bnProfile = (goal: string, address: string, email: string) => lines(`পেশা বা লক্ষ্য: ${goal}`, `ঠিকানা: ${address}`, `ইমেইল: ${email}@example.com`, `ফোন: ${BN_PHONE}`)
const bnDegree = (degree: string, institution: string, subject: string, period: string, result: string) => lines(`পরীক্ষা বা ডিগ্রি: ${degree}`, `প্রতিষ্ঠান: ${institution}`, `বিষয়: ${subject}`, `সময়কাল: ${period}`, `ফলাফল: ${result}`)

const bangla: Readonly<Record<string, ResumeSpecimen>> = {
  'job-resume': {
    fullName: 'তানভীর আহমেদ',
    content: {
      profile: bnProfile('হিসাবরক্ষণ কর্মকর্তা', 'মিরপুর, ঢাকা', 'tanvir.ahmed'),
      summary: lines('পাঁচ বছরের অভিজ্ঞ হিসাবরক্ষণ কর্মকর্তা; মাসিক হিসাব সময়মতো ও নির্ভুলভাবে শেষ করাই আমার কাজের ধরন।', 'মূল দক্ষতা: হিসাব সমন্বয়, ভ্যাট ও কর রিটার্ন, আর্থিক প্রতিবেদন', 'লক্ষ্য: একটি উৎপাদনমুখী প্রতিষ্ঠানের হিসাব বিভাগে দায়িত্বশীল পদে অবদান রাখা'),
      experience: lines(
        'হিসাবরক্ষণ কর্মকর্তা | নির্ঝর ফুডস লিমিটেড',
        'মার্চ ২০২২ – বর্তমান',
        '- মাসিক ব্যাংক সমন্বয় ও খতিয়ান মিলিয়ে হিসাব বন্ধ করি।',
        '- হিসাব বন্ধের সময় দশ কর্মদিবস থেকে ছয় কর্মদিবসে নামিয়ে এনেছি।',
        '- ভ্যাট রিটার্ন ও উৎসে কর কর্তনের বিবরণী প্রস্তুত করি।',
        '',
        'সহকারী হিসাবরক্ষক | পদ্মা হোম সাপ্লাইজ',
        'জানুয়ারি ২০২০ – ফেব্রুয়ারি ২০২২',
        '- সরবরাহকারীর বিল যাচাই ও পরিশোধের তালিকা তৈরি করেছি।',
        '- নগদ বই ও ক্ষুদ্র নগদ তহবিলের হিসাব রেখেছি।',
      ),
      education: lines(bnDegree('বিবিএ', 'ঢাকা বিশ্ববিদ্যালয়', 'হিসাববিজ্ঞান', '২০১৫ – ২০১৯', 'সিজিপিএ ৩.৪৮ (৪.০০-এর মধ্যে)'), '', bnDegree('উচ্চমাধ্যমিক', 'ঢাকা শিক্ষা বোর্ড', 'ব্যবসায় শিক্ষা', '২০১২ – ২০১৪', 'জিপিএ ৫.০০')),
      skills: lines('- হিসাব সমন্বয়, খতিয়ান ও আর্থিক বিবরণী প্রস্তুত', '- এক্সেল, হিসাবের সফটওয়্যার ও ভ্যাট অনলাইন ব্যবস্থা', '- নিরীক্ষার জন্য নথি গুছিয়ে রাখা'),
      projects: lines('হিসাব বন্ধের চেকলিস্ট তৈরি', 'ভূমিকা: পরিকল্পনা ও বাস্তবায়ন', '- বিভাগের সবার জন্য ধাপে ধাপে চেকলিস্ট বানিয়েছি; এখন প্রতি মাসে এটি ব্যবহার হয়।'),
      languages: lines('বাংলা: মাতৃভাষা', 'ইংরেজি: লেখা ও কথা বলায় সাবলীল'),
      references: BN_REFERENCES,
    },
  },
  'government-biodata': {
    fullName: 'মোঃ রফিকুল ইসলাম',
    content: {
      profile: lines(bnProfile('সরকারি চাকরিতে যোগদান', 'সদর, বগুড়া', 'rafiqul.islam'), 'আবেদনের পদ: অফিস সহকারী কাম কম্পিউটার মুদ্রাক্ষরিক'),
      education: lines(bnDegree('এইচএসসি', 'রাজশাহী শিক্ষা বোর্ড', 'বিজ্ঞান', '২০১২ – ২০১৪', 'জিপিএ ৪.৭৫'), '', bnDegree('বিএসএস', 'রাজশাহী বিশ্ববিদ্যালয়', 'রাষ্ট্রবিজ্ঞান', '২০১৪ – ২০১৮', 'দ্বিতীয় শ্রেণি')),
      experience: lines('অফিস সহকারী | প্রত্যাশা ফাউন্ডেশন, বগুড়া', 'মার্চ ২০১৯ – বর্তমান', '- চিঠিপত্র গ্রহণ, নথিভুক্তি ও বিতরণের রেজিস্টার রাখি এবং দাপ্তরিক চিঠি টাইপ করি।'),
      skills: '- বাংলা ও ইংরেজি টাইপিং, এমএস ওয়ার্ড, এক্সেল ও নথি ব্যবস্থাপনা',
      personal: lines('পিতার নাম: মোঃ নুরুল ইসলাম', 'মাতার নাম: রহিমা বেগম', 'জন্ম তারিখ: ২ জুন ১৯৯৬', 'জাতীয়তা: বাংলাদেশি', 'স্থায়ী ঠিকানা: নমুনা গ্রাম, সদর, বগুড়া'),
    },
  },
  'teacher-cv': {
    fullName: 'সালমা খাতুন',
    content: {
      profile: bnProfile('সহকারী শিক্ষক (বাংলা)', 'খুলনা সদর, খুলনা', 'salma.khatun'),
      summary: lines('ষষ্ঠ থেকে দশম শ্রেণিতে বাংলা পড়ানোর আট বছরের অভিজ্ঞতা।', 'শিক্ষণ পদ্ধতি: জোড়ায় পাঠ, ছোট লেখার অনুশীলন ও নিয়মিত মূল্যায়ন'),
      education: bnDegree('এমএ', 'খুলনা বিশ্ববিদ্যালয়', 'বাংলা', '২০১৪ – ২০১৫', 'সিজিপিএ ৩.৪৪'),
      experience: lines('সহকারী শিক্ষক (বাংলা)', 'অনির্বাণ স্কুল অ্যান্ড কলেজ, খুলনা; জানুয়ারি ২০১৯ – বর্তমান', '- অষ্টম থেকে দশম শ্রেণিতে বাংলা প্রথম ও দ্বিতীয় পত্র পড়াই।', '- বিভাগের সঙ্গে অর্ধবার্ষিক প্রশ্নপত্র ও পাঠ পরিকল্পনা তৈরি করি।'),
      skills: lines('- পাঠ পরিকল্পনা ও ধারাবাহিক মূল্যায়ন', '- মাল্টিমিডিয়া ক্লাস ও শ্রেণি পরিচালনা'),
      awards: lines('ব্যাচেলর অব এডুকেশন (বিএড)', 'প্রদানকারী: টিচার্স ট্রেনিং কলেজ, খুলনা; প্রথম শ্রেণি, ২০১৮'),
      references: BN_REFERENCES,
    },
  },
  'engineering-cv': {
    fullName: 'আরিফ হোসেন',
    content: {
      profile: bnProfile('পুরকৌশলী', 'উত্তরা, ঢাকা', 'arif.hossain'),
      summary: lines('পুরকৌশল; ভবনের কাঠামো নকশা ও নির্মাণ তদারকি', 'আগ্রহ: কম খরচে নিরাপদ ও টেকসই আবাসিক ভবন নির্মাণ'),
      skills: lines('- কাঠামো বিশ্লেষণ, আরসিসি নকশা ও প্রাক্কলন', '- অটোক্যাড, ইট্যাবস; নির্মাণস্থলে নিরাপত্তা ও মান নিয়ন্ত্রণ'),
      projects: lines('দশতলা আবাসিক ভবন, উত্তরা', 'সমস্যা: নরম মাটিতে ভিত্তি নকশা ও নির্ধারিত বাজেটের মধ্যে কাজ শেষ করা', '- পাইল ভিত্তির নকশা যাচাই ও ঢালাই তদারকি করেছি; কাঠামোর কাজ তিন সপ্তাহ আগে শেষ হয়েছে।'),
      experience: lines('সাইট ইঞ্জিনিয়ার | মেঘদূত বিল্ডার্স', 'জুলাই ২০২১ – বর্তমান', '- দুটি নির্মাণ প্রকল্পে দৈনিক কাজের পরিকল্পনা, মান পরীক্ষা ও বিল যাচাই করি।'),
      education: bnDegree('বিএসসি ইন সিভিল ইঞ্জিনিয়ারিং', 'বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়', 'পুরকৌশল', '২০১৪ – ২০১৮', 'সিজিপিএ ৩.৩১'),
      references: BN_REFERENCES,
    },
  },
  'fresh-graduate': {
    fullName: 'সাদিয়া ইসলাম',
    content: {
      profile: bnProfile('গবেষণা সহকারী পদে কাজ শুরু করা', 'সিলেট সদর, সিলেট', 'sadia.islam'),
      summary: lines('অর্থনীতিতে সদ্য স্নাতক; জরিপের তথ্য নিয়ে কাজ করতে ভালো লাগে।', 'আগ্রহ: গবেষণা বা উন্নয়ন প্রতিষ্ঠানে প্রথম কাজ'),
      education: bnDegree('বিএসএস (সম্মান)', 'শাহজালাল বিজ্ঞান ও প্রযুক্তি বিশ্ববিদ্যালয়', 'অর্থনীতি', '২০২১ – ২০২৫', 'সিজিপিএ ৩.৪৭'),
      projects: lines('চা-বাগানের শ্রমিকদের মোবাইল ব্যাংকিং ব্যবহার', 'কাজ: থিসিসের জরিপ ও তথ্য বিশ্লেষণ', '- দুটি বাগানের ২১২টি পরিবারের তথ্য সংগ্রহ করে বিশ্লেষণ করেছি।', '- দেখেছি, আয়ের চেয়ে এজেন্টের দূরত্ব ব্যবহারের ওপর বেশি প্রভাব ফেলে।'),
      skills: lines('- এক্সেল ও স্ট্যাটায় তথ্য বিশ্লেষণ', '- বাংলা ও ইংরেজিতে প্রতিবেদন লেখা'),
      volunteer: lines('সাধারণ সম্পাদক, বিশ্ববিদ্যালয় অর্থনীতি ক্লাব', '- দুই দিনের শিক্ষার্থী গবেষণা মেলা আয়োজন করেছি, যেখানে ৪০টি পোস্টার জমা পড়ে।'),
      languages: lines('বাংলা: মাতৃভাষা', 'ইংরেজি: লেখা ও কথা বলায় সাবলীল'),
    },
  },
  'academic-research-cv': {
    fullName: 'নুসরাত জাহান',
    content: {
      profile: bnProfile('প্রভাষক ও গবেষক, সমাজবিজ্ঞান', 'রংপুর সদর, রংপুর', 'nusrat.jahan'),
      summary: lines('গ্রামীণ নারীর জীবিকা ও অভিবাসন', 'প্রশ্ন: মৌসুমি অভিবাসন পরিবারের সিদ্ধান্তে নারীর ভূমিকা কীভাবে বদলায়?', 'প্রস্তুতি: সমাজবিজ্ঞানে স্নাতকোত্তর ও চার বছরের মাঠ গবেষণা'),
      education: lines(bnDegree('এমএসএস', 'বেগম রোকেয়া বিশ্ববিদ্যালয়, রংপুর', 'সমাজবিজ্ঞান', '২০১৭ – ২০১৮', 'সিজিপিএ ৩.৭১'), '', bnDegree('বিএসএস (সম্মান)', 'বেগম রোকেয়া বিশ্ববিদ্যালয়, রংপুর', 'সমাজবিজ্ঞান', '২০১৩ – ২০১৭', 'সিজিপিএ ৩.৬২')),
      projects: lines('মৌসুমি অভিবাসন ও পরিবারের সিদ্ধান্ত', 'পদ্ধতি: কুড়িগ্রামের ছয়টি গ্রামে ১৮০টি পরিবারের সাক্ষাৎকার; আমি প্রধান গবেষক', '- তথ্য সংগ্রহ শেষ, বিশ্লেষণ চলছে।'),
      publications: lines('চরাঞ্চলে নারীর আয় ও সিদ্ধান্ত গ্রহণ', 'লেখক: নুসরাত জাহান', 'প্রকাশনা: সমাজ গবেষণা পত্রিকা (নমুনা)', 'অবস্থা: প্রকাশিত, ২০২৪', 'সূত্র: doi.test/sample-2024'),
      experience: lines('প্রভাষক, সমাজবিজ্ঞান', 'তিস্তা ডিগ্রি কলেজ; মার্চ ২০২০ – বর্তমান', '- স্নাতক পর্যায়ে গবেষণা পদ্ধতি ও গ্রামীণ সমাজবিজ্ঞান পড়াই।', '', 'গবেষণা সহকারী', 'প্রত্যাশা ফাউন্ডেশন; জানুয়ারি ২০১৯ – ফেব্রুয়ারি ২০২০', '- জরিপের প্রশ্নপত্র তৈরি ও মাঠকর্মীদের প্রশিক্ষণ দিয়েছি।'),
      awards: lines('সেরা গবেষণাপত্র উপস্থাপনা', 'প্রদানকারী: তরুণ সমাজবিজ্ঞানী সম্মেলন, ২০২৩', 'মাঠ গবেষণার পদ্ধতি নিয়ে উপস্থাপনার জন্য'),
      references: BN_REFERENCES,
    },
  },
  'personal-biodata': {
    fullName: 'ফারহানা আক্তার',
    content: {
      profile: bnProfile('সহকারী শিক্ষক', 'কুমিল্লা সদর, কুমিল্লা', 'farhana.akter'),
      personal: lines('আমি একটি বেসরকারি বিদ্যালয়ে পড়াই এবং পরিবারের সঙ্গে কুমিল্লায় থাকি।', 'আগ্রহ: বই পড়া, বাগান করা ও রান্না', 'পরিবার: বাবা অবসরপ্রাপ্ত শিক্ষক, মা গৃহিণী; এক ভাই ও এক বোন', 'জন্ম তারিখ: ১৪ মার্চ ১৯৯৭'),
      education: lines(bnDegree('এমএ', 'কুমিল্লা বিশ্ববিদ্যালয়', 'ইংরেজি', '২০১৯ – ২০২০', 'সিজিপিএ ৩.৪০'), '', bnDegree('বিএ (সম্মান)', 'কুমিল্লা বিশ্ববিদ্যালয়', 'ইংরেজি', '২০১৫ – ২০১৯', 'সিজিপিএ ৩.৩৫')),
      skills: lines('- শ্রেণিকক্ষে পাঠদান ও শিক্ষার্থীদের পরামর্শ দেওয়া', '- কম্পিউটারে বাংলা ও ইংরেজি লেখা'),
      languages: lines('বাংলা: মাতৃভাষা', 'ইংরেজি: লেখা ও কথা বলায় সাবলীল'),
    },
  },
  'admission-sop': {
    fullName: 'রাকিব হাসান',
    content: {
      profile: bnProfile('স্নাতকোত্তর প্রোগ্রামে ভর্তি', 'ময়মনসিংহ সদর, ময়মনসিংহ', 'rakib.hasan'),
      education: bnDegree('বিএসসি (সম্মান)', 'বাংলাদেশ কৃষি বিশ্ববিদ্যালয়', 'কৃষি অর্থনীতি', '২০২০ – ২০২৪', 'সিজিপিএ ৩.৬৪'),
      motivation: lines(
        'আমি কৃষি অর্থনীতিতে স্নাতকোত্তর প্রোগ্রামে পড়ার জন্য আবেদন করছি।',
        '',
        'স্নাতক পর্যায়ে আমি উৎপাদন অর্থনীতি ও গবেষণা পদ্ধতি পড়েছি এবং শেষ বর্ষে ধানচাষিদের ঋণ নেওয়ার ধরন নিয়ে একটি জরিপ করেছি। মাঠে গিয়ে দেখেছি, কৃষকেরা ফসল তোলার ঠিক পরেই কম দামে ধান বিক্রি করতে বাধ্য হন। এই অভিজ্ঞতা আমাকে কৃষিপণ্যের বাজার ও সংরক্ষণ নিয়ে আরও গভীরভাবে পড়তে আগ্রহী করেছে।',
        '',
        'এই প্রোগ্রাম বেছে নেওয়ার কারণ: এখানকার পাঠক্রমে কৃষি বাজার বিশ্লেষণ ও ফলিত অর্থমিতি একসঙ্গে শেখানো হয়, আর বিভাগের চলমান গবেষণা আমার আগ্রহের সঙ্গে সরাসরি মেলে।',
        '',
        'ভবিষ্যৎ লক্ষ্য: পড়া শেষে আমি একটি গবেষণা প্রতিষ্ঠানে কাজ করে ছোট কৃষকের জন্য সহজ সংরক্ষণ ও ঋণ ব্যবস্থার নীতি প্রস্তাবে অবদান রাখতে চাই।',
      ),
      projects: lines('ধানচাষিদের ঋণ ও বিক্রির সময়', '- ১২০ জন কৃষকের জরিপ করে তথ্য বিশ্লেষণ করেছি।', '- ফলাফল বিভাগীয় সেমিনারে উপস্থাপন করেছি।'),
    },
  },
}

export const resumeSpecimens: Readonly<Record<string, ResumeSpecimen>> = { ...bangla, ...english }

export function resumeSpecimen(templateId: string): ResumeSpecimen | undefined {
  return Object.hasOwn(resumeSpecimens, templateId) ? resumeSpecimens[templateId] : undefined
}
