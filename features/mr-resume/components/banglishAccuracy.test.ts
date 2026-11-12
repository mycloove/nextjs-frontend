import assert from 'node:assert/strict'
import test from 'node:test'
import { convertWord, suggestReadings, type BanglishContext } from './banglish.ts'
import { acceptableCost, banglaSlots, readCosts } from './banglishMatch.ts'
import { banglaWordLists } from './banglishWords.ts'

// Casual Banglish as people type it, with the standard spelling it should become.
// Every expectation is an independent literal. Where two spellings are both
// standard (কীভাবে / কিভাবে) either is accepted, written a/b.
//
// How the numbers should be read: the single-word list was written before the
// word reader existed and the old engine scored 148/252 (58.7%) on it. Each
// sentence set was written, run once, and only then used to find what was
// missing; their first-run scores were 97.6%, 93.0%, 96.3% and 96.1%. They are
// kept here as a regression floor. They are not a comparison with any other
// input method, and text using words outside banglishWords.ts will score lower.
const casualWords: Readonly<Record<string, string>> = {
  general: `kemon|কেমন; acho|আছো; achen|আছেন; achi|আছি; valobashi|ভালোবাসি; bhalobasha|ভালোবাসা; dhonnobad|ধন্যবাদ; shuvo|শুভ; shubho|শুভ; sokal|সকাল; shokal|সকাল;
    bikel|বিকেল; rat|রাত; din|দিন; bondhu|বন্ধু; poribar|পরিবার; baba|বাবা; bhai|ভাই; bon|বোন; chele|ছেলে; meye|মেয়ে; manush|মানুষ; desh|দেশ;
    bangladesh|বাংলাদেশ; bangla|বাংলা; bhasha|ভাষা; vasha|ভাষা; boi|বই; kolom|কলম; ghor|ঘর; bari|বাড়ি; rasta|রাস্তা; gari|গাড়ি; pani|পানি; khabar|খাবার;
    bhat|ভাত; mach|মাছ; dudh|দুধ; phul|ফুল; ful|ফুল; gach|গাছ; nodi|নদী; akash|আকাশ; brishti|বৃষ্টি; taka|টাকা; bazar|বাজার; dokan|দোকান; daktar|ডাক্তার;
    hashpatal|হাসপাতাল; jibon|জীবন; mon|মন; prem|প্রেম; shanti|শান্তি; sukh|সুখ; dukkho|দুঃখ; anondo|আনন্দ; shopno|স্বপ্ন; sopno|স্বপ্ন; asha|আশা;
    bishwas|বিশ্বাস; bissas|বিশ্বাস; shotti|সত্যি; mittha|মিথ্যা; shobai|সবাই; sobai|সবাই; keu|কেউ; kichu|কিছু; shob|সব; sob|সব; ektu|একটু; ajke|আজকে;
    aj|আজ; kal|কাল; ekhon|এখন; tokhon|তখন; kokhon|কখন; kothay|কোথায়; keno|কেন; ki|কি; ke|কে; kivabe|কীভাবে/কিভাবে; kibhabe|কীভাবে/কিভাবে; jodi|যদি;
    kintu|কিন্তু; karon|কারণ; tahole|তাহলে; shudhu|শুধু; sudhu|শুধু; boro|বড়; choto|ছোট; shundor|সুন্দর; sundor|সুন্দর; notun|নতুন; purano|পুরানো/পুরনো;
    kharap|খারাপ; sohoj|সহজ; shohoj|সহজ; kothin|কঠিন; gurutbopurno|গুরুত্বপূর্ণ; guruttopurno|গুরুত্বপূর্ণ`,
  verbs: `jabo|যাব; jai|যাই; jacchi|যাচ্ছি; jachchi|যাচ্ছি; eshechi|এসেছি; khabo|খাব; khai|খাই; dekhi|দেখি; dekhbo|দেখব; bolbo|বলব; bolchi|বলছি; likhi|লিখি;
    likhbo|লিখব; porbo|পড়ব; bujhi|বুঝি; chilam|ছিলাম; korlam|করলাম; gelam|গেলাম; dilam|দিলাম; korchen|করছেন; korben|করবেন; bolun|বলুন; dekhun|দেখুন;
    ashun|আসুন; jante|জানতে; shikhte|শিখতে; shikhechi|শিখেছি; korechen|করেছেন; diyechi|দিয়েছি; niyechi|নিয়েছি; peyechi|পেয়েছি; giyechi|গিয়েছি;
    hoyechilo|হয়েছিল; korchilam|করছিলাম; thakte|থাকতে; parchi|পারছি; chaichi|চাইছি; janai|জানাই; janachchi|জানাচ্ছি`,
  resume: `proshikkhon|প্রশিক্ষণ; sonod|সনদ; jonmo|জন্ম; tarikh|তারিখ; thikana|ঠিকানা; bortoman|বর্তমান; sthayi|স্থায়ী; pita|পিতা; mata|মাতা; jatiyota|জাতীয়তা;
    dhormo|ধর্ম; boibahik|বৈবাহিক; obostha|অবস্থা; bibahito|বিবাহিত; obibahito|অবিবাহিত; joggota|যোগ্যতা; uttirno|উত্তীর্ণ; bibhag|বিভাগ; bivag|বিভাগ;
    bishoy|বিষয়; shakkhor|স্বাক্ষর; binito|বিনীত; nibedok|নিবেদক; jonab|জনাব; mohodoy|মহোদয়; nibedon|নিবেদন; songstha|সংস্থা; shongothon|সংগঠন;
    sodossho|সদস্য; shodosso|সদস্য; shovapoti|সভাপতি; sompadok|সম্পাদক; ongshogrohon|অংশগ্রহণ; purushkar|পুরস্কার; puroshkar|পুরস্কার; lokkho|লক্ষ্য;
    uddessho|উদ্দেশ্য; uddesho|উদ্দেশ্য; protishruti|প্রতিশ্রুতি; shofol|সফল; sofol|সফল; shofolota|সফলতা; agrohi|আগ্রহী; agroho|আগ্রহ; bhobishshot|ভবিষ্যৎ;
    vobisshot|ভবিষ্যৎ; onuprerona|অনুপ্রেরণা; shomman|সম্মান; somman|সম্মান; sroddha|শ্রদ্ধা; shroddha|শ্রদ্ধা; kritoggo|কৃতজ্ঞ; dhoirjo|ধৈর্য;
    shotota|সততা; sotota|সততা; nishtha|নিষ্ঠা; porisromi|পরিশ্রমী; porishromi|পরিশ্রমী; srijonshil|সৃজনশীল; attobishwas|আত্মবিশ্বাস;
    attobisshash|আত্মবিশ্বাস`,
  names: `Mitu|মিতু; Shanto|শান্ত; Liton|লিটন; Shimul|শিমুল; Kamal|কামাল; Jamal|জামাল; Karim|করিম; Rahim|রহিম; Nasrin|নাসরিন; Parvin|পারভীন; Moni|মনি; Lima|লিমা;
    Sumon|সুমন; Sumi|সুমি; Mamun|মামুন; Masud|মাসুদ; Monir|মনির; Kabir|কবির; Hasan|হাসান; Hasina|হাসিনা; Anwar|আনোয়ার; Delwar|দেলোয়ার; Shahin|শাহীন;
    Shamim|শামীম; Selim|সেলিম; Babul|বাবুল; Dulal|দুলাল; Sourav|সৌরভ; Arif|আরিফ; Ashraf|আশরাফ; Mostafa|মোস্তফা; Mizan|মিজান; Nazrul|নজরুল; Zakir|জাকির;
    Imran|ইমরান; Iqbal|ইকবাল; Uddin|উদ্দিন; Ullah|উল্লাহ; Mia|মিয়া; Sarkar|সরকার; Sarker|সরকার; Das|দাস; Roy|রায়; Saha|সাহা; Biswas|বিশ্বাস;
    Mondal|মণ্ডল/মন্ডল; Talukdar|তালুকদার; Sheikh|শেখ; Molla|মোল্লা; Sikder|সিকদার; Majumder|মজুমদার; Chakraborty|চক্রবর্তী`,
}

const casualSentences: Readonly<Record<string, string>> = {
  letters: `ami tomake onek valobashi|আমি তোমাকে অনেক ভালোবাসি
apni kemon achen|আপনি কেমন আছেন
amar nam rahim|আমার নাম রহিম
ami bhalo achi|আমি ভালো আছি
tumi kothay jaccho|তুমি কোথায় যাচ্ছ
ajke amar onek kaj ache|আজকে আমার অনেক কাজ আছে
ami bangladesh theke eshechi|আমি বাংলাদেশ থেকে এসেছি
amar barite char jon manush thake|আমার বাড়িতে চার জন মানুষ থাকে
se protidin sokale skule jay|সে প্রতিদিন সকালে স্কুলে যায়
amra sobai mile kaj kori|আমরা সবাই মিলে কাজ করি
ami notun kichu shikhte chai|আমি নতুন কিছু শিখতে চাই
amar baba ekjon shikkhok|আমার বাবা একজন শিক্ষক
tomar sathe dekha hobe|তোমার সাথে দেখা হবে
ami kal dhaka jabo|আমি কাল ঢাকা যাব
eta amar prothom chakri|এটা আমার প্রথম চাকরি
ami dolgoto kaje dokkho|আমি দলগত কাজে দক্ষ
ami somoy moto kaj shesh kori|আমি সময় মতো কাজ শেষ করি
amar lokkho ekjon sofol prokousholi howa|আমার লক্ষ্য একজন সফল প্রকৌশলী হওয়া
ami porisromi ebong dayittoshil|আমি পরিশ্রমী এবং দায়িত্বশীল
amar shikkhagoto joggota|আমার শিক্ষাগত যোগ্যতা
pitar nam|পিতার নাম
matar nam|মাতার নাম
bortoman thikana|বর্তমান ঠিকানা
sthayi thikana|স্থায়ী ঠিকানা
jonmo tarikh|জন্ম তারিখ
ami ingreji bolte ebong likhte pari|আমি ইংরেজি বলতে এবং লিখতে পারি
amar kono somossa nei|আমার কোনো সমস্যা নেই
apnake onek dhonnobad|আপনাকে অনেক ধন্যবাদ
amader desher manush khub porisromi|আমাদের দেশের মানুষ খুব পরিশ্রমী
ami ei pode abedon korchi|আমি এই পদে আবেদন করছি
ami apnar protisthane kaj korte agrohi|আমি আপনার প্রতিষ্ঠানে কাজ করতে আগ্রহী
amar tin bochorer obhiggota ache|আমার তিন বছরের অভিজ্ঞতা আছে
ami bishwabidyaloy theke snatok sompurno korechi|আমি বিশ্ববিদ্যালয় থেকে স্নাতক সম্পূর্ণ করেছি
ami gobeshona korte bhalobashi|আমি গবেষণা করতে ভালোবাসি
tara amar bondhu|তারা আমার বন্ধু
bristi hocche|বৃষ্টি হচ্ছে
amar mayer nam fatema begum|আমার মায়ের নাম ফাতেমা বেগম
ami ekhon basay achi|আমি এখন বাসায় আছি
tumi ki khaccho|তুমি কি খাচ্ছ
amar meye koleje pore|আমার মেয়ে কলেজে পড়ে
ami boi porte pochondo kori|আমি বই পড়তে পছন্দ করি
shobaike shuvechha|সবাইকে শুভেচ্ছা
ami prottek din bayam kori|আমি প্রত্যেক দিন ব্যায়াম করি
amar jibone onek shopno ache|আমার জীবনে অনেক স্বপ্ন আছে
tini ekjon bhalo manush|তিনি একজন ভালো মানুষ
ami bisshas kori je ami parbo|আমি বিশ্বাস করি যে আমি পারব
amake ektu sahajjo korun|আমাকে একটু সাহায্য করুন
apnar songe kotha bole bhalo laglo|আপনার সঙ্গে কথা বলে ভালো লাগল
ami notun projukti shikhte agrohi|আমি নতুন প্রযুক্তি শিখতে আগ্রহী
amar bibhag dhaka ebong jela gazipur|আমার বিভাগ ঢাকা এবং জেলা গাজীপুর
ami sorkari chakri korte chai|আমি সরকারি চাকরি করতে চাই
ami computer chalate pari|আমি কম্পিউটার চালাতে পারি
amar mobile nombor|আমার মোবাইল নম্বর
tumi kobe ashbe|তুমি কবে আসবে
amader bashar pashe ekta boro math ache|আমাদের বাসার পাশে একটা বড় মাঠ আছে
ami protidin sokale hatte jai|আমি প্রতিদিন সকালে হাঁটতে যাই
se khub shundor gan gay|সে খুব সুন্দর গান গায়
amar chhoto bhai porashona kore|আমার ছোট ভাই পড়াশোনা করে
ei kajti khub guruttopurno|এই কাজটি খুব গুরুত্বপূর্ণ
ami nijer dokkhota barate chai|আমি নিজের দক্ষতা বাড়াতে চাই`,
  biodata: `amar bari chattogram jelay|আমার বাড়ি চট্টগ্রাম জেলায়
ami ekjon shikkharthi|আমি একজন শিক্ষার্থী
tumi kemon acho|তুমি কেমন আছো
amar onek khushi lagche|আমার অনেক খুশি লাগছে
se amake ekta boi diyeche|সে আমাকে একটা বই দিয়েছে
amra kal bikele berate jabo|আমরা কাল বিকেলে বেড়াতে যাব
apni ki cha khaben|আপনি কি চা খাবেন
ami rate bhat khai|আমি রাতে ভাত খাই
amar mathay betha korche|আমার মাথায় ব্যথা করছে
baire khub brishti hocche|বাইরে খুব বৃষ্টি হচ্ছে
ami tomar jonno opekkha korchi|আমি তোমার জন্য অপেক্ষা করছি
tar sathe amar porichoy hoyeche|তার সাথে আমার পরিচয় হয়েছে
ami ei bishoye kichu jani na|আমি এই বিষয়ে কিছু জানি না
amader poribare pach jon sodossho|আমাদের পরিবারে পাঁচ জন সদস্য
ami sokale ghum theke uthi|আমি সকালে ঘুম থেকে উঠি
se protidin namaj pore|সে প্রতিদিন নামাজ পড়ে
ami amar dayitto palon kori|আমি আমার দায়িত্ব পালন করি
ami doler netritto diyechi|আমি দলের নেতৃত্ব দিয়েছি
amar kajer obhiggota dui bochor|আমার কাজের অভিজ্ঞতা দুই বছর
ami somoyer mullo bujhi|আমি সময়ের মূল্য বুঝি
ami notun poribeshe manie nite pari|আমি নতুন পরিবেশে মানিয়ে নিতে পারি
amar hater lekha sundor|আমার হাতের লেখা সুন্দর
ami sottobadi ebong binoyi|আমি সত্যবাদী এবং বিনয়ী
ami uporer tottho sotto bole ghoshona korchi|আমি উপরের তথ্য সত্য বলে ঘোষণা করছি
apnar bisshosto|আপনার বিশ্বস্ত
binito nibedok|বিনীত নিবেদক
ami ukto pode ekjon prarthi|আমি উক্ত পদে একজন প্রার্থী
amar jibonbrittanto songjukto kora holo|আমার জীবনবৃত্তান্ত সংযুক্ত করা হলো
ami asha kori apni amar abedon bibechona korben|আমি আশা করি আপনি আমার আবেদন বিবেচনা করবেন
dhormo islam|ধর্ম ইসলাম
jatiyota bangladeshi|জাতীয়তা বাংলাদেশি
boibahik obostha obibahito|বৈবাহিক অবস্থা অবিবাহিত
rokter grup|রক্তের গ্রুপ
uchchota pach fut|উচ্চতা পাঁচ ফুট
ami gan shunte bhalobashi|আমি গান শুনতে ভালোবাসি
boi pora amar shokh|বই পড়া আমার শখ
ami desher jonno kaj korte chai|আমি দেশের জন্য কাজ করতে চাই
shikkha jatir merudondo|শিক্ষা জাতির মেরুদণ্ড
ami amar ma babake khub bhalobashi|আমি আমার মা বাবাকে খুব ভালোবাসি
tumi kothay thako|তুমি কোথায় থাকো
ami dhakay thaki|আমি ঢাকায় থাকি
amar boyosh pochish bochor|আমার বয়স পঁচিশ বছর
ami ekta chakri khujchi|আমি একটা চাকরি খুঁজছি
doya kore amake janaben|দয়া করে আমাকে জানাবেন
apnar uttorer opekkhay roilam|আপনার উত্তরের অপেক্ষায় রইলাম
shuvo jonmodin|শুভ জন্মদিন
eid mubarak|ঈদ মোবারক
amar priyo rong nil|আমার প্রিয় রং নীল
ami tader sahajjo korechi|আমি তাদের সাহায্য করেছি`,
  daily: `amar ghore ekta choto biral ache|আমার ঘরে একটা ছোট বিড়াল আছে
ami protidin khoborer kagoj pori|আমি প্রতিদিন খবরের কাগজ পড়ি
tumi amar sathe bazare jabe|তুমি আমার সাথে বাজারে যাবে
ajker abohawa khub sundor|আজকের আবহাওয়া খুব সুন্দর
ami tomar kotha bujhte parchi na|আমি তোমার কথা বুঝতে পারছি না
se onek dur theke eseche|সে অনেক দূর থেকে এসেছে
amader gramer nam shantipur|আমাদের গ্রামের নাম শান্তিপুর
ami ei kajer jonno upojukto|আমি এই কাজের জন্য উপযুক্ত
amar shikkhok amake onek sahajjo korechen|আমার শিক্ষক আমাকে অনেক সাহায্য করেছেন
ami biswas kori porisrom korle sofol howa jay|আমি বিশ্বাস করি পরিশ্রম করলে সফল হওয়া যায়
apnar protisthaner unnotite obodan rakhte chai|আপনার প্রতিষ্ঠানের উন্নতিতে অবদান রাখতে চাই
ami druto notun kaj shikhte pari|আমি দ্রুত নতুন কাজ শিখতে পারি
amar jogajog dokkhota bhalo|আমার যোগাযোগ দক্ষতা ভালো
ami chaper moddheo kaj korte pari|আমি চাপের মধ্যেও কাজ করতে পারি
ami bibhinno somajik kaje ongshogrohon korechi|আমি বিভিন্ন সামাজিক কাজে অংশগ্রহণ করেছি
amar baba ekjon krishok|আমার বাবা একজন কৃষক
ami gram theke shohore eshechi|আমি গ্রাম থেকে শহরে এসেছি
tara sobai mile khela dekhche|তারা সবাই মিলে খেলা দেখছে
amar choto boner boyosh dosh bochor|আমার ছোট বোনের বয়স দশ বছর
ei bochor ami porikkha debo|এই বছর আমি পরীক্ষা দেব
ami kokhono mittha boli na|আমি কখনো মিথ্যা বলি না
shobar age nijer kaj shesh koro|সবার আগে নিজের কাজ শেষ করো
ami ranna korte pari|আমি রান্না করতে পারি
amar priyo khabar biriyani|আমার প্রিয় খাবার বিরিয়ানি
ami sorkari kormokorta hote chai|আমি সরকারি কর্মকর্তা হতে চাই
amar bondhura amake sahajjo kore|আমার বন্ধুরা আমাকে সাহায্য করে
ami tin bochor dhore ei protisthane kaj korchi|আমি তিন বছর ধরে এই প্রতিষ্ঠানে কাজ করছি
ami nije nije onek kichu shikhechi|আমি নিজে নিজে অনেক কিছু শিখেছি
ami apnar shathe dekha korte chai|আমি আপনার সাথে দেখা করতে চাই
doya kore ektu opekkha korun|দয়া করে একটু অপেক্ষা করুন
amar thikana niche deya holo|আমার ঠিকানা নিচে দেয়া হলো
ami ei totthogulo sothik bole nishchit korchi|আমি এই তথ্যগুলো সঠিক বলে নিশ্চিত করছি
bhobishshote ami aro bhalo korbo|ভবিষ্যতে আমি আরো/আরও ভালো করব
amar ma amake khub bhalobashen|আমার মা আমাকে খুব ভালোবাসেন
se ekhono asheni|সে এখনো আসেনি
ami kichui bujhte parini|আমি কিছুই বুঝতে পারিনি
amader shobar uchit desher jonno kaj kora|আমাদের সবার উচিত দেশের জন্য কাজ করা
ajke amar mon bhalo nei|আজকে আমার মন ভালো নেই
tumi ki amar sathe jabe|তুমি কি আমার সাথে যাবে
ami bangla ebong ingreji dui bhashatei dokkho|আমি বাংলা এবং ইংরেজি দুই ভাষাতেই দক্ষ`,
  cover: `ami apnader protisthane sohokari hisabrokkhok pode abedon korte icchuk|আমি আপনাদের প্রতিষ্ঠানে সহকারী হিসাবরক্ষক পদে আবেদন করতে ইচ্ছুক
ami dhaka bishwabidyaloy theke hisab biggane snatok korechi|আমি ঢাকা বিশ্ববিদ্যালয় থেকে হিসাব বিজ্ঞানে স্নাতক করেছি
amar pach bochorer kormo obhiggota roeche|আমার পাঁচ বছরের কর্ম অভিজ্ঞতা রয়েছে
ami somoymoto kaj shesh korte obhyosto|আমি সময়মতো কাজ শেষ করতে অভ্যস্ত
ami doler sathe mile kaj korte pochondo kori|আমি দলের সাথে মিলে কাজ করতে পছন্দ করি
amar matribhasha bangla|আমার মাতৃভাষা বাংলা
ami ingrejite kotha bolte pari|আমি ইংরেজিতে কথা বলতে পারি
ami computer chalonay parodorshi|আমি কম্পিউটার চালনায় পারদর্শী
amar sokh boi pora ebong bhromon kora|আমার শখ বই পড়া এবং ভ্রমণ করা
ami sotota o nishthar sathe dayitto palon kori|আমি সততা ও নিষ্ঠার সাথে দায়িত্ব পালন করি
amar bortoman thikana mirpur dhaka|আমার বর্তমান ঠিকানা মিরপুর ঢাকা
amar gramer bari kumilla jelay|আমার গ্রামের বাড়ি কুমিল্লা জেলায়
amar babar nam abdul karim|আমার বাবার নাম আবদুল/আব্দুল করিম
ami bibahito ebong amar dui sontan ache|আমি বিবাহিত এবং আমার দুই সন্তান আছে
amar jonmo dhakay|আমার জন্ম ঢাকায়
ami namaj pori ebong roja rakhi|আমি নামাজ পড়ি এবং রোজা রাখি
tumi kokhon bari firbe|তুমি কখন বাড়ি ফিরবে
ami tomar opekkhay achi|আমি তোমার অপেক্ষায় আছি
amader desh onek sundor|আমাদের দেশ অনেক সুন্দর
ami gotokal bazar theke mach kinechi|আমি গতকাল বাজার থেকে মাছ কিনেছি
se amar kotha shunlo na|সে আমার কথা শুনল না
apni kothay thaken|আপনি কোথায় থাকেন
ami ekhane notun eshechi|আমি এখানে নতুন এসেছি
tomar sathe kotha bole khub bhalo laglo|তোমার সাথে কথা বলে খুব ভালো লাগল
ami chesta korbo|আমি চেষ্টা করব
amar onurodh rakhben|আমার অনুরোধ রাখবেন
apnar sodoy bibechonar jonno dhonnobad|আপনার সদয় বিবেচনার জন্য ধন্যবাদ
ami ashabadi je apni amake ekta sujog deben|আমি আশাবাদী যে আপনি আমাকে একটা সুযোগ দেবেন
nibedok apnar bisshosto|নিবেদক আপনার বিশ্বস্ত
tarikh ebong shakkhor|তারিখ এবং স্বাক্ষর
ami protishruti dicchi je ami kothor porisrom korbo|আমি প্রতিশ্রুতি দিচ্ছি যে আমি কঠোর পরিশ্রম করব
ami jibone boro hote chai|আমি জীবনে বড় হতে চাই
shikkhai jatir unnotir chabikathi|শিক্ষাই জাতির উন্নতির চাবিকাঠি
ami amar poribarke bhalobashi|আমি আমার পরিবারকে ভালোবাসি
amar bhai ekjon daktar|আমার ভাই একজন ডাক্তার
amra shobai eksathe thaki|আমরা সবাই একসাথে থাকি
ami ajke ektu besto|আমি আজকে একটু ব্যস্ত
kal amar porikkha ache|কাল আমার পরীক্ষা আছে
ami tomader kotha mone rakhbo|আমি তোমাদের কথা মনে রাখব
allah apnar mongol korun|আল্লাহ আপনার মঙ্গল করুন`,
}

const accepts = (expected: string, actual: string | null) => actual !== null && expected.split('/').includes(actual)
const contextOf = (category: string): BanglishContext => category === 'names' ? 'name' : category === 'resume' ? 'career' : 'general'

test('every authored word is NFC Bangla the reader can spell out', () => {
  const lists = [...banglaWordLists.core, ...banglaWordLists.formal, ...banglaWordLists.verbs, ...banglaWordLists.names]
  assert.ok(new Set(lists).size > 5000, `Only ${new Set(lists).size} distinct words`)
  const broken = lists.filter((word) => word !== word.normalize('NFC') || !/^[\u0980-\u09ff]+$/u.test(word) || !banglaSlots(word))
  assert.deepEqual(broken, [])
  // The most frequent words settle ties, so that list must stay small and deliberate.
  assert.ok(banglaWordLists.core.length < 1400)
})

test('casual single words: the reader recovers spellings the sound rules cannot know', () => {
  let total = 0, correct = 0
  for (const [category, text] of Object.entries(casualWords)) {
    const pairs = text.split(';').map((pair) => pair.trim()).filter(Boolean).map((pair) => pair.split('|'))
    const failures = pairs.filter(([source, expected]) => !accepts(expected, convertWord(source, { context: contextOf(category) })))
      .map(([source, expected]) => `${source} -> ${convertWord(source, { context: contextOf(category) })} (${expected})`)
    total += pairs.length
    correct += pairs.length - failures.length
    assert.ok(failures.length <= pairs.length * 0.04, `${category}: ${failures.length}/${pairs.length} wrong: ${failures.join(', ')}`)
  }
  assert.equal(total, 252)
  assert.ok(correct / total >= 0.98, `${correct}/${total}`)
})

for (const [name, text] of Object.entries(casualSentences)) {
  test(`casual sentences (${name}): at least 97% of words become the standard spelling`, () => {
    const failures: string[] = []
    let total = 0
    for (const line of text.split('\n')) {
      const [roman, bangla] = line.split('|')
      const typed = roman.split(' '), expected = bangla.split(' ')
      assert.equal(typed.length, expected.length, line)
      typed.forEach((word, index) => {
        total++
        const actual = convertWord(word) ?? word
        if (!accepts(expected[index], actual)) failures.push(`${word} -> ${actual} (${expected[index]})`)
      })
    }
    assert.ok(total >= 190, `${name} has only ${total} words`)
    assert.ok(failures.length <= total * 0.03, `${failures.length}/${total} wrong: ${[...new Set(failures)].join(', ')}`)
  })
}

test('one word is reached from every way people romanize it', () => {
  const spellings: Record<string, string[]> = {
    'বিশ্বাস': ['bishwas', 'bisshash', 'bissas', 'biswas', 'bishshash'],
    'ধন্যবাদ': ['dhonnobad', 'dhonyobad', 'dhonnobaad'],
    'বিশ্ববিদ্যালয়': ['bishwobiddaloy', 'bisshobiddaloy', 'bishwabidyaloy', 'bissobiddaloy'],
    'স্বাক্ষর': ['shakkhor', 'sakkhor', 'swakkhor'],
    'লক্ষ্য': ['lokkho', 'lokkhyo'],
    'জ্ঞান': ['gyan', 'ggan'],
    'দুঃখ': ['dukkho', 'dukho'],
    'আনোয়ার': ['anwar', 'anowar', 'anoar'],
  }
  for (const [expected, typed] of Object.entries(spellings)) {
    for (const source of typed) assert.equal(convertWord(source, { context: expected === 'আনোয়ার' ? 'name' : 'general' }), expected, source)
  }
})

test('between two real words the everyday one wins, and the other stays one key away', () => {
  for (const [source, expected] of [['taka', 'টাকা'], ['kal', 'কাল'], ['keno', 'কেন'], ['koro', 'করো'], ['kalo', 'কালো'], ['doya', 'দয়া'], ['doa', 'দোয়া'], ['bari', 'বাড়ি'], ['nodi', 'নদী']]) {
    assert.equal(convertWord(source), expected, source)
  }
  assert.ok(suggestReadings('pore').includes('পড়ে'), 'পরে and পড়ে are both typed "pore"')
  assert.ok(suggestReadings('taka').includes('তাকা'), 'The plain phonetic spelling is always offered')
  for (const source of ['pore', 'taka', 'kal', 'bari']) assert.ok(suggestReadings(source).length <= 3)
})

test('explicit capitals still decide, and a leading capital is not mistaken for one', () => {
  assert.equal(convertWord('Taka'), 'টাকা')
  assert.equal(convertWord('Dhonnobad'), 'ধন্যবাদ')
  assert.equal(convertWord('baRi'), 'বাড়ি')
  // A marked retroflex refuses the dental word: paTa is not পাতা.
  assert.equal(convertWord('pata'), 'পাতা')
  assert.equal(convertWord('paTa'), 'পাটা')
  assert.equal(convertWord('aShTha'), 'আষ্ঠা')
  for (const [source, expected] of [['Sumi', 'সুমি'], ['Uddin', 'উদ্দিন'], ['Roy', 'রায়'], ['Sheikh', 'শেখ'], ['Rahim', 'রহিম'], ['Liton', 'লিটন']]) {
    assert.equal(convertWord(source, { context: 'name' }), expected, source)
  }
})

test('inflections attach only where Bangla writes them', () => {
  for (const [source, expected] of [['kajer', 'কাজের'], ['bondhur', 'বন্ধুর'], ['barite', 'বাড়িতে'], ['boiyer', 'বইয়ের'], ['mayer', 'মায়ের'],
    ['ghore', 'ঘরে'], ['hatte', 'হাঁটতে'], ['porte', 'পড়তে'], ['matar', 'মাতার'], ['bhobishshote', 'ভবিষ্যতে'], ['asheni', 'আসেনি'],
    ['moddheo', 'মধ্যেও'], ['bhashatei', 'ভাষাতেই'], ['chaper', 'চাপের'], ['totthogulo', 'তথ্যগুলো']]) {
    assert.equal(convertWord(source), expected, source)
  }
  // An unknown word is never rebuilt out of a short word plus stray endings.
  assert.equal(convertWord('biri'), 'বিরি')
  assert.equal(convertWord('biriyani'), 'বিরিয়ানি')
  // A sentence mark typed against the word does not hide the word from the reader.
  assert.equal(convertWord('dhonnobad,'), 'ধন্যবাদ,')
  assert.equal(convertWord('achen?'), 'আছেন?')
  assert.equal(convertWord('Excel,'), null)
  assert.equal(convertWord('k,,', { force: true }), 'ক্')
})

test('two known words typed as one are joined; unknown words keep the phonetic rules', () => {
  assert.equal(convertWord('shikkhajibon'), 'শিক্ষাজীবন')
  assert.equal(convertWord('nurjahan', { context: 'name' }), 'নূরজাহান')
  // Casual typing leaves the glide out; explicit phonetic mode keeps the letters exact.
  assert.equal(convertWord('pulia'), 'পুলিয়া')
  assert.equal(convertWord('pulia', { force: true }), 'পুলিআ')
  assert.equal(convertWord('icche'), 'ইচ্ছে')
  assert.equal(convertWord('icche', { force: true }), 'ইকচে')
})

test('the reader is strict about what it calls a match', () => {
  const slots = banglaSlots('ধন্যবাদ')!
  assert.equal(readCosts('dhonnobad', slots)[9], 0)
  assert.equal(readCosts('dhonnobod', slots)[9], Infinity, 'A wrong vowel is not a looser match')
  assert.equal(readCosts('dhonnoba', slots)[8], Infinity, 'A word is read whole')
  assert.ok(acceptableCost(3) < acceptableCost(4) && acceptableCost(4) < acceptableCost(8))
  assert.equal(banglaSlots('abc'), null)
  assert.equal(banglaSlots(''), null)
})

test('typing stays instant: a keystroke of suggestions costs milliseconds, not frames', () => {
  convertWord('ami')
  const samples = 'tomake valobashi dhonnobad bishwabidyaloy protisthan obhiggota jonmodin kemon achen porisromi dayittoshil korechilam'.split(' ')
  const started = performance.now()
  let calls = 0
  for (const word of samples) for (let end = 1; end <= word.length; end++) { suggestReadings(`${word.slice(0, end)}q`); calls++ }
  const average = (performance.now() - started) / calls
  assert.ok(average < 25, `${average.toFixed(2)} ms per uncached keystroke`)
})