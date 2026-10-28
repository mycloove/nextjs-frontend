import assert from 'node:assert/strict'
import test from 'node:test'
import { convertTailForCaret, convertWord, isBanglishTransliterable, isBijoyLikely, previewForCaret, suggestReadings, type BanglishOptions } from './banglish.ts'
import { districtNames, resumePhrases } from './banglishLexicon.ts'

// Expectations are independent literals, never read back from the production bank.
// Names include lower/title-case variants to exercise the actual case policy.
const fixtures = {
  names: `Rahman|রহমান; Chowdhury|চৌধুরী; Hossain|হোসেন; Ahmed|আহমেদ; Ahmad|আহমদ;
    Mahmud|মাহমুদ; Islam|ইসলাম; Khan|খান; Akter|আক্তার; Akhtar|আখতার;
    Begum|বেগম; Sultana|সুলতানা; Sultan|সুলতান; Ayesha|আয়েশা; Aisha|আয়েশা;
    Tisha|তিশা; Habib|হাবিব; Habiba|হাবিবা; Sharmin|শারমিন; Sharmila|শর্মিলা;
    Nusrat|নুসরাত; Jahan|জাহান; Jahid|জাহিদ; Zahid|জাহিদ; Jishan|জিশান;
    Rida|রিদা; Ritu|ঋতু; Rishi|ঋষি; Riddhi|ঋদ্ধি; Riju|ঋজু;
    Hridoy|হৃদয়; Tanvir|তানভীর; Tania|তানিয়া; Tamim|তামিম; Tamanna|তামান্না;
    Tasnim|তাসনিম; Tasfia|তাসফিয়া; Tahsin|তাহসিন; Tahmid|তাহমিদ; Tahmina|তাহমিনা;
    Tonmoy|তন্ময়; Tanzim|তানজিম; Tanzila|তানজিলা; Fahim|ফাহিম; Fahima|ফাহিমা;
    Fariha|ফারিহা; Farhana|ফারহানা; Farhan|ফারহান; Faruk|ফারুক; Firoz|ফিরোজ;
    Fatema|ফাতেমা; Fatima|ফাতিমা; Rakib|রাকিব; Rakibul|রাকিবুল; Rafi|রাফি;
    Rafiq|রফিক; Rafiqul|রফিকুল; Rafia|রাফিয়া; Rashid|রশিদ; Rashed|রাশেদ;
    Rajib|রাজীব; Raj|রাজ; Rajan|রাজন; Raju|রাজু; Rana|রানা;
    Ranjana|রঞ্জনা; Rima|রিমা; Rumi|রুমি; Ruma|রুমা; Rubel|রুবেল;
    Rubina|রুবিনা; Ruhul|রুহুল; Rohan|রোহান; Rohit|রোহিত; Roni|রনি;
    Robin|রবিন; Rabbi|রাব্বি; Rabeya|রাবেয়া; Sabrina|সাবরিনা; Sabbir|সাব্বির;
    Sabina|সাবিনা; Sabiha|সাবিহা; Sadia|সাদিয়া; Saima|সাইমা; Salma|সালমা;
    Salman|সালমান; Saiful|সাইফুল; Sakib|সাকিব; Shakil|শাকিল; Shafiq|শফিক`,
  address: `dhaka|ঢাকা; faridpur|ফরিদপুর; gazipur|গাজীপুর; gopalganj|গোপালগঞ্জ;
    kishoreganj|কিশোরগঞ্জ; madaripur|মাদারীপুর; manikganj|মানিকগঞ্জ; munshiganj|মুন্সীগঞ্জ;
    narayanganj|নারায়ণগঞ্জ; narsingdi|নরসিংদী; rajbari|রাজবাড়ী; shariatpur|শরীয়তপুর; tangail|টাঙ্গাইল;
    chattogram|চট্টগ্রাম; bandarban|বান্দরবান; brahmanbaria|ব্রাহ্মণবাড়িয়া; chandpur|চাঁদপুর;
    cumilla|কুমিল্লা; coxsbazar|কক্সবাজার; feni|ফেনী; khagrachhari|খাগড়াছড়ি;
    lakshmipur|লক্ষ্মীপুর; noakhali|নোয়াখালী; rangamati|রাঙ্গামাটি;
    sylhet|সিলেট; habiganj|হবিগঞ্জ; moulvibazar|মৌলভীবাজার; sunamganj|সুনামগঞ্জ;
    barishal|বরিশাল; barguna|বরগুনা; bhola|ভোলা; jhalokathi|ঝালকাঠি; patuakhali|পটুয়াখালী; pirojpur|পিরোজপুর;
    khulna|খুলনা; bagerhat|বাগেরহাট; chuadanga|চুয়াডাঙ্গা; jashore|যশোর; jhenaidah|ঝিনাইদহ;
    kushtia|কুষ্টিয়া; magura|মাগুরা; meherpur|মেহেরপুর; narail|নড়াইল; satkhira|সাতক্ষীরা;
    rajshahi|রাজশাহী; bogura|বগুড়া; chapainawabganj|চাঁপাইনবাবগঞ্জ; joypurhat|জয়পুরহাট;
    naogaon|নওগাঁ; natore|নাটোর; pabna|পাবনা; sirajganj|সিরাজগঞ্জ;
    rangpur|রংপুর; dinajpur|দিনাজপুর; gaibandha|গাইবান্ধা; kurigram|কুড়িগ্রাম;
    lalmonirhat|লালমনিরহাট; nilphamari|নীলফামারী; panchagarh|পঞ্চগড়; thakurgaon|ঠাকুরগাঁও;
    mymensingh|ময়মনসিংহ; jamalpur|জামালপুর; netrokona|নেত্রকোনা; sherpur|শেরপুর;
    savar|সাভার; dhamrai|ধামরাই; dohar|দোহার; nawabganj|নবাবগঞ্জ; keraniganj|কেরানীগঞ্জ;
    ashulia|আশুলিয়া; uttara|উত্তরা; gulshan|গুলশান; banani|বনানী; dhanmondi|ধানমন্ডি;
    mirpur|মিরপুর; motijheel|মতিঝিল; mohammadpur|মোহাম্মদপুর; tejgaon|তেজগাঁও; ramna|রমনা;
    shahbagh|শাহবাগ; lalbagh|লালবাগ; demra|ডেমরা; basabo|বাসাবো; wari|ওয়ারী;
    hathazari|হাটহাজারী; fatikchhari|ফটিকছড়ি; sitakunda|সীতাকুণ্ড; raozan|রাউজান;
    boalkhali|বোয়ালখালী; patiya|পটিয়া`,
  education: `bishwabidyaloy|বিশ্ববিদ্যালয়; bishwobiddaloy|বিশ্ববিদ্যালয়; bishshobiddaloy|বিশ্ববিদ্যালয়;
    bissobiddaloy|বিশ্ববিদ্যালয়; bishwabidyalay|বিশ্ববিদ্যালয়; bishshobiddalay|বিশ্ববিদ্যালয়;
    bissobiddalay|বিশ্ববিদ্যালয়; unibersity|বিশ্ববিদ্যালয়; university|বিশ্ববিদ্যালয়;
    college|কলেজ; kolej|কলেজ; kolejo|কলেজ; koleje|কলেজে; school|স্কুল; skul|স্কুল;
    shikkha|শিক্ষা; shikkhito|শিক্ষিত; shikkhok|শিক্ষক; shikkhika|শিক্ষিকা; shikkharthi|শিক্ষার্থী;
    chhatro|ছাত্র; chatro|ছাত্র; chhatri|ছাত্রী; chatri|ছাত্রী; porikkha|পরীক্ষা;
    porikha|পরীক্ষা; porikhha|পরীক্ষা; poriyksha|পরীক্ষা; britti|বৃত্তি; folafol|ফলাফল;
    folaphol|ফলাফল; sreni|শ্রেণি; shreni|শ্রেণি; snatok|স্নাতক; snatak|স্নাতক;
    snatokottor|স্নাতকোত্তর; snatakottar|স্নাতকোত্তর; madhyomik|মাধ্যমিক; maddhomik|মাধ্যমিক;
    uchchomadhyomik|উচ্চমাধ্যমিক; prothomik|প্রাথমিক; prathomik|প্রাথমিক; diploma|ডিপ্লোমা;
    honors|অনার্স; honours|অনার্স; degree|ডিগ্রি; biggan|বিজ্ঞান; bijgan|বিজ্ঞান;
    banijjo|বাণিজ্য; manobik|মানবিক; prokoushol|প্রকৌশল; prokousholbid|প্রকৌশলবিদ;
    gonit|গণিত; ganit|গণিত; podartho|পদার্থ; podarthobiggan|পদার্থবিজ্ঞান;
    roshayon|রসায়ন; rasayan|রসায়ন; jibbiggan|জীববিজ্ঞান; jibobiggan|জীববিজ্ঞান;
    porishongkhan|পরিসংখ্যান; orthoniti|অর্থনীতি; orthonaitik|অর্থনৈতিক; hisabbiggan|হিসাববিজ্ঞান;
    itihash|ইতিহাস; bhugol|ভূগোল; darshon|দর্শন; dorshon|দর্শন; shomajbiggan|সমাজবিজ্ঞান;
    shomajkormo|সমাজকর্ম; rashtrabiggan|রাষ্ট্রবিজ্ঞান; ain|আইন; chikitsa|চিকিৎসা;
    chikitsabiggan|চিকিৎসাবিজ্ঞান; krishi|কৃষি; shahitto|সাহিত্য; sahitto|সাহিত্য;
    ingreji|ইংরেজি; arbi|আরবি; farsi|ফারসি; gobeshona|গবেষণা; gobeshok|গবেষক;
    gobeshonapotro|গবেষণাপত্র; probondho|প্রবন্ধ; nibondho|নিবন্ধ; oddhoyon|অধ্যয়ন;
    odhyayon|অধ্যয়ন; pathokrom|পাঠক্রম; oddhay|অধ্যায়; pathyakrom|পাঠ্যক্রম`,
  career: `obhiggota|অভিজ্ঞতা; obhiggoto|অভিজ্ঞ; oviggota|অভিজ্ঞতা; dokkhota|দক্ষতা;
    dokkho|দক্ষ; dakkhota|দক্ষতা; chakri|চাকরি; chakrir|চাকরির; pesha|পেশা;
    peshajibi|পেশাজীবী; peshagoto|পেশাগত; protisthan|প্রতিষ্ঠান; protisthito|প্রতিষ্ঠিত;
    dayitto|দায়িত্ব; dayittoshil|দায়িত্বশীল; netritto|নেতৃত্ব; neta|নেতা; niyog|নিয়োগ;
    niyogito|নিয়োগিত; niyoger|নিয়োগের; abedon|আবেদন; abedonpotro|আবেদনপত্র;
    abedonkari|আবেদনকারী; prarthi|প্রার্থী; sakkhatkar|সাক্ষাৎকার; sakkhat|সাক্ষাৎ;
    betan|বেতন; baton|বেতন; parishromik|পারিশ্রমিক; parishrom|পরিশ্রম; podobi|পদবি;
    pod|পদ; podonnoti|পদোন্নতি; kormo|কর্ম; kormi|কর্মী; kormokorta|কর্মকর্তা;
    kormochari|কর্মচারী; kormosthol|কর্মস্থল; kormojibon|কর্মজীবন; porichalok|পরিচালক;
    porichalona|পরিচালনা; bebosthapok|ব্যবস্থাপক; byabosthapok|ব্যবস্থাপক;
    shohokari|সহকারী; sohokari|সহকারী; upodeshta|উপদেষ্টা; poramorshok|পরামর্শক;
    prodhan|প্রধান; somonnoyok|সমন্বয়ক; shomonnoyok|সমন্বয়ক; hisabrokhok|হিসাবরক্ষক;
    nirikkhok|নিরীক্ষক; bishleshok|বিশ্লেষক; bishleshon|বিশ্লেষণ; bikroy|বিক্রয়;
    biponon|বিপণন; grahok|গ্রাহক; grahokseba|গ্রাহকসেবা; sheba|সেবা; seba|সেবা;
    jogajog|যোগাযোগ; jogajoger|যোগাযোগের; dol|দল; dolgoto|দলগত; shohokormi|সহকর্মী;
    shomossa|সমস্যা; shomosshya|সমস্যা; somosshya|সমস্যা; shomadhan|সমাধান; somadhan|সমাধান;
    porikolpona|পরিকল্পনা; porikalpona|পরিকল্পনা; bastobayon|বাস্তবায়ন; bastobayan|বাস্তবায়ন;
    uddog|উদ্যোগ; uddyog|উদ্যোগ; uddyokta|উদ্যোক্তা; udyokta|উদ্যোক্তা; unnoyon|উন্নয়ন;
    unnayan|উন্নয়ন; projukti|প্রযুক্তি; projuktibid|প্রযুক্তিবিদ; prokousholi|প্রকৌশলী;
    nirman|নির্মাণ; noksha|নকশা; porikkhon|পরীক্ষণ; manobshompod|মানবসম্পদ;
    manonnoyon|মানোন্নয়ন; manniyontron|মাননিয়ন্ত্রণ; utpadon|উৎপাদন`,
  common: `ami|আমি; amar|আমার; amader|আমাদের; amra|আমরা; apni|আপনি; apnar|আপনার;
    tumi|তুমি; tomar|তোমার; tomake|তোমাকে; apnake|আপনাকে; amake|আমাকে;
    amay|আমায়; tomay|তোমায়; tara|তারা; tarpor|তারপর; ebang|এবং; ebong|এবং;
    othoba|অথবা; jehetu|যেহেতু; tai|তাই; tobe|তবে; jemon|যেমন; temon|তেমন;
    mane|মানে; ar|আর; na|না; abar|আবার; pore|পরে; ekhane|এখানে; eta|এটা;
    eti|এটি; ei|এই; sei|সেই; je|যে; ja|যা; jar|যার; se|সে; she|সে;
    theke|থেকে; hote|হতে; shesh|শেষ; sathe|সাথে; shathe|সাথে; jonne|জন্য;
    jonno|জন্য; sejonne|সেজন্য; diye|দিয়ে; moddhe|মধ্যে; maddhome|মাধ্যমে;
    nam|নাম; eto|এত; obosshoi|অবশ্যই; onek|অনেক; thik|ঠিক; kotha|কথা;
    somoy|সময়; shomoy|সময়; kono|কোনো; hoy|হয়; hobe|হবে; holo|হলো; hole|হলে;
    hochche|হচ্ছে; hoyeche|হয়েছে; kori|করি; kore|করে; korchi|করছি; koreche|করেছে;
    korbo|করব; korte|করতে; korar|করার; korechi|করেছি; kora|করা; kaj|কাজ;
    ache|আছে; thaki|থাকি; thake|থাকে; thakbo|থাকব; chhilo|ছিল; bhalo|ভালো;
    valo|ভালো; chai|চাই; pari|পারি; parbo|পারব; dekha|দেখা; lekha|লেখা;
    pora|পড়া; bola|বলা; jani|জানি; dorkar|দরকার`,
  phonetics: `k|ক; kh|খ; g|গ; gh|ঘ; ch|চ; chh|ছ; j|জ; jh|ঝ; t|ত; th|থ;
    d|দ; dh|ধ; n|ন; p|প; ph|ফ; b|ব; bh|ভ; m|ম; r|র; l|ল; s|স; sh|শ; ss|ষ; h|হ;
    T|ট; Th|ঠ; D|ড; Dh|ঢ; N|ণ; R|ড়; Rh|ঢ়; Sh|ষ; S|ষ;
    ng|ং; ngA|ঙ্গা; ksh|ক্ষ; jn|জ্ঞ; nj|ঞ্জ; mp|ম্প; nm|ন্ম; sm|স্ম; ddh|দ্ধ;
    shth|ষ্ঠ; kt|ক্ত; nt|ন্ত; nd|ন্দ; sk|স্ক; sp|স্প; ts|ৎস; dk|দ্ক;
    y|য; bya|ব্যা; yA|যা; ay|আয়; rri|ঋ; krri|কৃ; O|ও; I|ঈ; U|ঊ;
    cha^d|চাঁদ; k,,|ক্; ka~ta|কা~তা; kO|কো; e^|এঁ`,
}

const categories = Object.entries(fixtures).map(([category, specification]) => {
  const base = specification.split(/[;\n]/u).map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const [source, expected] = pair.split('|')
    assert.ok(source && expected, `Invalid independent fixture: ${pair}`)
    return { source, expected }
  })
  const pairs = category === 'names' ? base.flatMap((pair) => [pair, { ...pair, source: pair.source.toLowerCase() }]) : base
  return { category, pairs }
})

test('accuracy corpus contains 500-1000 genuine categorized input/expectation pairs', () => {
  const count = categories.reduce((sum, category) => sum + category.pairs.length, 0)
  assert.ok(count >= 500 && count <= 1000, `Actual corpus size: ${count}`)
  const unique = new Set(categories.flatMap(({ category, pairs }) => pairs.map((pair) => `${category}:${pair.source}`)))
  assert.equal(unique.size, count, 'Repeated fixtures cannot inflate the accuracy report')
  assert.equal(Object.keys(districtNames).length, 64)
})

for (const { category, pairs } of categories) {
  test(`${category}: ${pairs.length} independent spelling expectations`, () => {
    const options: BanglishOptions = category === 'phonetics' ? { force: true } : { context: category === 'names' ? 'name' : category === 'address' ? 'address' : category === 'education' ? 'education' : category === 'career' ? 'career' : 'general' }
    const failures = pairs.flatMap(({ source, expected }) => {
      const actual = convertWord(source, options)
      return actual === expected ? [] : [{ source, expected, actual }]
    })
    assert.deepEqual(failures, [], `${failures.length}/${pairs.length} real failures in ${category}`)
  })
}

test('protected English, contacts, identifiers, acronyms, digits and foreign scripts stay unchanged', () => {
  for (const source of ['Excel', 'Microsoft', 'Office', 'Figma', 'React', 'JavaScript', 'DataRow', 'IBM', 'NASA', 'SSC', 'B.Sc.', 'Dhaka123', '১২৩', 'hello@example.com', 'https://example.com/a:b', 'www.example.com', 'বাংলা', 'café', 'école']) {
    assert.equal(convertWord(source), null, source)
    assert.deepEqual(suggestReadings(source), [], source)
  }
  assert.equal(isBanglishTransliterable('Excel', { force: true }), true)
  assert.equal(convertWord('Dhaka123', { force: true }), null)
  assert.equal(convertWord('ruby', { context: 'name' }), 'রুবি')
  assert.equal(convertWord('Ruby'), null)
})

test('case markers, y/yaphala and unknown characters are explicit and lossless', () => {
  assert.equal(isBanglishTransliterable('aShTha'), true)
  assert.equal(convertWord('aShTha'), 'আষ্ঠা')
  assert.equal(convertWord('yatra'), 'যাত্রা')
  assert.equal(convertWord('joy'), 'জয়')
  assert.equal(convertWord('bya', { force: true }), 'ব্যা')
  assert.equal(convertWord('ka$ta', { force: true }), 'কা$তা')
  assert.equal(convertWord('ka🙂', { force: true }), 'কা🙂')
  assert.equal(convertWord('ka,ta', { force: true }), 'কা,তা')
})

test('learned spellings outrank the curated bank without rewriting protected data', () => {
  const options = { learned: { rahman: 'রাহমান', excel: 'এক্সেল' } }
  assert.equal(convertWord('Rahman', options), 'রাহমান')
  assert.equal(suggestReadings('Rahman', options)[0], 'রাহমান')
  assert.equal(convertWord('Excel', options), null)
  const readings = suggestReadings('tisha')
  assert.equal(new Set(readings).size, readings.length)
  assert.ok(readings.length <= 3)
})

test('caret results refer to actual converted text and preserve suffixes and delimiters', () => {
  const input = 'left obhiggota right'
  const result = convertTailForCaret(input, input.indexOf(' right') + 1)!
  assert.equal(result.next, 'left অভিজ্ঞতা right')
  assert.equal(result.start, 5)
  assert.equal(result.end, 14)
  assert.equal(result.newEnd, 13)
  assert.equal(result.caret, 14)
  assert.equal(result.source, 'obhiggota')
  assert.equal(convertTailForCaret('ami\n', 4)?.next, 'আমি\n')
  assert.equal(convertTailForCaret('ami!', 4), null)
  assert.equal(previewForCaret('ami!', 4)?.candidates[0], 'আমি')
  assert.equal(convertTailForCaret('ami! ', 5)?.next, 'আমি! ')
  assert.equal(convertTailForCaret('ami', 3), null)
  for (const caret of [-1, 0, 100, 1.2]) assert.equal(convertTailForCaret('ami ', caret), null)
})

test('live previews suggest without mutating the field, including an interior caret', () => {
  const value = 'start dhaka suffix'
  const result = previewForCaret(value, 11)!
  assert.equal(result.source, 'dhaka')
  assert.equal(result.start, 6)
  assert.equal(result.end, 11)
  assert.equal(result.candidates[0], 'ঢাকা')
  assert.equal(value, 'start dhaka suffix')
  assert.equal(previewForCaret('hello@example.com', 13), null)
  assert.equal(previewForCaret('[label](https://example.com)', 18), null)
})

test('deferred punctuation supports ,, hasanta without corrupting typed URLs', () => {
  assert.equal(convertTailForCaret('ami,', 4), null)
  assert.equal(convertTailForCaret('ami, ', 5)?.next, 'আমি, ')
  assert.equal(convertTailForCaret('ami,d', 5)?.next, 'আমি,d')
  assert.equal(convertTailForCaret('k,, ', 4)?.next, 'ক্ ')
  assert.equal(previewForCaret('k,,', 3)?.candidates[0], 'ক্')
  assert.equal(convertTailForCaret('ami. ', 5)?.next, 'আমি. ')
  for (const value of ['https:', 'www.', 'example.com ', 'hello@example.com ', '[label](https://example.com) ']) assert.equal(convertTailForCaret(value, value.length), null, value)
  assert.equal(convertTailForCaret('_ami_', 5), null)
  assert.equal(convertTailForCaret('_ami_ ', 6)?.next, '_আমি_ ')
  assert.equal(convertTailForCaret('custom_', 7), null)
})

test('resume phrases are explicit suggestions, not silently fabricated prose translations', () => {
  const expected = [['university of dhaka', 'ঢাকা বিশ্ববিদ্যালয়'], ['career objective', 'ক্যারিয়ার উদ্দেশ্য'], ['bachelor of science', 'বিজ্ঞান স্নাতক'], ['o level', 'ও লেভেল'], ['ssc', 'এসএসসি'], ['software engineer', 'সফটওয়্যার প্রকৌশলী']]
  for (const [source, reading] of expected) assert.equal(resumePhrases[source], reading)
  assert.equal(convertWord('SSC'), null)
})

test('Bijoy detection offers conversion only for legacy signatures, not Unicode Bangla', () => {
  assert.equal(isBijoyLikely('‡Kv¤új'), true)
  assert.equal(isBijoyLikely('English résumé'), false)
  assert.equal(isBijoyLikely('বাংলা ‡¤'), false)
})

test('inherited dictionary properties never become non-string readings', () => {
  for (const word of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const result = convertWord(word)
    assert.ok(result === null || typeof result === 'string', word)
    for (const reading of suggestReadings(word)) {
      assert.equal(typeof reading, 'string')
      assert.ok(!reading.includes('[native code]'))
    }
  }
  assert.equal(convertWord('ami', { learned: Object.create({ ami: 'তুমি' }) }), 'আমি')
  assert.equal(convertWord('ami', { learned: { ami: '১২৩' } }), 'আমি')
})

test('learned preferences keep the curated spelling available for correction', () => {
  const readings = suggestReadings('rahman', { learned: { rahman: 'রাহমান' }, context: 'name' })
  assert.equal(readings[0], 'রাহমান')
  assert.ok(readings.includes('রহমান'))
})

test('explicit phonetic mode bypasses vocabulary but never contact and identifier guards', () => {
  for (const [word, expected] of [['T', 'ট'], ['D', 'ড'], ['N', 'ণ'], ['Sh', 'ষ'], ['R', 'ড়'], ['Rh', 'ঢ়'], ['rri', 'ঋ'], ['k,,t', 'ক্ত']]) {
    assert.equal(convertTailForCaret(`${word} `, word.length + 1, { force: true })?.next, `${expected} `, word)
  }
  assert.equal(convertWord('Tisha', { force: true, context: 'name' }), 'টিশা')
  assert.equal(convertWord('Tisha', { context: 'name' }), 'তিশা')
  assert.equal(convertWord('ami', { force: true, learned: { ami: 'তুমি' } }), 'আমি')
  for (const value of ['rahman_ami ', 'rahman123-ami ', '`ami` ', 'ami@example.com ', 'https://dhaka.com/ami ']) {
    assert.equal(convertTailForCaret(value, value.length, { force: true }), null, value)
  }
})

test('interior word carets are not partial-word conversions and Bengali punctuation completes words', () => {
  assert.equal(previewForCaret('amra', 2), null)
  assert.equal(previewForCaret('rahman_ami', 6), null)
  assert.equal(convertTailForCaret('ami।', 4)?.next, 'আমি।')
  assert.equal(convertTailForCaret('ami॥', 4)?.next, 'আমি॥')
  assert.equal(convertTailForCaret('ami  ', 5), null)
  assert.equal(previewForCaret('ami suffix', 3)?.candidates[0], 'আমি')
})

test('adjacent vowels stay separate unless the explicit oi/ou diphthong is typed', () => {
  for (const [source, expected] of [['gai', 'গাই'], ['khai', 'খাই'], ['saif', 'সাইফ'], ['nei', 'নেই'], ['ei', 'এই'], ['au', 'আউ'], ['oi', 'ঐ'], ['ou', 'ঔ'], ['koi', 'কৈ']]) {
    assert.equal(convertWord(source, { force: true }), expected, source)
  }
})

test('published Avro showcase is a behavioral reference, not a claim of full Avro parity', () => {
  // OmicronLab's public example: https://www.omicronlab.com/avro-keyboard.html
  // No Avro engine or dictionary is imported. Compare canonical Unicode spelling.
  const result = 'ami banglay gan gai'.split(' ').map((word) => convertWord(word) ?? word).join(' ')
  assert.equal(result.normalize('NFC'), 'আমি বাংলায় গান গাই'.normalize('NFC'))
})

test('keystroke-by-keystroke contact and identifier prefixes are never converted prematurely', () => {
  const contacts = ['rahman-saad@example.com ', 'rahman_saad@example.com ', 'rahman.saad@example.com ', 'rahman+saad@example.com ', "rahman'saad@example.com ", 'rahman!saad@example.com ', 'rahman%saad@example.com ', '*rahman*@example.com ', '_rahman_@example.com ', 'rahman|saad@example.com ', '{rahman}@example.com ', 'rahman?saad@example.com ', 'rahman-2026 ', 'https://dhaka-uni.example.com/profile ']
  for (const force of [false, true]) {
    for (const contact of contacts) {
      let value = ''
      for (const character of contact) {
        value += character
        value = convertTailForCaret(value, value.length, { force })?.next ?? value
      }
      assert.equal(value, contact, `${force ? 'Phonetic' : 'Smart'}: ${contact}`)
    }
  }
})

test('deferred punctuation stays visible and its full suffix remains outside the correction range', () => {
  for (const [input, expected, sourceEnd] of [['ami, ', 'আমি, ', 3], ['ami. ', 'আমি. ', 3], ['ami- ', 'আমি- ', 3], ['ami!? ', 'আমি!? ', 3], ['k,,! ', 'ক্! ', 3]] as const) {
    const result = convertTailForCaret(input, input.length)!
    assert.equal(result.next, expected, input)
    assert.equal(result.end, sourceEnd)
    assert.equal(result.caret, expected.length)
    assert.equal(result.next.slice(result.newEnd), input.slice(sourceEnd))
  }
})
