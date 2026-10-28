export type EditorLanguage = 'English' | 'Bangla'

const banglaCopy: Record<string, string> = {
  English: 'ইংরেজি', Bangla: 'বাংলা',
  'Back to workspace': 'ওয়ার্কস্পেসে ফিরুন', 'Sections': 'বিভাগসমূহ',
  'Summary': 'সারাংশ', 'Goals': 'লক্ষ্য', 'Awards': 'পুরস্কার',
  'Document purpose': 'নথির উদ্দেশ্য', 'Preview controls': 'প্রিভিউ নিয়ন্ত্রণ',
  'Generated from your writing and page settings. Edit a section to update this read-only source.': 'আপনার লেখা ও পৃষ্ঠার সেটিংস থেকে তৈরি। এই read-only সোর্স বদলাতে বিভাগ সম্পাদনা করুন।',
  'Generated LaTeX source': 'তৈরি করা LaTeX সোর্স',
  'Requires LuaLaTeX or XeLaTeX and the selected fonts. Bangla source also requires Noto Sans Bengali.': 'LuaLaTeX বা XeLaTeX এবং নির্বাচিত ফন্ট প্রয়োজন। বাংলা সোর্সের জন্য Noto Sans Bengali-ও প্রয়োজন।',
  'Select this section to start writing.': 'লেখা শুরু করতে এই বিভাগটি বেছে নিন।',
  'A draft PDF, printed from this preview': 'এই প্রিভিউ থেকে তৈরি খসড়া PDF',
  'Your name': 'আপনার নাম', 'Resume editor': 'রিজিউম এডিটর', 'Live document preview': 'লাইভ নথির প্রিভিউ',
  'Resize profile photo': 'প্রোফাইল ছবির মাপ বদলান',
  'Name, role & contact': 'নাম, পদবি ও যোগাযোগ', 'A concise introduction': 'সংক্ষিপ্ত পরিচিতি',
  'Roles & achievements': 'পদবি ও অর্জন', 'Degrees & institutions': 'ডিগ্রি ও প্রতিষ্ঠান', 'Tools & strengths': 'দক্ষতা ও শক্তির দিক',
  'Selected work': 'নির্বাচিত কাজ', 'Purpose & interests': 'উদ্দেশ্য ও আগ্রহ',
  'Document title': 'নথির শিরোনাম', 'Editor language': 'এডিটরের ভাষা', 'Resume language': 'রিজিউমের ভাষা',
  'Purpose': 'উদ্দেশ্য', 'Resume': 'রিজিউম', 'Career profile': 'ক্যারিয়ার প্রোফাইল', 'Academic CV': 'একাডেমিক সিভি', 'Biodata': 'বায়োডাটা', 'Statement of purpose': 'উদ্দেশ্যপত্র',
  'Autosave on': 'স্বয়ংক্রিয়ভাবে সংরক্ষণ চালু', 'Autosave unavailable': 'স্বয়ংক্রিয় সংরক্ষণ বন্ধ', 'This browser is blocking local autosave. Download your work regularly.': 'এই ব্রাউজারে স্বয়ংক্রিয় সংরক্ষণ বন্ধ। নিয়মিত ফাইল ডাউনলোড করুন।', 'Your draft is autosaved on this device. Nothing is uploaded.': 'আপনার খসড়া এই ডিভাইসে স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়। কোনো তথ্য আপলোড হয় না।',
  'Draft PDF': 'খসড়া PDF', 'Download draft PDF': 'খসড়া PDF ডাউনলোড', 'Editable LaTeX source': 'সম্পাদনাযোগ্য LaTeX সোর্স', 'Document setup': 'নথির সেটআপ',
  'Draft preview': 'খসড়া প্রিভিউ', 'LaTeX source': 'LaTeX সোর্স', 'Portrait': 'পোর্ট্রেট', 'Document view': 'নথি দেখার ধরন', 'Visual': 'ভিজ্যুয়াল', 'Source': 'সোর্স', 'Page settings': 'পৃষ্ঠার সেটিংস', 'Zoom out': 'ছোট করে দেখুন', 'Zoom in': 'বড় করে দেখুন', 'Fit document to screen': 'পর্দার সঙ্গে মানানসই করুন', 'Fit': 'মানানসই',
  'YOUR OUTLINE': 'আপনার রূপরেখা', 'Arrange your story': 'আপনার অভিজ্ঞতা সাজান', 'Document sections': 'নথির বিভাগ', 'Document header, fixed at top': 'নথির শিরোনাম, সবসময় উপরে', 'READING ORDER': 'পড়ার ক্রম', 'Drag to arrange': 'টেনে সাজান', 'Section order': 'বিভাগের ক্রম', 'Untitled section': 'নামহীন বিভাগ', 'Selected for editing': 'সম্পাদনার জন্য নির্বাচিত', 'Content added': 'লেখা যোগ করা হয়েছে', 'Ready to write': 'লেখা শুরু করুন', 'Drag a handle to move a section before or after another. With a handle focused, use Arrow Up or Arrow Down. Escape cancels a drag.': 'একটি বিভাগের আগে বা পরে নিতে হ্যান্ডেলটি টানুন। হ্যান্ডেল নির্বাচিত থাকলে ওপর/নিচের তীরচিহ্ন ব্যবহার করুন। বাতিল করতে Escape চাপুন।',
  'Add section': 'বিভাগ যোগ করুন', 'Section library': 'বিভাগের তালিকা', 'Add to your document': 'নথিতে যোগ করুন', 'Core sections': 'প্রধান বিভাগ', 'Additional sections': 'অতিরিক্ত বিভাগ', 'Custom section': 'নিজস্ব বিভাগ', 'Any heading. Your own content.': 'নিজস্ব শিরোনাম ও লেখা', 'Close section library': 'বিভাগের তালিকা বন্ধ করুন', 'Drag a handle, or use the move controls in the section editor.': 'হ্যান্ডেল টেনে বা এডিটরের সরানোর বোতাম দিয়ে বিভাগ সাজান।', 'Sample content.': 'নমুনা লেখা।', 'Replace it with your own.': 'নিজের লেখা দিয়ে বদলে নিন।', 'Clears the saved draft and resets the document': 'সংরক্ষিত খসড়া মুছে নথি নতুন করে শুরু করবে', 'Clear this draft and start over': 'খসড়া মুছে নতুন করে শুরু করুন', 'Clear draft?': 'খসড়া মুছবেন?', 'Start fresh': 'নতুন করে শুরু',
  'Resume sections': 'রিজিউমের বিভাগ', 'Profile': 'পরিচিতি', 'Professional summary': 'পেশাগত সারাংশ', 'Experience': 'অভিজ্ঞতা', 'Education': 'শিক্ষা', 'Skills': 'দক্ষতা', 'Projects': 'প্রকল্প', 'Personal details': 'ব্যক্তিগত তথ্য', 'Motivation': 'আগ্রহ ও উদ্দেশ্য',
  'Document inspector': 'নথির সেটিংস', 'Inspector mode': 'সেটিংসের ধরন', 'Section': 'বিভাগ', 'Page': 'পৃষ্ঠা', 'DOCUMENT HEADER': 'নথির পরিচিতি', 'Section position': 'বিভাগের অবস্থান', 'Move section up': 'বিভাগ উপরে নিন', 'Move section down': 'বিভাগ নিচে নিন', 'Move up': 'উপরে নিন', 'Move down': 'নিচে নিন',
  'Section divider': 'বিভাগ বিভাজক', 'Add a visual break after this section.': 'এই বিভাগের পরে একটি বিভাজক যোগ করুন।', 'The final section has no section after it.': 'শেষ বিভাগের পরে আর কোনো বিভাগ নেই।', 'Show divider after this section': 'এই বিভাগের পরে বিভাজক দেখান', 'Style': 'ধরন', 'Solid': 'সোজা', 'Dashed': 'ড্যাশ', 'Dotted': 'ডট', 'Thickness': 'পুরুত্ব', 'Color': 'রং', 'Accent': 'অ্যাকসেন্ট', 'Custom': 'নিজস্ব', 'Custom divider color': 'বিভাজকের নিজস্ব রং',
  'Full name': 'পুরো নাম', 'Section heading': 'বিভাগের শিরোনাম', 'e.g. Certifications': 'যেমন: সনদপত্র', 'Heading icon': 'শিরোনামের আইকন', 'Optional': 'ঐচ্ছিক', 'None': 'নেই', 'Choose a restrained mark for this section. Size and color apply to all section icons.': 'এই বিভাগের জন্য মানানসই আইকন বাছুন। মাপ ও রং সব বিভাগের আইকনে প্রযোজ্য হবে।', 'Career': 'ক্যারিয়ার', 'Personal': 'ব্যক্তিগত', 'Size': 'মাপ', 'Default': 'ডিফল্ট', 'Small': 'ছোট', 'Large': 'বড়', 'Custom scale': 'নিজস্ব মাপ', 'Custom section icon scale': 'বিভাগের আইকনের নিজস্ব মাপ', 'Relative to the heading text size': 'শিরোনামের লেখার তুলনায় মাপ', 'Custom section icon color': 'বিভাগের আইকনের নিজস্ব রং',
  'Section content': 'বিভাগের লেখা', 'Role and contact details': 'পদবি ও যোগাযোগের তথ্য', 'FORMAT': 'ফরম্যাট', 'Text formatting': 'লেখার বিন্যাস', 'More text formatting': 'আরও বিন্যাস', 'Bold': 'গাঢ়', 'Italic': 'বাঁকা', 'Add or remove link': 'লিংক যোগ/সরান', 'Toggle numbered list': 'ক্রমিক তালিকা চালু/বন্ধ', 'Clear formatting': 'বিন্যাস মুছুন', 'Undo (Ctrl+Z)': 'পূর্বাবস্থায় (Ctrl+Z)', 'Redo (Ctrl+Y)': 'আবার করুন (Ctrl+Y)', 'Bullet style': 'বুলেটের ধরন', 'Dash': 'ড্যাশ', 'Dot': 'ডট', 'Arrow': 'তীর', 'Star': 'তারকা', 'Bullet point': 'বুলেট লেখা', 'Add bullet': 'বুলেট যোগ করুন', 'Add': 'যোগ করুন', 'Write your content here...': 'এখানে আপনার লেখা লিখুন...', 'Add your role, location, email, phone and links on separate lines.': 'পদবি, অবস্থান, ইমেইল, ফোন ও লিংক আলাদা লাইনে লিখুন।', 'Blank lines separate entries. Select text for formatting, or choose a bullet style and add an item.': 'ফাঁকা লাইন দিয়ে লেখা আলাদা করুন। লেখা বাছাই করে বিন্যাস দিন, অথবা বুলেট বেছে নতুন আইটেম যোগ করুন।', 'Live on the canvas': 'ক্যানভাসে সঙ্গে সঙ্গে দেখা যাবে', 'characters': 'অক্ষর',
  'Name alignment': 'নামের অবস্থান', 'Choose where your name and contact details sit.': 'নাম ও যোগাযোগের তথ্য কোথায় থাকবে বেছে নিন।', 'Left': 'বামে', 'Center': 'মাঝে', 'Right': 'ডানে', 'Profile photo': 'প্রোফাইল ছবি', 'A portrait adds a personal touch to your document.': 'একটি ছবি নথিতে ব্যক্তিগত ছোঁয়া যোগ করে।', 'Choose a profile photo file': 'প্রোফাইল ছবির ফাইল বাছুন', 'Profile photo preview': 'প্রোফাইল ছবির প্রিভিউ', 'Replace': 'বদলান', 'Remove': 'সরান', 'Shape': 'আকৃতি', 'Photo shape': 'ছবির আকৃতি', 'Circle': 'বৃত্ত', 'Square': 'বর্গ', 'Background': 'পেছনের রং', 'Photo background': 'ছবির পেছনের রং', 'Use original photo': 'মূল ছবি রাখুন', 'Keep its current background': 'ছবির বর্তমান পেছনের অংশ রাখুন', 'Blur amount': 'ঝাপসার মাত্রা', 'Custom color': 'নিজস্ব রং', 'Resizes with its corner handle on the page. Backdrop presets repaint the selected photo backdrop with paper-matched color, Blur softens only that backdrop, and Custom picks any tint.': 'পৃষ্ঠার কোণার হ্যান্ডেল দিয়ে ছবির মাপ বদলান। ব্যাকগ্রাউন্ডের প্রিসেট ছবির পেছনের রং বদলায়, ঝাপসা শুধু পেছনের অংশ নরম করে, আর নিজস্ব রং দিয়ে পছন্দমতো আভা দিন।', 'Add a photo…': 'ছবি যোগ করুন…', 'Kept on this device. Included in the draft PDF.': 'এই ডিভাইসেই থাকে। খসড়া PDF-এ যুক্ত হয়।', 'Remove from document': 'নথি থেকে সরান', 'Content is kept in the section library, so you can add it back.': 'লেখা বিভাগ তালিকায় থাকবে, পরে আবার যোগ করতে পারবেন।', 'Your words and layout are separate. Typography lives in': 'আপনার লেখা ও বিন্যাস আলাদা। টাইপোগ্রাফি পাবেন',
  'DOCUMENT-WIDE': 'পুরো নথির জন্য', 'Set the rhythm. Give your words room.': 'লেখার ছন্দ ঠিক করুন, পর্যাপ্ত জায়গা দিন।', 'Document name': 'নথির নাম', 'Used as the name of your exported file.': 'ডাউনলোড করা ফাইলের নাম হিসেবে ব্যবহৃত হবে।', 'PRIORITY 1': 'অগ্রাধিকার ১', 'PRIORITY 2': 'অগ্রাধিকার ২', 'PRIORITY 3': 'অগ্রাধিকার ৩', 'PRIORITY 4': 'অগ্রাধিকার ৪', 'Canvas': 'ক্যানভাস', 'Page format': 'পৃষ্ঠার ধরন', 'Page size': 'পৃষ্ঠার মাপ', 'US Letter': 'ইউএস লেটার', 'Voice': 'লেখার ধরন', 'Typography': 'টাইপোগ্রাফি', 'Typeface': 'ফন্ট', 'Your story, clearly set.': 'আপনার গল্প, সুন্দরভাবে সাজানো।', 'Body text size': 'মূল লেখার মাপ', 'Enter to apply. Not canvas zoom.': 'প্রয়োগ করতে Enter চাপুন। এটি ক্যানভাসের জুম নয়।', 'Line spacing': 'লাইনের ফাঁক', 'Rhythm': 'ছন্দ', 'Spacing & margins': 'ফাঁক ও মার্জিন', 'Spacing preset': 'ফাঁকের প্রিসেট', 'Compact': 'ঘন', 'Balanced': 'ভারসাম্যপূর্ণ', 'Airy': 'খোলামেলা', 'Between sections': 'বিভাগের মাঝখানে', 'Page margins': 'পৃষ্ঠার মার্জিন', 'Personality': 'ব্যক্তিত্ব', 'Document accent': 'নথির অ্যাকসেন্ট', 'Document accent color': 'নথির অ্যাকসেন্ট রং', 'Applied to section headings and key details.': 'বিভাগের শিরোনাম ও গুরুত্বপূর্ণ তথ্যে ব্যবহৃত হয়।', 'Reset to defaults': 'ডিফল্টে ফিরুন', 'Language changes default headings, not your writing. Unsupported Bangla glyphs use an available browser font fallback.': 'ভাষা বদলালে ডিফল্ট শিরোনাম বদলাবে, আপনার লেখা নয়। কিছু বাংলা অক্ষরের জন্য ব্রাউজারের বিকল্প ফন্ট ব্যবহৃত হতে পারে।',
  'Draft preview. The draft PDF is a preview render, not the typeset final.': 'খসড়া প্রিভিউ। খসড়া PDF চূড়ান্ত টাইপসেট নথি নয়।', 'Content exceeds one page. The draft PDF splits it approximately.': 'লেখা এক পৃষ্ঠার বেশি। খসড়া PDF আনুমানিকভাবে পরের পৃষ্ঠায় ভাগ হবে।', 'sections': 'টি বিভাগ', 'YOUR DOCUMENT': 'আপনার নথি', 'Click a section to edit. Drag its handle to move it.': 'সম্পাদনা করতে বিভাগে ক্লিক করুন। সরাতে হ্যান্ডেল টানুন।', 'Edit': 'সম্পাদনা', 'Edit Profile': 'পরিচিতি সম্পাদনা', 'Edit section': 'বিভাগ সম্পাদনা', 'Download .tex': '.tex ডাউনলোড', 'Export .tex': '.tex এক্সপোর্ট', 'Dismiss notification': 'বার্তাটি বন্ধ করুন', 'Studio panels': 'স্টুডিও প্যানেল', 'Write': 'লিখুন', 'Preview': 'প্রিভিউ',
  'Bangla typing: on': 'বাংলা টাইপিং চালু', 'Bangla typing: off': 'বাংলা টাইপিং বন্ধ',
  'Banglish typing is on. Write Banglish — the finished word becomes Bangla as soon as you space it. English words like Excel stay as typed.': 'বাংলা টাইপিং চালু আছে। বাংলিশে লিখুন — শব্দ শেষ করে স্পেস দিলেই বাংলা হয়ে যাবে। Excel-এর মতো ইংরেজি শব্দ যেমন আছে তেমন থাকে।',
  'Other readings': 'অন্য পড়া',
  'This looks like legacy Bijoy text. Convert to Unicode Bangla?': 'এটা পুরনো বিজ্জয়-টেক্সট বলে মনে হচ্ছে। ইউনিকোড বাংলায় রূপান্তর করবেন?',
  'Convert to Unicode': 'ইউনিকোডে রূপান্তর করুন', 'Keep as is': 'যেমন আছে রাখুন',
  'Converting…': 'রূপান্তর হচ্ছে…', 'Bijoy conversion failed. The text is unchanged.': 'বিজ্জয় রূপান্তর ব্যর্থ হয়েছে। লেখা আগেরমতোই আছে।',
  'Now writing Bangla: default headings show in Bangla. Line spacing 1.65–1.7 suits Bangla matra.': 'এখন বাংলা লেখা হচ্ছে: ডিফল্ট শিরোনাম বাংলায় দেখাবে। বাংলা মাত্রার জন্য লাইনের ফাঁক ১.৬৫–১.৭ ভালো পড়া যায়।',
}

const extraBanglaCopy: Record<string, string> = {
  'icons': 'আইকন', 'type specimen': 'ফন্টের নমুনা', 'value': 'মান', 'Custom scale': 'নিজস্ব মাপ',
  'Your full name': 'আপনার পুরো নাম', 'Section icon size': 'বিভাগের আইকনের মাপ', 'Autosaved': 'সংরক্ষিত',
  'Relative to the heading text size': 'শিরোনামের লেখার মাপের অনুপাতে', 'Custom section icon scale': 'বিভাগের আইকনের নিজস্ব মাপ',
  'Document purpose': 'নথির উদ্দেশ্য', 'Preview controls': 'প্রিভিউ নিয়ন্ত্রণ', 'Sections': 'বিভাগসমূহ',
  'Your draft is autosaved on this device. Nothing is uploaded.': 'আপনার খসড়া এই ডিভাইসেই স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়। কোনো তথ্য আপলোড করা হয় না।',
  'This browser is blocking local autosave. Download your work regularly.': 'এই ব্রাউজারে স্বয়ংক্রিয় সংরক্ষণ বন্ধ আছে। নিয়মিত আপনার কাজ ডাউনলোড করুন।',
  'Download draft PDF': 'খসড়া PDF ডাউনলোড', 'Editable LaTeX source': 'সম্পাদনাযোগ্য LaTeX সোর্স',
  'A draft PDF, printed from this preview': 'এই প্রিভিউ থেকে তৈরি খসড়া PDF',
  'Generated from your writing and page settings. Edit a section to update this read-only source.': 'আপনার লেখা ও পৃষ্ঠার সেটিংস থেকে তৈরি। এই শুধু-পাঠযোগ্য সোর্স আপডেট করতে বিভাগ সম্পাদনা করুন।',
  'Generated LaTeX source': 'তৈরি করা LaTeX সোর্স',
  'Requires LuaLaTeX or XeLaTeX and the selected fonts. Bangla source also requires Noto Sans Bengali.': 'LuaLaTeX বা XeLaTeX এবং নির্বাচিত ফন্ট প্রয়োজন। বাংলা সোর্সের জন্য Noto Sans Bengali-ও প্রয়োজন।',
  'Select this section to start writing.': 'লেখা শুরু করতে এই বিভাগটি বেছে নিন।',
  'Resume editor': 'রিজিউম এডিটর', 'Live document preview': 'লাইভ নথির প্রিভিউ', 'Resize profile photo': 'প্রোফাইল ছবির মাপ বদলান',
  'Name, role & contact': 'নাম, পদবি ও যোগাযোগ', 'A concise introduction': 'সংক্ষিপ্ত পরিচিতি', 'Roles & achievements': 'পদবি ও অর্জন',
  'Degrees & institutions': 'ডিগ্রি ও প্রতিষ্ঠান', 'Tools & strengths': 'দক্ষতা ও শক্তির দিক', 'Selected work': 'নির্বাচিত কাজ', 'Purpose & interests': 'উদ্দেশ্য ও আগ্রহ',
  'LaTeX source saved. Compile it with LuaLaTeX or XeLaTeX, with the selected fonts installed, for the typeset final.': 'LaTeX সোর্স সংরক্ষিত হয়েছে। চূড়ান্ত টাইপসেট কপির জন্য নির্বাচিত ফন্ট ইনস্টল করে LuaLaTeX বা XeLaTeX দিয়ে কম্পাইল করুন।',
  'The draft PDF prints from the Visual preview. Switch back to Visual, then try again.': 'খসড়া PDF ভিজ্যুয়াল প্রিভিউ থেকে তৈরি হয়। আবার চেষ্টা করতে Visual-এ ফিরে যান।',
  'Print dialog opened. Choose "Save as PDF" to keep a draft PDF that matches this preview.': 'প্রিন্ট ডায়ালগ খোলা হয়েছে। এই প্রিভিউয়ের সঙ্গে মেলে এমন খসড়া PDF রাখতে “Save as PDF” বেছে নিন।',
  'Fresh draft started. Your saved draft was cleared from this device.': 'নতুন খসড়া শুরু হয়েছে। এই ডিভাইস থেকে আগের সংরক্ষিত খসড়া মুছে দেওয়া হয়েছে।',
  'Page settings reset. Your writing and section order are unchanged.': 'পৃষ্ঠার সেটিংস ডিফল্টে ফিরেছে। আপনার লেখা ও বিভাগের ক্রম অপরিবর্তিত আছে।',
  'Reordering cancelled. Section order is unchanged.': 'সরানো বাতিল হয়েছে। বিভাগের ক্রম অপরিবর্তিত আছে।',
  'Profile photo added. It stays on this device with the rest of the draft.': 'প্রোফাইল ছবি যোগ হয়েছে। খসড়ার সঙ্গে এটি এই ডিভাইসেই থাকবে।',
  'That image could not be read. Try a JPG or PNG picture.': 'ছবিটি পড়া যায়নি। JPG বা PNG ছবি দিয়ে চেষ্টা করুন।',
  'That photo\'s backdrop is too busy to separate cleanly — the original was kept. Try a plainer backdrop.': 'ছবির পেছনের অংশ আলাদা করা যায়নি—মূল ছবিটি রাখা হয়েছে। তুলনামূলক সরল ব্যাকগ্রাউন্ডের ছবি ব্যবহার করুন।',
  'Profile photo removed.': 'প্রোফাইল ছবি সরানো হয়েছে।',
  'Draft restored — it was saved on this device.': 'খসড়াটি পুনরুদ্ধার হয়েছে—এটি এই ডিভাইসে সংরক্ষিত ছিল।',
  'Custom section added. Give it a heading and start writing.': 'নিজস্ব বিভাগ যোগ হয়েছে। শিরোনাম দিয়ে লেখা শুরু করুন।',
  'Your words and layout are separate. Typography lives in': 'আপনার লেখা ও বিন্যাস আলাদা। টাইপোগ্রাফির সেটিংস আছে',
  'Add a photo…': 'ছবি যোগ করুন…', 'Kept on this device. Included in the draft PDF.': 'এই ডিভাইসেই থাকে। খসড়া PDF-এ যুক্ত হয়।',
  'Content is kept in the section library, so you can add it back.': 'লেখা বিভাগ তালিকায় থাকবে, পরে আবার যোগ করতে পারবেন।',
  'Unsupported Bangla glyphs use an available browser font fallback.': 'কিছু বাংলা অক্ষরের জন্য ব্রাউজারের বিকল্প ফন্ট ব্যবহৃত হতে পারে।',
}

export function editorText(value: string, language: EditorLanguage): string {
  if (language !== 'Bangla') return value
  const dynamicSection = value.match(/^(.*) added\. Edit its heading and content\.$/u)
  if (dynamicSection) return `${dynamicSection[1]} বিভাগে যোগ হয়েছে। শিরোনাম ও লেখা সম্পাদনা করুন।`
  const removedSection = value.match(/^(.*) removed from the page\. Its content is kept in Add section\.$/u)
  if (removedSection) return `${removedSection[1]} পৃষ্ঠা থেকে সরানো হয়েছে। লেখাটি বিভাগ যোগ করার তালিকায় থাকবে।`
  const movedSection = value.match(/^(.*) moved to position (\d+) of (\d+)\.$/u)
  if (movedSection) return `${movedSection[1]} বিভাগ ${movedSection[3]}টির মধ্যে ${movedSection[2]} নম্বরে সরানো হয়েছে।`
  const outline = value.match(/^(.*) outline applied\. Your writing is kept in the section library\.$/u)
  if (outline) return `${outline[1]} রূপরেখা প্রয়োগ হয়েছে। আপনার লেখা বিভাগ তালিকায় রাখা হয়েছে।`
  return banglaCopy[value] ?? extraBanglaCopy[value] ?? value
}
