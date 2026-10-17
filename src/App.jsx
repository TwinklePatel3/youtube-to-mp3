import { createContext, useContext, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "https://youtube-to-mp3-rhww.onrender.com";

const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
];

const EMPTY_SONG = {
  title: "",
  artist: "",
  thumbnail: "",
  album: "",
  year: "",
  composer: "",
  genre: "",
  appleCover: "",
  videoId: "",
  duration: 0,
};

const QUALITIES = [
  { value: "128", title: "128 kbps", noteKey: "noteSmaller", badgeKey: "badgeLight" },
  { value: "320", title: "320 kbps", noteKey: "noteHigher", badgeKey: "badgeHifi" },
];

const TAG_FIELDS = [
  { key: "title", labelKey: "fieldTitle", wide: true },
  { key: "artist", labelKey: "fieldArtist", wide: true },
  { key: "album", labelKey: "fieldAlbum" },
  { key: "year", labelKey: "fieldYear" },
  { key: "genre", labelKey: "fieldGenre" },
  { key: "composer", labelKey: "fieldComposer" },
];

const INITIAL_COVER = { source: "auto", coverId: "", preview: "", uploading: false, error: "" };
const INITIAL_AUDIO = { normalize: false, start: "", end: "" };
const COVER_LABEL = { auto: "coverAuto", apple: "coverApple", youtube: "coverYoutube", custom: "coverCustom" };

// "1:05" -> 65, "" -> 0, invalid -> NaN
const parseTime = (text) => {
  const t = String(text || "").trim();
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

const STEPS = ["stepPrepare", "stepConvert", "stepSave"];
const STEP_OF = { preparing: 0, converting: 1 };

const glass = "glass"; // styled in EXTRA_CSS (light + dark)

const gradient = "bg-gradient-to-r from-red-500 via-pink-500 to-purple-500";

/* -------------------------------------------------------------------------- */
/* LANGUAGES (English, Hindi, Gujarati)                                        */
/* -------------------------------------------------------------------------- */

const STRINGS = {
  "en": {
    "brandTagline": "Simple · Fast · Beautiful",
    "statusPill": "Ready to convert",
    "badge": "Free to use · No sign-up",
    "heroLine1": "Your music.",
    "heroLine2": "Your MP3.",
    "heroSub": "Paste a YouTube link and turn it into a polished MP3 with artwork, title, artist and album information ready for your music library.",
    "linkLabel": "YouTube link",
    "placeholder": "Paste your YouTube link…",
    "paste": "Paste",
    "finding": "Finding",
    "findSong": "Find song",
    "pillCover": "Cover artwork",
    "pillTags": "Music tags",
    "pillQuality": "128 / 320 kbps",
    "pillShorts": "Shorts supported",
    "tryAgain": "Try again",
    "ready": "Ready",
    "unknownArtist": "Unknown artist",
    "lookingUp": "Looking up album and credits…",
    "musicBy": "Music by",
    "editTags": "Edit tags",
    "doneEditing": "Done editing",
    "resetDetected": "Reset to detected",
    "editHint": "These values are written into the MP3. Leave a field empty to keep the detected value.",
    "coverArt": "Cover art",
    "replaceImage": "Replace your image",
    "audioOptions": "Audio options",
    "evenVolume": "Even out the volume",
    "evenVolumeHint": "Normalizes loudness so songs play at a similar level.",
    "startAt": "Start at",
    "endAt": "End at",
    "trimHint": "Cut the beginning or the end. Use minutes and seconds, like 1:05. Leave both empty to keep the whole song.",
    "audioQuality": "Audio quality",
    "qualityHint": "Choose the balance between size and quality.",
    "cancel": "Cancel",
    "downloadMp3": "Download MP3",
    "mp3Ready": "Your MP3 is ready",
    "readyHelp": "If the download didn't start, tap Save MP3. On iPhone or iPad, choose Download, or Share then Save to Files.",
    "saveMp3": "Save MP3",
    "convertAnother": "Convert another",
    "footer": "Made for your music library",
    "selected": "Selected",
    "mp3Audio": "MP3 Audio",
    "noteSmaller": "Smaller file",
    "noteHigher": "Higher quality",
    "badgeLight": "Light",
    "badgeHifi": "Hi-Fi",
    "fieldTitle": "Title",
    "fieldArtist": "Artist(s)",
    "fieldAlbum": "Album / movie",
    "fieldYear": "Year",
    "fieldGenre": "Genre",
    "fieldComposer": "Composer",
    "coverAuto": "Automatic",
    "coverApple": "Apple Music",
    "coverYoutube": "YouTube thumbnail",
    "coverCustom": "Your image",
    "subBest": "Best available",
    "subOfficial": "Official art",
    "subNoMatch": "No match found",
    "subThumb": "Video thumbnail",
    "upload": "Upload",
    "uploading": "Uploading…",
    "subTypes": "JPG, PNG or WebP",
    "sumEven": "Even volume",
    "sumTrimmed": "Trimmed",
    "sumOriginal": "Original",
    "stepPrepare": "Prepare",
    "stepConvert": "Convert",
    "stepSave": "Save",
    "preparing": "Preparing",
    "converting": "Converting",
    "statusPreparing": "Contacting YouTube. The first request can take a little longer.",
    "statusConverting": "Converting your audio and adding artwork & tags.",
    "errPaste": "Paste a YouTube link to continue.",
    "errNotYoutube": "That doesn't look like a YouTube link. Copy it from the address bar or the Share button.",
    "errLoadVideo": "Couldn't load this video. Check the link and try again.",
    "errClipboardEmpty": "Your clipboard doesn't contain a link.",
    "errClipboard": "Couldn't read the clipboard. Paste the link into the box instead.",
    "errImageType": "Use a JPG, PNG or WebP image.",
    "errImageSize": "That image is too large (max 6 MB).",
    "errUpload": "Upload failed. Please try again.",
    "errImageSmall": "The image must be a JPG, PNG or WebP of at least 200 px.",
    "errImageRead": "That file couldn't be read as an image.",
    "errTimes": "Check the start and end times. Use minutes and seconds, like 1:05.",
    "errEndAfterStart": "The end time must be later than the start time.",
    "errStartPastEnd": "The start time is past the end of the song.",
    "cancelled": "Download cancelled.",
    "errStart": "Couldn't start the download. Please try again.",
    "errConvert": "Conversion failed. Please try again.",
    "errSlow": "This is taking too long. Please try again.",
    "errGeneric": "Something went wrong. Please try again.",
    "errBusy": "The converter is busy right now. Try again in a few seconds.",
    "errBlocked": "YouTube is blocking the server right now. Please try again in a little while.",
    "errUnavailable": "This video isn't available for download.",
    "errTooMany": "Too many uploads. Please wait a few minutes.",
    "language": "Language",
    "lightMode": "Switch to light mode",
    "darkMode": "Switch to dark mode"
  },
  "hi": {
    "brandTagline": "सरल · तेज़ · सुंदर",
    "statusPill": "कन्वर्ट करने के लिए तैयार",
    "badge": "मुफ़्त · साइन-अप की ज़रूरत नहीं",
    "heroLine1": "आपका संगीत।",
    "heroLine2": "आपका MP3।",
    "heroSub": "YouTube लिंक पेस्ट करें और उसे आर्टवर्क, टाइटल, कलाकार और एल्बम की जानकारी के साथ एक बढ़िया MP3 में बदलें, जो आपकी म्यूज़िक लाइब्रेरी के लिए तैयार हो।",
    "linkLabel": "YouTube लिंक",
    "placeholder": "अपना YouTube लिंक यहाँ पेस्ट करें…",
    "paste": "पेस्ट",
    "finding": "खोज रहे हैं",
    "findSong": "गाना खोजें",
    "pillCover": "कवर आर्टवर्क",
    "pillTags": "म्यूज़िक टैग",
    "pillQuality": "128 / 320 kbps",
    "pillShorts": "Shorts समर्थित",
    "tryAgain": "फिर कोशिश करें",
    "ready": "तैयार",
    "unknownArtist": "अज्ञात कलाकार",
    "lookingUp": "एल्बम और क्रेडिट खोजे जा रहे हैं…",
    "musicBy": "संगीत:",
    "editTags": "टैग बदलें",
    "doneEditing": "बदलाव पूरा",
    "resetDetected": "पहचाने गए मान पर लौटें",
    "editHint": "ये मान MP3 में लिखे जाएँगे। पहचाना गया मान रखने के लिए खाना खाली छोड़ें।",
    "coverArt": "कवर आर्ट",
    "replaceImage": "अपनी इमेज बदलें",
    "audioOptions": "ऑडियो विकल्प",
    "evenVolume": "आवाज़ बराबर करें",
    "evenVolumeHint": "लाउडनेस को सामान्य करता है ताकि सभी गाने लगभग एक जैसी आवाज़ में बजें।",
    "startAt": "शुरू",
    "endAt": "अंत",
    "trimHint": "शुरुआत या अंत काटें। मिनट और सेकंड में लिखें, जैसे 1:05। पूरा गाना रखने के लिए दोनों खाली छोड़ें।",
    "audioQuality": "ऑडियो क्वालिटी",
    "qualityHint": "फ़ाइल साइज़ और क्वालिटी के बीच संतुलन चुनें।",
    "cancel": "रद्द करें",
    "downloadMp3": "MP3 डाउनलोड करें",
    "mp3Ready": "आपका MP3 तैयार है",
    "readyHelp": "अगर डाउनलोड शुरू नहीं हुआ, तो MP3 सेव करें पर टैप करें। iPhone या iPad पर डाउनलोड चुनें, या शेयर करके 'Files में सेव करें' चुनें।",
    "saveMp3": "MP3 सेव करें",
    "convertAnother": "दूसरा गाना बदलें",
    "footer": "आपकी म्यूज़िक लाइब्रेरी के लिए",
    "selected": "चुना गया",
    "mp3Audio": "MP3 ऑडियो",
    "noteSmaller": "छोटी फ़ाइल",
    "noteHigher": "बेहतर क्वालिटी",
    "badgeLight": "हल्का",
    "badgeHifi": "Hi-Fi",
    "fieldTitle": "शीर्षक",
    "fieldArtist": "कलाकार",
    "fieldAlbum": "एल्बम / फ़िल्म",
    "fieldYear": "वर्ष",
    "fieldGenre": "शैली",
    "fieldComposer": "संगीतकार",
    "coverAuto": "स्वचालित",
    "coverApple": "Apple Music",
    "coverYoutube": "YouTube थंबनेल",
    "coverCustom": "आपकी इमेज",
    "subBest": "सबसे अच्छा उपलब्ध",
    "subOfficial": "आधिकारिक आर्ट",
    "subNoMatch": "कोई मिलान नहीं",
    "subThumb": "वीडियो थंबनेल",
    "upload": "अपलोड",
    "uploading": "अपलोड हो रहा है…",
    "subTypes": "JPG, PNG या WebP",
    "sumEven": "बराबर आवाज़",
    "sumTrimmed": "ट्रिम किया",
    "sumOriginal": "मूल",
    "stepPrepare": "तैयारी",
    "stepConvert": "कन्वर्ट",
    "stepSave": "सेव",
    "preparing": "तैयारी",
    "converting": "कन्वर्ट हो रहा है",
    "statusPreparing": "YouTube से जुड़ रहे हैं। पहली बार में थोड़ा समय लग सकता है।",
    "statusConverting": "ऑडियो कन्वर्ट हो रहा है और आर्टवर्क व टैग जोड़े जा रहे हैं।",
    "errPaste": "जारी रखने के लिए YouTube लिंक पेस्ट करें।",
    "errNotYoutube": "यह YouTube लिंक जैसा नहीं लग रहा। इसे एड्रेस बार या Share बटन से कॉपी करें।",
    "errLoadVideo": "यह वीडियो लोड नहीं हो सका। लिंक जाँचें और फिर कोशिश करें।",
    "errClipboardEmpty": "आपके क्लिपबोर्ड में कोई लिंक नहीं है।",
    "errClipboard": "क्लिपबोर्ड पढ़ा नहीं जा सका। लिंक को बॉक्स में पेस्ट करें।",
    "errImageType": "JPG, PNG या WebP इमेज इस्तेमाल करें।",
    "errImageSize": "यह इमेज बहुत बड़ी है (अधिकतम 6 MB)।",
    "errUpload": "अपलोड नहीं हो सका। कृपया फिर कोशिश करें।",
    "errImageSmall": "इमेज JPG, PNG या WebP होनी चाहिए और कम से कम 200 px की।",
    "errImageRead": "यह फ़ाइल इमेज के रूप में पढ़ी नहीं जा सकी।",
    "errTimes": "शुरू और अंत का समय जाँचें। मिनट और सेकंड में लिखें, जैसे 1:05।",
    "errEndAfterStart": "अंत का समय शुरू के समय के बाद का होना चाहिए।",
    "errStartPastEnd": "शुरू का समय गाने के अंत से आगे है।",
    "cancelled": "डाउनलोड रद्द किया गया।",
    "errStart": "डाउनलोड शुरू नहीं हो सका। कृपया फिर कोशिश करें।",
    "errConvert": "कन्वर्ट नहीं हो सका। कृपया फिर कोशिश करें।",
    "errSlow": "इसमें बहुत समय लग रहा है। कृपया फिर कोशिश करें।",
    "errGeneric": "कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।",
    "errBusy": "कन्वर्टर अभी व्यस्त है। कुछ सेकंड बाद फिर कोशिश करें।",
    "errBlocked": "YouTube अभी सर्वर को ब्लॉक कर रहा है। कृपया थोड़ी देर बाद फिर कोशिश करें।",
    "errUnavailable": "यह वीडियो डाउनलोड के लिए उपलब्ध नहीं है।",
    "errTooMany": "बहुत ज़्यादा अपलोड हो गए हैं। कृपया कुछ मिनट रुकें।",
    "language": "भाषा",
    "lightMode": "लाइट मोड पर जाएँ",
    "darkMode": "डार्क मोड पर जाएँ"
  },
  "gu": {
    "brandTagline": "સરળ · ઝડપી · સુંદર",
    "statusPill": "કન્વર્ટ કરવા તૈયાર",
    "badge": "મફત · સાઇન-અપની જરૂર નથી",
    "heroLine1": "તમારું સંગીત.",
    "heroLine2": "તમારું MP3.",
    "heroSub": "YouTube લિંક પેસ્ટ કરો અને તેને આર્ટવર્ક, ટાઇટલ, કલાકાર અને આલ્બમની માહિતી સાથે સરસ MP3 માં ફેરવો, જે તમારી મ્યુઝિક લાઇબ્રેરી માટે તૈયાર હોય.",
    "linkLabel": "YouTube લિંક",
    "placeholder": "તમારી YouTube લિંક અહીં પેસ્ટ કરો…",
    "paste": "પેસ્ટ",
    "finding": "શોધી રહ્યા છીએ",
    "findSong": "ગીત શોધો",
    "pillCover": "કવર આર્ટવર્ક",
    "pillTags": "મ્યુઝિક ટૅગ",
    "pillQuality": "128 / 320 kbps",
    "pillShorts": "Shorts સપોર્ટેડ",
    "tryAgain": "ફરી પ્રયાસ કરો",
    "ready": "તૈયાર",
    "unknownArtist": "અજાણ્યા કલાકાર",
    "lookingUp": "આલ્બમ અને ક્રેડિટ શોધી રહ્યા છીએ…",
    "musicBy": "સંગીત:",
    "editTags": "ટૅગ બદલો",
    "doneEditing": "ફેરફાર પૂરો",
    "resetDetected": "ઓળખાયેલી કિંમત પર પાછા જાઓ",
    "editHint": "આ કિંમતો MP3 માં લખાશે. ઓળખાયેલી કિંમત રાખવા માટે ખાનું ખાલી રાખો.",
    "coverArt": "કવર આર્ટ",
    "replaceImage": "તમારી ઇમેજ બદલો",
    "audioOptions": "ઑડિયો વિકલ્પો",
    "evenVolume": "અવાજ સરખો કરો",
    "evenVolumeHint": "લાઉડનેસ સામાન્ય કરે છે, જેથી બધાં ગીતો લગભગ સરખા અવાજે વાગે.",
    "startAt": "શરૂઆત",
    "endAt": "અંત",
    "trimHint": "શરૂઆત અથવા અંત કાપો. મિનિટ અને સેકન્ડમાં લખો, જેમ કે 1:05. આખું ગીત રાખવા બંને ખાલી રાખો.",
    "audioQuality": "ઑડિયો ક્વોલિટી",
    "qualityHint": "ફાઇલ સાઇઝ અને ક્વોલિટી વચ્ચે સંતુલન પસંદ કરો.",
    "cancel": "રદ કરો",
    "downloadMp3": "MP3 ડાઉનલોડ કરો",
    "mp3Ready": "તમારું MP3 તૈયાર છે",
    "readyHelp": "જો ડાઉનલોડ શરૂ ન થાય, તો MP3 સેવ કરો પર ટૅપ કરો. iPhone અથવા iPad પર ડાઉનલોડ પસંદ કરો, અથવા શેર કરીને 'Files માં સેવ કરો' પસંદ કરો.",
    "saveMp3": "MP3 સેવ કરો",
    "convertAnother": "બીજું ગીત કન્વર્ટ કરો",
    "footer": "તમારી મ્યુઝિક લાઇબ્રેરી માટે",
    "selected": "પસંદ કરેલ",
    "mp3Audio": "MP3 ઑડિયો",
    "noteSmaller": "નાની ફાઇલ",
    "noteHigher": "વધુ સારી ક્વોલિટી",
    "badgeLight": "હળવું",
    "badgeHifi": "Hi-Fi",
    "fieldTitle": "શીર્ષક",
    "fieldArtist": "કલાકાર",
    "fieldAlbum": "આલ્બમ / ફિલ્મ",
    "fieldYear": "વર્ષ",
    "fieldGenre": "શૈલી",
    "fieldComposer": "સંગીતકાર",
    "coverAuto": "આપમેળે",
    "coverApple": "Apple Music",
    "coverYoutube": "YouTube થંબનેલ",
    "coverCustom": "તમારી ઇમેજ",
    "subBest": "શ્રેષ્ઠ ઉપલબ્ધ",
    "subOfficial": "સત્તાવાર આર્ટ",
    "subNoMatch": "કોઈ મેળ મળ્યો નથી",
    "subThumb": "વિડિયો થંબનેલ",
    "upload": "અપલોડ",
    "uploading": "અપલોડ થઈ રહ્યું છે…",
    "subTypes": "JPG, PNG અથવા WebP",
    "sumEven": "સરખો અવાજ",
    "sumTrimmed": "ટ્રિમ કર્યું",
    "sumOriginal": "મૂળ",
    "stepPrepare": "તૈયારી",
    "stepConvert": "કન્વર્ટ",
    "stepSave": "સેવ",
    "preparing": "તૈયારી",
    "converting": "કન્વર્ટ થઈ રહ્યું છે",
    "statusPreparing": "YouTube સાથે જોડાઈ રહ્યા છીએ. પહેલી વાર થોડો વધુ સમય લાગી શકે છે.",
    "statusConverting": "ઑડિયો કન્વર્ટ થઈ રહ્યો છે અને આર્ટવર્ક તથા ટૅગ ઉમેરાઈ રહ્યા છે.",
    "errPaste": "આગળ વધવા માટે YouTube લિંક પેસ્ટ કરો.",
    "errNotYoutube": "આ YouTube લિંક જેવી લાગતી નથી. તેને એડ્રેસ બાર અથવા Share બટનમાંથી કૉપી કરો.",
    "errLoadVideo": "આ વિડિયો લોડ થઈ શક્યો નહીં. લિંક તપાસો અને ફરી પ્રયાસ કરો.",
    "errClipboardEmpty": "તમારા ક્લિપબોર્ડમાં કોઈ લિંક નથી.",
    "errClipboard": "ક્લિપબોર્ડ વાંચી શકાયું નહીં. લિંકને બૉક્સમાં પેસ્ટ કરો.",
    "errImageType": "JPG, PNG અથવા WebP ઇમેજ વાપરો.",
    "errImageSize": "આ ઇમેજ ખૂબ મોટી છે (વધુમાં વધુ 6 MB).",
    "errUpload": "અપલોડ નિષ્ફળ ગયું. કૃપા કરીને ફરી પ્રયાસ કરો.",
    "errImageSmall": "ઇમેજ JPG, PNG અથવા WebP હોવી જોઈએ અને ઓછામાં ઓછી 200 px ની.",
    "errImageRead": "આ ફાઇલ ઇમેજ તરીકે વાંચી શકાઈ નહીં.",
    "errTimes": "શરૂઆત અને અંતનો સમય તપાસો. મિનિટ અને સેકન્ડમાં લખો, જેમ કે 1:05.",
    "errEndAfterStart": "અંતનો સમય શરૂઆતના સમય પછીનો હોવો જોઈએ.",
    "errStartPastEnd": "શરૂઆતનો સમય ગીતના અંતથી આગળ છે.",
    "cancelled": "ડાઉનલોડ રદ કરાયું.",
    "errStart": "ડાઉનલોડ શરૂ થઈ શક્યું નહીં. કૃપા કરીને ફરી પ્રયાસ કરો.",
    "errConvert": "કન્વર્ટ થઈ શક્યું નહીં. કૃપા કરીને ફરી પ્રયાસ કરો.",
    "errSlow": "આમાં ખૂબ સમય લાગી રહ્યો છે. કૃપા કરીને ફરી પ્રયાસ કરો.",
    "errGeneric": "કંઈક ખોટું થયું. કૃપા કરીને ફરી પ્રયાસ કરો.",
    "errBusy": "કન્વર્ટર હાલમાં વ્યસ્ત છે. થોડી સેકન્ડ પછી ફરી પ્રયાસ કરો.",
    "errBlocked": "YouTube હાલમાં સર્વરને બ્લૉક કરી રહ્યું છે. કૃપા કરીને થોડી વાર પછી ફરી પ્રયાસ કરો.",
    "errUnavailable": "આ વિડિયો ડાઉનલોડ માટે ઉપલબ્ધ નથી.",
    "errTooMany": "ઘણા બધા અપલોડ થઈ ગયા છે. કૃપા કરીને થોડી મિનિટ રાહ જુઓ.",
    "language": "ભાષા",
    "lightMode": "લાઇટ મોડ પર જાઓ",
    "darkMode": "ડાર્ક મોડ પર જાઓ"
  }
};

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी" },
  { code: "gu", name: "ગુજરાતી" },
];

// messages that come from the server in English -> translation keys
const SERVER_MESSAGES = [
  [/busy right now/i, "errBusy"],
  [/blocking the server/i, "errBlocked"],
  [/isn't available for download/i, "errUnavailable"],
  [/too many uploads/i, "errTooMany"],
  [/valid YouTube URL/i, "errNotYoutube"],
  [/Could not retrieve video information/i, "errLoadVideo"],
  [/Conversion failed/i, "errConvert"],
  [/Download cancelled/i, "cancelled"],
  [/at least 200 px/i, "errImageSmall"],
  [/couldn't be read as an image/i, "errImageRead"],
  [/Upload failed/i, "errUpload"],
  [/Something went wrong/i, "errGeneric"],
];

const I18nContext = createContext({ t: (key) => STRINGS.en[key] || key, lang: "en" });
const useT = () => useContext(I18nContext);

const EXTRA_CSS = String.raw`
.glass{border:1px solid rgba(255,255,255,.8);background:rgba(255,255,255,.65);-webkit-backdrop-filter:blur(40px);backdrop-filter:blur(40px);box-shadow:0 24px 80px rgba(60,40,120,.10),inset 0 1px 0 rgba(255,255,255,.95)}
.theme-dark .glass{border-color:rgba(255,255,255,.09);background:rgba(24,24,40,.62);box-shadow:0 24px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06)}
.theme-dark{color-scheme:dark}
.theme-dark input,.theme-dark select{color:#f1f5f9}
.lang-indic,.lang-indic *{letter-spacing:normal!important}
.lang-indic h1{line-height:1.22!important}
.lang-indic h2{line-height:1.3!important}
.theme-dark .bg-\[\#f7f7fb\],.theme-dark.bg-\[\#f7f7fb\]{background-color:#0b0b14}
.theme-dark .bg-\[radial-gradient\(ellipse_at_top\,transparent_35\%\,\#f7f7fb_100\%\)\],.theme-dark.bg-\[radial-gradient\(ellipse_at_top\,transparent_35\%\,\#f7f7fb_100\%\)\]{background-image:radial-gradient(ellipse at top,transparent 35%,#0b0b14 100%)}
.theme-dark .bg-emerald-100,.theme-dark.bg-emerald-100{background-color:rgba(16,185,129,.18)}
.theme-dark .bg-pink-100,.theme-dark.bg-pink-100{background-color:rgba(236,72,153,.18)}
.theme-dark .bg-pink-300\/25,.theme-dark.bg-pink-300\/25{background-color:rgba(249,168,212,.12)}
.theme-dark .bg-pink-50,.theme-dark.bg-pink-50{background-color:rgba(236,72,153,.12)}
.theme-dark .bg-pink-50\/80,.theme-dark.bg-pink-50\/80{background-color:rgba(236,72,153,.12)}
.theme-dark .bg-purple-300\/30,.theme-dark.bg-purple-300\/30{background-color:rgba(216,180,254,.12)}
.theme-dark .bg-red-100,.theme-dark.bg-red-100{background-color:rgba(239,68,68,.18)}
.theme-dark .bg-red-300\/30,.theme-dark.bg-red-300\/30{background-color:rgba(252,165,165,.12)}
.theme-dark .bg-red-50\/80,.theme-dark.bg-red-50\/80{background-color:rgba(239,68,68,.10)}
.theme-dark .bg-slate-100,.theme-dark.bg-slate-100{background-color:rgba(255,255,255,.08)}
.theme-dark .bg-slate-200,.theme-dark.bg-slate-200{background-color:rgba(255,255,255,.12)}
.theme-dark .bg-slate-200\/70,.theme-dark.bg-slate-200\/70{background-color:rgba(255,255,255,.10)}
.theme-dark .bg-slate-300,.theme-dark.bg-slate-300{background-color:rgba(255,255,255,.20)}
.theme-dark .bg-slate-900,.theme-dark.bg-slate-900{background-color:#e5e7eb;color:#0f172a}
.theme-dark .bg-white,.theme-dark.bg-white{background-color:#1c1c2c}
.theme-dark .bg-white\/45,.theme-dark.bg-white\/45{background-color:rgba(255,255,255,0.06)}
.theme-dark .bg-white\/50,.theme-dark.bg-white\/50{background-color:rgba(255,255,255,0.068)}
.theme-dark .bg-white\/55,.theme-dark.bg-white\/55{background-color:rgba(255,255,255,0.077)}
.theme-dark .bg-white\/60,.theme-dark.bg-white\/60{background-color:rgba(255,255,255,0.085)}
.theme-dark .bg-white\/65,.theme-dark.bg-white\/65{background-color:rgba(255,255,255,0.094)}
.theme-dark .bg-white\/70,.theme-dark.bg-white\/70{background-color:rgba(255,255,255,0.102)}
.theme-dark .bg-white\/80,.theme-dark.bg-white\/80{background-color:rgba(255,255,255,0.119)}
.theme-dark .border-emerald-100,.theme-dark.border-emerald-100{border-color:rgba(16,185,129,.30)}
.theme-dark .border-red-100,.theme-dark.border-red-100{border-color:rgba(239,68,68,.30)}
.theme-dark .border-slate-200\/80,.theme-dark.border-slate-200\/80{border-color:rgba(255,255,255,.12)}
.theme-dark .border-slate-300,.theme-dark.border-slate-300{border-color:rgba(255,255,255,.22)}
.theme-dark .border-white,.theme-dark.border-white{border-color:rgba(255,255,255,.10)}
.theme-dark .border-white\/50,.theme-dark.border-white\/50{border-color:rgba(255,255,255,0.08)}
.theme-dark .border-white\/70,.theme-dark.border-white\/70{border-color:rgba(255,255,255,0.096)}
.theme-dark .border-white\/80,.theme-dark.border-white\/80{border-color:rgba(255,255,255,0.104)}
.theme-dark .border-white\/90,.theme-dark.border-white\/90{border-color:rgba(255,255,255,0.112)}
.theme-dark .focus-within\:shadow-\[0_0_0_5px_rgba\(236\,72\,153\,0\.08\)\,0_28px_80px_rgba\(60\,40\,120\,0\.12\)\]:focus-within{box-shadow:0 0 0 5px rgba(236,72,153,.15),0 28px 80px rgba(0,0,0,.45)}
.theme-dark .focus\:bg-white:focus{background-color:rgba(255,255,255,.14)}
.theme-dark .from-emerald-50\/90,.theme-dark.from-emerald-50\/90{background-image:linear-gradient(135deg,rgba(16,185,129,.14),rgba(20,184,166,.07))}
.theme-dark .from-pink-200\/30,.theme-dark.from-pink-200\/30{background-image:linear-gradient(135deg,rgba(236,72,153,.15),rgba(168,85,247,.10))}
.theme-dark .from-pink-50\/95,.theme-dark.from-pink-50\/95{background-image:linear-gradient(135deg,rgba(236,72,153,.16),rgba(168,85,247,.10))}
.theme-dark .from-red-100,.theme-dark.from-red-100{background-image:linear-gradient(135deg,rgba(239,68,68,.20),rgba(168,85,247,.20))}
.theme-dark .hover\:bg-slate-800:hover{background-color:#ffffff}
.theme-dark .hover\:bg-white\/75:hover{background-color:rgba(255,255,255,0.111)}
.theme-dark .hover\:bg-white\/80:hover{background-color:rgba(255,255,255,0.119)}
.theme-dark .hover\:text-pink-500:hover{color:#f472b6}
.theme-dark .hover\:text-red-500:hover{color:#f87171}
.theme-dark .open\:bg-white\/70[open]{background-color:rgba(255,255,255,0.102)}
.theme-dark .placeholder\:text-slate-400::placeholder{color:#7d8ba0}
.theme-dark .ring-white,.theme-dark.ring-white{--tw-ring-color:rgba(255,255,255,.15)}
.theme-dark .shadow-\[0_25px_60px_rgba\(30\,30\,60\,0\.20\)\],.theme-dark.shadow-\[0_25px_60px_rgba\(30\,30\,60\,0\.20\)\]{box-shadow:0 25px 60px rgba(0,0,0,.50)}
.theme-dark .text-emerald-600,.theme-dark.text-emerald-600{color:#34d399}
.theme-dark .text-emerald-600\/75,.theme-dark.text-emerald-600\/75{color:rgba(52,211,153,.8)}
.theme-dark .text-emerald-700,.theme-dark.text-emerald-700{color:#6ee7b7}
.theme-dark .text-pink-500,.theme-dark.text-pink-500{color:#f472b6}
.theme-dark .text-pink-600,.theme-dark.text-pink-600{color:#f9a8d4}
.theme-dark .text-red-500,.theme-dark.text-red-500{color:#f87171}
.theme-dark .text-red-600,.theme-dark.text-red-600{color:#f87171}
.theme-dark .text-red-700,.theme-dark.text-red-700{color:#fca5a5}
.theme-dark .text-slate-400,.theme-dark.text-slate-400{color:#7d8ba0}
.theme-dark .text-slate-500,.theme-dark.text-slate-500{color:#9fadc0}
.theme-dark .text-slate-600,.theme-dark.text-slate-600{color:#c4cfde}
.theme-dark .text-slate-700,.theme-dark.text-slate-700{color:#dbe3ee}
.theme-dark .text-slate-800,.theme-dark.text-slate-800{color:#e8edf4}
.theme-dark .text-slate-900,.theme-dark.text-slate-900{color:#f1f5f9}
.theme-dark .via-slate-200,.theme-dark.via-slate-200{background-image:linear-gradient(to right,transparent,rgba(255,255,255,.16),transparent)}
`;

const isValidYouTubeUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return YT_HOSTS.includes(hostname);
  } catch {
    return false;
  }
};

const toSong = (data) => ({
  title: data.song_name || "",
  artist: data.artist || data.singer || "",
  thumbnail: data.cover || "",
  album: data.album || "",
  year: data.releaseYear || "",
  composer: data.composer || "",
  genre: data.genre || "",
  appleCover: data.appleCover || "",
  videoId: data.videoId || "",
  duration: Number(data.duration) || 0,
});

const fmtDuration = (seconds) =>
  seconds
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "";

async function postJson(path, body, signal) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* ICONS                                                                       */
/* -------------------------------------------------------------------------- */

const Icon = ({ children, size = 20, className = "", strokeWidth = 1.8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const LinkIcon = ({ size = 20 }) => (
  <Icon size={size}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

const PasteIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <rect x="8" y="4" width="12" height="16" rx="2" />
    <path d="M16 4V3a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
  </Icon>
);

const ArrowRightIcon = ({ size = 18, className = "" }) => (
  <Icon size={size} className={className}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Icon>
);

const DownloadIcon = ({ size = 20 }) => (
  <Icon size={size}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
);

const CheckIcon = ({ size = 18 }) => (
  <Icon size={size} strokeWidth={2.4}>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);

const MusicIcon = ({ size = 22 }) => (
  <Icon size={size}>
    <path d="M9 18V5l10-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="16" cy="16" r="3" />
  </Icon>
);

const SparkleIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <path d="m12 3-1.2 4.2L7 8.5l3.8 1.3L12 14l1.2-4.2L17 8.5l-3.8-1.3L12 3Z" />
    <path d="m19 14-.6 2.1-2 .7 2 .7.6 2.1.6-2.1 2-.7-2-.7L19 14Z" />
  </Icon>
);

const SunIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

const MoonIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/* LOGO                                                                         */
/* -------------------------------------------------------------------------- */

const Logo = ({ size = 42 }) => (
  <div
    className="relative shrink-0 overflow-hidden rounded-[15px] shadow-[0_10px_30px_rgba(236,72,153,0.22)]"
    style={{ width: size, height: size }}
  >
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="relative z-10">
      <defs>
        <linearGradient id="logo-main" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset=".48" stopColor="#ec4899" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
        <linearGradient id="logo-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".62" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#logo-main)" />
      <rect x="2" y="2" width="60" height="30" rx="17" fill="url(#logo-light)" />
      <rect x="3" y="3" width="58" height="58" rx="16" fill="none" stroke="white" strokeOpacity=".5" />
      <path
        d="M27 17v27.5c0 3.8-3.4 6.5-7 6.5-3.3 0-5.5-1.7-5.5-4.3 0-3.1 2.9-5.4 6.8-5.4 1.2 0 2.2.2 3.2.6V20.2l20-4.2v20.5c0 3.8-3.4 6.5-7 6.5-3.3 0-5.5-1.7-5.5-4.3 0-3.1 2.9-5.4 6.8-5.4 1.2 0 2.2.2 3.2.6V22l-15 3.2V17h-5Z"
        fill="white"
      />
    </svg>
  </div>
);

/* -------------------------------------------------------------------------- */
/* SMALL COMPONENTS                                                            */
/* -------------------------------------------------------------------------- */

const Spinner = ({ className = "h-4 w-4" }) => (
  <span className={`inline-block animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`} />
);

function FeaturePill({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/65 px-3.5 py-2 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur-xl">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <CheckIcon size={10} />
      </span>
      {children}
    </span>
  );
}

function SongSkeleton() {
  return (
    <div className={`${glass} mx-auto mt-8 max-w-3xl overflow-hidden rounded-[32px] p-5`} aria-hidden="true">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto h-56 w-56 shrink-0 animate-pulse rounded-[26px] bg-slate-200/70 sm:mx-0" />
        <div className="flex flex-1 flex-col justify-center space-y-4">
          <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-8 w-4/5 animate-pulse rounded-xl bg-slate-200/70" />
          <div className="h-4 w-2/5 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-3 w-1/3 animate-pulse rounded-full bg-slate-200/70" />
        </div>
      </div>
    </div>
  );
}

function QualityCard({ quality, active, busy, onChange }) {
  const { t } = useT();
  return (
    <label
      className={`group relative cursor-pointer overflow-hidden rounded-[22px] border p-4 transition-all duration-300 ${
        active
          ? "border-pink-300 bg-gradient-to-br from-pink-50/95 via-white/80 to-purple-50/80 shadow-[0_14px_40px_rgba(236,72,153,0.14)]"
          : "border-white/80 bg-white/45 hover:-translate-y-0.5 hover:bg-white/75 hover:shadow-lg"
      } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="quality"
        value={quality.value}
        checked={active}
        onChange={() => onChange(quality.value)}
        className="sr-only"
        disabled={busy}
      />

      {active && (
        <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-[40px] bg-gradient-to-br from-pink-200/30 to-purple-200/20" />
      )}

      <div className="relative flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-base font-black ${active ? "text-pink-600" : "text-slate-800"}`}>
              {quality.title}
            </span>
            {active && (
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-pink-600">
                {t("selected")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-medium text-slate-400">{t(quality.noteKey)}</p>
        </div>

        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
            active
              ? "border-pink-400 bg-pink-500 text-white shadow-md shadow-pink-500/25"
              : "border-slate-300 bg-white/70 text-transparent"
          }`}
        >
          <CheckIcon size={13} />
        </span>
      </div>

      <div className="relative mt-4 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{t("mp3Audio")}</span>
        <span
          className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
            active ? "bg-white/80 text-pink-500" : "bg-slate-100 text-slate-400"
          }`}
        >
          {t(quality.badgeKey)}
        </span>
      </div>
    </label>
  );
}

function Stepper({ currentStep }) {
  const { t } = useT();
  return (
    <ol className="flex items-center">
      {STEPS.map((label, index) => {
        const complete = index < currentStep;
        const active = index === currentStep;

        return (
          <li key={label} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black transition-all ${
                  complete
                    ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                    : active
                      ? `${gradient} text-white shadow-md shadow-pink-500/20`
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {complete ? <CheckIcon size={13} /> : index + 1}
              </span>
              <span
                className={`hidden text-[11px] font-bold sm:block ${
                  active ? "text-slate-800" : complete ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                {t(label)}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div className={`mx-2 h-px flex-1 transition-colors ${index < currentStep ? "bg-emerald-300" : "bg-slate-200"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Visualizer({ active = false }) {
  return (
    <div className="flex h-6 items-center gap-[3px]">
      {[0.45, 0.8, 1, 0.65, 0.9, 0.55, 0.75].map((height, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full transition-all ${active ? gradient : "bg-slate-300"}`}
          style={{
            height: `${Math.max(6, height * 22)}px`,
            animation: active ? `musicBar ${0.7 + index * 0.08}s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* APP                                                                          */
/* -------------------------------------------------------------------------- */

function CoverTile({ active, disabled, label, sub, img, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-[18px] border p-2 text-left transition ${
        active
          ? "border-pink-300 bg-pink-50/80 shadow-md shadow-pink-500/10"
          : "border-white/80 bg-white/50 hover:bg-white/80"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span className="block aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-red-100 via-pink-100 to-purple-100">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-pink-400">{children}</span>
        )}
      </span>
      <span className={`mt-2 block text-[11px] font-black ${active ? "text-pink-600" : "text-slate-700"}`}>{label}</span>
      <span className="block text-[10px] font-medium text-slate-400">{sub}</span>
    </button>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState(() => localStorage.getItem("quality") || "128");

  const [song, setSong] = useState(EMPTY_SONG);
  const [error, setError] = useState("");
  const [loadingSong, setLoadingSong] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [phase, setPhase] = useState("idle"); // idle | preparing | converting
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState(null); // { url, name } once the MP3 is ready
  const [downloadId, setDownloadId] = useState(null);
  const [done, setDone] = useState(false);
  const [edits, setEdits] = useState({}); // tags the user changed
  const [editing, setEditing] = useState(false);
  const [cover, setCover] = useState(INITIAL_COVER);
  const [audio, setAudio] = useState(INITIAL_AUDIO);
  const fileRef = useRef(null);

  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem("lang");
    if (saved && STRINGS[saved]) return saved;
    const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return STRINGS[nav] ? nav : "en";
  });
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const t = (key) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  // server messages arrive in English: show the translation when we know the message
  const localize = (msg) => {
    if (!msg) return "";
    const hit = SERVER_MESSAGES.find(([re]) => re.test(msg));
    return hit ? t(hit[1]) : msg;
  };

  useEffect(() => {
    localStorage.setItem("lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.style.backgroundColor = theme === "dark" ? "#0b0b14" : "#f7f7fb";
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const songRun = useRef(0);
  const abortRef = useRef(null);

  const busy = phase !== "idle";

  useEffect(() => {
    localStorage.setItem("quality", quality);
  }, [quality]);

  // a new / cleared song starts without edits
  useEffect(() => {
    if (!song.title) {
      setEdits({});
      setEditing(false);
      setCover(INITIAL_COVER);
      setAudio(INITIAL_AUDIO);
    }
  }, [song.title]);

  /* ------------------------------------------------------------------------ */
  /* DOWNLOAD PROGRESS (polling is more reliable than SSE on iPhone / in-app   */
  /* browsers such as the Documents app)                                       */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!downloadId) return;

    let stopped = false;
    let timer;
    const startedAt = Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/api/status/${downloadId}`, { cache: "no-store" });
        const data = await res.json();
        if (stopped) return;

        if (data.error) {
          setError(localize(data.message) || t("errConvert"));
          setPhase("idle");
          setDownloadId(null);
          return;
        }

        setProgress(data.progress || 0);
        if (data.progress > 0) {
          setPhase((cur) => (cur === "preparing" ? "converting" : cur));
        }

        if (data.ready) {
          const fileUrl = `${API_URL}/api/file/${downloadId}`;
          setFile({ url: fileUrl, name: data.name });
          setPhase("idle");
          setDone(true);
          setDownloadId(null);
          saveFile(fileUrl); // the "Save MP3" button is the fallback if the browser blocks this
          return;
        }
      } catch {
        // network hiccup: keep trying
      }

      if (Date.now() - startedAt > 10 * 60 * 1000) {
        setError(t("errSlow"));
        setPhase("idle");
        setDownloadId(null);
        return;
      }
      timer = setTimeout(tick, 1000);
    };

    tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [downloadId]);

  // Starts the browser's normal download from a real URL (works in Safari and in-app browsers)
  const saveFile = (fileUrl) => {
    const a = Object.assign(document.createElement("a"), { href: fileUrl, rel: "noopener" });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /* ------------------------------------------------------------------------ */
  /* SONG LOOKUP                                                              */
  /* ------------------------------------------------------------------------ */

  const loadDetails = async (videoUrl, run) => {
    setLoadingDetails(true);

    const deadline = Date.now() + 90000;

    while (Date.now() < deadline && run === songRun.current) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      if (run !== songRun.current) return;

      try {
        const data = await postJson("/api/song-details", { url: videoUrl });

        if (data.ready) {
          setSong(toSong(data));
          break;
        }

        if (data.failed) break;
      } catch {
        // Keep polling.
      }
    }

    if (run === songRun.current) {
      setLoadingDetails(false);
    }
  };

  const findSong = async (raw = url) => {
    const clean = raw.trim();

    setError("");

    if (!clean) {
      setError(t("errPaste"));
      return;
    }

    if (!isValidYouTubeUrl(clean)) {
      setError(t("errNotYoutube"));
      return;
    }

    const run = ++songRun.current;

    setLoadingSong(true);
    setLoadingDetails(false);
    setDone(false);
    setFile(null);
    setProgress(0);
    setSong(EMPTY_SONG);

    try {
      const data = await postJson("/api/song", { url: clean });

      if (run !== songRun.current) return;

      setSong(toSong(data));

      if (!data.detailsReady) {
        loadDetails(clean, run);
      }
    } catch (err) {
      if (run === songRun.current) {
        setError(localize(err.message) || t("errLoadVideo"));
      }
    } finally {
      if (run === songRun.current) {
        setLoadingSong(false);
      }
    }
  };

  const handleChange = (event) => {
    songRun.current++;

    setUrl(event.target.value);
    setError("");
    setLoadingSong(false);
    setLoadingDetails(false);
    setDone(false);
    setFile(null);

    if (song.title) {
      setSong(EMPTY_SONG);
    }
  };

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData("text") || "";

    if (isValidYouTubeUrl(text.trim())) {
      event.preventDefault();

      const clean = text.trim();

      setUrl(clean);
      findSong(clean);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();

      if (!text) {
        setError(t("errClipboardEmpty"));
        return;
      }

      setUrl(text);
      findSong(text);
    } catch {
      setError(t("errClipboard"));
    }
  };

  /* ------------------------------------------------------------------------ */
  /* DOWNLOAD                                                                  */
  /* ------------------------------------------------------------------------ */

  const uploadCover = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setCover((c) => ({ ...c, error: t("errImageType") }));
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setCover((c) => ({ ...c, error: t("errImageSize") }));
      return;
    }

    setCover((c) => ({ ...c, uploading: true, error: "" }));
    try {
      const res = await fetch(`${API_URL}/api/cover`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed. Please try again.");

      setCover((c) => {
        if (c.preview) URL.revokeObjectURL(c.preview);
        return { source: "custom", coverId: data.coverId, preview: URL.createObjectURL(file), uploading: false, error: "" };
      });
    } catch (err) {
      setCover((c) => ({ ...c, uploading: false, error: localize(err.message) || t("errUpload") }));
    }
  };

  const startDownload = async () => {
    const trimStart = parseTime(audio.start);
    const trimEnd = parseTime(audio.end);
    if (Number.isNaN(trimStart) || Number.isNaN(trimEnd)) {
      setError(t("errTimes"));
      return;
    }
    if (trimEnd > 0 && trimEnd <= trimStart + 1) {
      setError(t("errEndAfterStart"));
      return;
    }
    if (song.duration > 0 && trimStart >= song.duration - 1) {
      setError(t("errStartPastEnd"));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setError("");
    setDone(false);
    setFile(null);
    setProgress(0);
    setPhase("preparing");

    const tags = {};
    for (const [key, value] of Object.entries(edits)) {
      const text = String(value || "").trim();
      if (text && text !== song[key]) tags[key] = text;
    }

    try {
      const { downloadId: id } = await postJson(
        "/api/download",
        {
          url: url.trim(),
          quality,
          delivery: "link",
          tags,
          cover: { source: cover.source, coverId: cover.coverId },
          audio: { normalize: audio.normalize, trimStart, trimEnd },
        },
        controller.signal,
      );
      setDownloadId(id); // the polling effect takes over from here
    } catch (err) {
      setError(
        err.name === "AbortError"
          ? t("cancelled")
          : localize(err.message) || t("errStart"),
      );
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
  };

  const cancelDownload = () => {
    abortRef.current?.abort();

    if (downloadId) {
      fetch(`${API_URL}/api/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: downloadId }),
      }).catch(() => {});
    }

    setDownloadId(null);
    setPhase("idle");
    setProgress(0);
    setError(t("cancelled"));
  };

  const reset = () => {
    cancelDownload();
    songRun.current++;

    setUrl("");
    setSong(EMPTY_SONG);
    setError("");
    setProgress(0);
    setDone(false);
    setFile(null);
    setLoadingSong(false);
    setLoadingDetails(false);
  };

  /* ------------------------------------------------------------------------ */
  /* DISPLAY VALUES                                                            */
  /* ------------------------------------------------------------------------ */

  const view = { ...song };
  const audioSummary =
    [audio.normalize && t("sumEven"), (audio.start || audio.end) && t("sumTrimmed")].filter(Boolean).join(" · ") || t("sumOriginal");
  for (const [key, value] of Object.entries(edits)) {
    if (String(value || "").trim()) view[key] = String(value).trim();
  }

  const step = STEP_OF[phase] ?? 0;

  const safeBarPct = Math.min(Math.max(progress || 0, 0), 100);

  const statusText = {
    preparing: t("statusPreparing"),
    converting: t("statusConverting"),
  }[phase];

  return (
    <I18nContext.Provider value={{ t, lang }}>
    <div
      className={`relative min-h-screen overflow-x-hidden bg-[#f7f7fb] text-slate-900 antialiased ${
        theme === "dark" ? "theme-dark" : ""
      } ${lang !== "en" ? "lang-indic" : ""}`}
    >
      <style>{EXTRA_CSS}</style>
      <style>{`
        @keyframes drift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(35px, 25px, 0) scale(1.1); }
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
        @keyframes musicBar {
          from { transform: scaleY(.45); }
          to { transform: scaleY(1); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(236,72,153,.08); }
          50% { box-shadow: 0 0 0 8px rgba(236,72,153,.03); }
        }
        .rise { animation: rise .55s cubic-bezier(.2,.8,.2,1) both; }
        .shimmer { background-size: 200% 100%; animation: shimmer 2.2s linear infinite; }
        .pulse-glow { animation: pulseGlow 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .rise, .shimmer, .pulse-glow, .drift { animation: none !important; }
        }
      `}</style>

      {/* BACKGROUND */}

      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -left-44 -top-48 h-[600px] w-[600px] rounded-full bg-red-300/30 blur-[145px]"
          style={{ animation: "drift 18s ease-in-out infinite" }}
        />
        <div
          className="absolute -right-48 top-10 h-[620px] w-[620px] rounded-full bg-purple-300/30 blur-[155px]"
          style={{ animation: "drift 22s ease-in-out infinite reverse" }}
        />
        <div
          className="absolute -bottom-60 left-[30%] h-[520px] w-[520px] rounded-full bg-pink-300/25 blur-[155px]"
          style={{ animation: "drift 25s ease-in-out infinite" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_35%,#f7f7fb_100%)]" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(#64748b_1px,transparent_1px),linear-gradient(90deg,#64748b_1px,transparent_1px)] [background-size:56px_56px]" />
      </div>

      {/* HEADER */}

      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/55 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-[15px] font-black tracking-tight sm:text-lg">
                YouTube
                <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">Audio</span>
              </div>
              <div className="hidden text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 sm:block">
                {t("brandTagline")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-white bg-white/60 px-3.5 py-2 text-[10px] font-bold text-slate-500 shadow-sm sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t("statusPill")}
            </div>

            <label htmlFor="lang" className="sr-only">
              {t("language")}
            </label>
            <select
              id="lang"
              value={lang}
              onChange={(event) => setLang(event.target.value)}
              className="h-9 cursor-pointer rounded-full border border-white bg-white/70 px-3 text-xs font-bold text-slate-600 shadow-sm outline-none transition hover:text-pink-500 focus:border-pink-200"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setTheme((cur) => (cur === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? t("lightMode") : t("darkMode")}
              title={theme === "dark" ? t("lightMode") : t("darkMode")}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white bg-white/70 text-slate-600 shadow-sm transition hover:text-pink-500"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}

      <main className="mx-auto max-w-5xl px-5 pb-24">
        {/* HERO */}

        <section className="rise pt-14 text-center sm:pt-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/65 px-4 py-2 text-[11px] font-bold text-slate-500 shadow-sm backdrop-blur-xl">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-purple-500 text-white">
              <SparkleIcon size={11} />
            </span>
            {t("badge")}
          </div>

          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            {t("heroLine1")}
            <br />
            <span className={`bg-clip-text text-transparent ${gradient}`}>{t("heroLine2")}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
            {t("heroSub")}
          </p>
        </section>

        {/* URL INPUT */}

        <section className="rise mx-auto mt-10 max-w-3xl [animation-delay:80ms]">
          <div
            className={`${glass} rounded-[30px] p-2.5 transition-all duration-300 focus-within:border-pink-300 focus-within:shadow-[0_0_0_5px_rgba(236,72,153,0.08),0_28px_80px_rgba(60,40,120,0.12)]`}
          >
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1">
                <label htmlFor="yt-url" className="sr-only">
                  {t("linkLabel")}
                </label>

                <div className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-slate-400">
                  <LinkIcon size={19} />
                </div>

                <input
                  id="yt-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onKeyDown={(event) => event.key === "Enter" && findSong()}
                  placeholder={t("placeholder")}
                  className="h-[62px] w-full rounded-[22px] border border-white bg-white/80 pl-12 pr-24 text-sm font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-pink-200 focus:bg-white"
                />

                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  disabled={busy}
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-sm transition hover:border-pink-200 hover:text-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PasteIcon size={13} />
                  {t("paste")}
                </button>
              </div>

              <button
                onClick={() => findSong()}
                disabled={loadingSong || busy}
                className={`group flex h-[62px] items-center justify-center gap-2 rounded-[22px] ${gradient} px-7 font-black text-white shadow-[0_12px_30px_rgba(236,72,153,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_16px_36px_rgba(236,72,153,0.30)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loadingSong ? (
                  <>
                    <Spinner />
                    {t("finding")}
                  </>
                ) : (
                  <>
                    {t("findSong")}
                    <ArrowRightIcon size={17} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {!song.title && !loadingSong && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <FeaturePill>{t("pillCover")}</FeaturePill>
              <FeaturePill>{t("pillTags")}</FeaturePill>
              <FeaturePill>{t("pillQuality")}</FeaturePill>
              <FeaturePill>{t("pillShorts")}</FeaturePill>
            </div>
          )}

          {/* ERROR */}

          <div aria-live="polite">
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-3 rounded-[20px] border border-red-100 bg-red-50/80 px-4 py-3.5 text-sm font-medium text-red-600 shadow-sm"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 font-black text-red-500">
                  !
                </span>

                <span className="flex-1 leading-6">{error}</span>

                {song.title && !busy && (
                  <button onClick={startDownload} className="shrink-0 font-black text-red-700 underline underline-offset-2">
                    {t("tryAgain")}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {loadingSong && !song.title && <SongSkeleton />}

        {/* SONG CARD */}

        {song.title && (
          <section className={`${glass} rise relative mx-auto mt-8 max-w-3xl overflow-hidden rounded-[34px] p-4 sm:p-6`}>
            {/* blurred artwork background */}

            {song.thumbnail && (
              <>
                <img
                  src={song.thumbnail}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-[0.13] blur-3xl"
                />
                <div className="pointer-events-none absolute inset-0 bg-white/60" />
              </>
            )}

            <div className="relative">
              {/* MEDIA INFO */}

              <div className="flex flex-col gap-6 sm:flex-row">
                {/* ARTWORK */}

                <div className="group relative mx-auto h-56 w-56 shrink-0 sm:mx-0">
                  <div className="absolute -inset-2 rounded-[30px] bg-gradient-to-br from-red-300/20 via-pink-300/20 to-purple-300/20 blur-xl transition-opacity group-hover:opacity-100" />

                  <div className="relative h-full w-full overflow-hidden rounded-[27px] bg-gradient-to-br from-red-100 via-pink-100 to-purple-100 shadow-[0_25px_60px_rgba(30,30,60,0.20)] ring-1 ring-white">
                    {song.thumbnail ? (
                      <img
                        src={song.thumbnail}
                        alt={`${t("coverArt")}: ${song.title}`}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-pink-400">
                        <MusicIcon size={58} />
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/30 to-transparent" />

                    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/50 bg-black/25 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white backdrop-blur-xl">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      YouTube
                    </div>
                  </div>
                </div>

                {/* INFO */}

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-pink-500">
                      <SparkleIcon size={10} />
                      {t("ready")}
                    </span>

                    <Visualizer active={!busy} />
                  </div>

                  <h2 className="line-clamp-3 text-[25px] font-black leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-3xl">
                    {view.title}
                  </h2>

                  <p className="mt-2 text-base font-bold text-slate-600">{view.artist || t("unknownArtist")}</p>

                  {loadingDetails ? (
                    <p className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-400">
                      <Spinner className="h-3 w-3" />
                      {t("lookingUp")}
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {view.album && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {view.album}
                        </span>
                      )}
                      {view.year && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {view.year}
                        </span>
                      )}
                      {song.duration > 0 && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {fmtDuration(song.duration)}
                        </span>
                      )}
                    </div>
                  )}

                  {view.composer && (
                    <p className="mt-3 text-xs font-medium text-slate-400">
                      {t("musicBy")} <span className="font-bold text-slate-500">{view.composer}</span>
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    disabled={busy}
                    className="mt-4 self-start rounded-full border border-white bg-white/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-sm transition hover:border-pink-200 hover:text-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editing ? t("doneEditing") : t("editTags")}
                  </button>
                </div>
              </div>

              {/* DIVIDER */}

              <div className="my-6 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

              {/* TAG EDITOR */}

              {editing && (
                <div className="mb-6 rounded-[22px] border border-white/80 bg-white/55 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-800">{t("editTags")}</p>
                    {Object.keys(edits).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEdits({})}
                        disabled={busy}
                        className="text-[11px] font-black text-pink-500 underline underline-offset-2"
                      >
                        {t("resetDetected")}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {TAG_FIELDS.map((field) => (
                      <label key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          {t(field.labelKey)}
                        </span>
                        <input
                          value={edits[field.key] ?? song[field.key] ?? ""}
                          onChange={(event) => setEdits((cur) => ({ ...cur, [field.key]: event.target.value }))}
                          disabled={busy}
                          maxLength={field.key === "year" ? 4 : 150}
                          inputMode={field.key === "year" ? "numeric" : "text"}
                          className="h-11 w-full rounded-2xl border border-white bg-white/80 px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-pink-200 focus:bg-white disabled:opacity-60"
                        />
                      </label>
                    ))}
                  </div>

                  <p className="mt-3 text-[11px] font-medium text-slate-400">
                    {t("editHint")}
                  </p>
                </div>
              )}

              {/* COVER ART + AUDIO OPTIONS */}

              <div className="mb-5 grid gap-3">
                <details className="rounded-[20px] border border-white/80 bg-white/50 px-4 py-3 open:bg-white/70">
                  <summary className="cursor-pointer select-none text-sm font-black text-slate-800">
                    {t("coverArt")}
                    <span className="ml-2 text-[11px] font-medium text-slate-400">{t(COVER_LABEL[cover.source])}</span>
                  </summary>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <CoverTile
                      active={cover.source === "auto"}
                      disabled={busy}
                      label={t("coverAuto")}
                      sub={t("subBest")}
                      img={song.thumbnail}
                      onClick={() => setCover((c) => ({ ...c, source: "auto" }))}
                    />

                    <CoverTile
                      active={cover.source === "apple"}
                      disabled={busy || !song.appleCover}
                      label="Apple Music"
                      sub={song.appleCover ? t("subOfficial") : t("subNoMatch")}
                      img={song.appleCover}
                      onClick={() => setCover((c) => ({ ...c, source: "apple" }))}
                    >
                      <MusicIcon size={26} />
                    </CoverTile>

                    <CoverTile
                      active={cover.source === "youtube"}
                      disabled={busy || !song.videoId}
                      label="YouTube"
                      sub={t("subThumb")}
                      img={song.videoId ? `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg` : ""}
                      onClick={() => setCover((c) => ({ ...c, source: "youtube" }))}
                    >
                      <MusicIcon size={26} />
                    </CoverTile>

                    <CoverTile
                      active={cover.source === "custom"}
                      disabled={busy || cover.uploading}
                      label={cover.coverId ? t("coverCustom") : t("upload")}
                      sub={cover.uploading ? t("uploading") : cover.coverId ? t("selected") : t("subTypes")}
                      img={cover.preview}
                      onClick={() =>
                        cover.coverId ? setCover((c) => ({ ...c, source: "custom" })) : fileRef.current?.click()
                      }
                    >
                      <span className="text-3xl font-light">+</span>
                    </CoverTile>
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      uploadCover(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />

                  {cover.coverId && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy || cover.uploading}
                      className="mt-3 text-[11px] font-black text-pink-500 underline underline-offset-2"
                    >
                      {t("replaceImage")}
                    </button>
                  )}

                  {cover.error && (
                    <p role="alert" className="mt-3 text-[11px] font-semibold text-red-500">
                      {cover.error}
                    </p>
                  )}
                </details>

                <details className="rounded-[20px] border border-white/80 bg-white/50 px-4 py-3 open:bg-white/70">
                  <summary className="cursor-pointer select-none text-sm font-black text-slate-800">
                    {t("audioOptions")}
                    <span className="ml-2 text-[11px] font-medium text-slate-400">{audioSummary}</span>
                  </summary>

                  <div className="mt-3 space-y-3">
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white bg-white/70 px-3.5 py-3">
                      <span>
                        <span className="block text-sm font-bold text-slate-700">{t("evenVolume")}</span>
                        <span className="block text-[11px] font-medium text-slate-400">
                          {t("evenVolumeHint")}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={audio.normalize}
                        onChange={(event) => setAudio((a) => ({ ...a, normalize: event.target.checked }))}
                        disabled={busy}
                        className="h-5 w-5 shrink-0 accent-pink-500"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          {t("startAt")}
                        </span>
                        <input
                          value={audio.start}
                          onChange={(event) => setAudio((a) => ({ ...a, start: event.target.value }))}
                          disabled={busy}
                          placeholder="0:00"
                          inputMode="numeric"
                          className="h-11 w-full rounded-2xl border border-white bg-white/80 px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-pink-200 focus:bg-white disabled:opacity-60"
                        />
                      </label>

                      <label>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          {t("endAt")}
                        </span>
                        <input
                          value={audio.end}
                          onChange={(event) => setAudio((a) => ({ ...a, end: event.target.value }))}
                          disabled={busy}
                          placeholder={song.duration ? fmtDuration(song.duration) : "end"}
                          inputMode="numeric"
                          className="h-11 w-full rounded-2xl border border-white bg-white/80 px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-pink-200 focus:bg-white disabled:opacity-60"
                        />
                      </label>
                    </div>

                    <p className="text-[11px] font-medium text-slate-400">
                      {t("trimHint")}
                    </p>
                  </div>
                </details>
              </div>

              {/* QUALITY */}

              <fieldset disabled={busy}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <legend className="text-sm font-black text-slate-800">{t("audioQuality")}</legend>
                    <p className="mt-1 text-[11px] font-medium text-slate-400">
                      {t("qualityHint")}
                    </p>
                  </div>

                  <span className="hidden rounded-full border border-white bg-white/60 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400 sm:block">
                    MP3
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {QUALITIES.map((item) => (
                    <QualityCard
                      key={item.value}
                      quality={item}
                      active={quality === item.value}
                      busy={busy}
                      onChange={setQuality}
                    />
                  ))}
                </div>
              </fieldset>

              {/* PROGRESS */}

              {busy && (
                <div className={`${glass} pulse-glow relative mt-5 rounded-[25px] bg-white/55 p-5`} aria-live="polite">
                  <Stepper currentStep={step} />

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-100 text-pink-500">
                          <Spinner className="h-3.5 w-3.5" />
                        </span>

                        <span className="text-xs font-black text-slate-700">
                          {phase === "preparing" ? t("preparing") : t("converting")}
                        </span>
                      </div>

                      {phase !== "preparing" && (
                        <span className="text-sm font-black text-pink-500">{Math.round(safeBarPct)}%</span>
                      )}
                    </div>

                    <div
                      className="h-2.5 overflow-hidden rounded-full bg-slate-200/70"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(safeBarPct)}
                    >
                      {phase === "preparing" ? (
                        <div
                          className={`h-full w-1/3 rounded-full ${gradient}`}
                          style={{ animation: "shimmer 1.5s linear infinite", backgroundSize: "200% 100%" }}
                        />
                      ) : (
                        <div
                          className="shimmer h-full rounded-full bg-gradient-to-r from-red-500 via-pink-400 to-purple-500 transition-all duration-500"
                          style={{ width: `${safeBarPct}%` }}
                        />
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="min-w-0 text-[11px] font-medium leading-5 text-slate-400">{statusText}</p>

                      <button
                        onClick={cancelDownload}
                        className="shrink-0 rounded-full border border-white bg-white/70 px-3 py-1.5 text-[10px] font-black text-slate-500 transition hover:border-red-200 hover:text-red-500"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* DOWNLOAD BUTTON */}

              {!busy && !done && (
                <button
                  onClick={startDownload}
                  className={`group relative mt-5 flex h-[62px] w-full items-center justify-center gap-3 overflow-hidden rounded-[22px] ${gradient} font-black text-white shadow-[0_18px_40px_rgba(236,72,153,0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_22px_48px_rgba(236,72,153,0.30)] active:translate-y-0`}
                >
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                  <span className="relative flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                      <DownloadIcon size={19} />
                    </span>
                    {t("downloadMp3")}
                    <ArrowRightIcon size={17} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              )}

              {/* DONE */}

              {done && !busy && file && (
                <div className="relative mt-5">
                  <div className="overflow-hidden rounded-[24px] border border-emerald-100 bg-gradient-to-br from-emerald-50/90 via-white/70 to-teal-50/70 p-5 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
                      <CheckIcon size={24} />
                    </div>

                    <p className="mt-3 text-base font-black text-emerald-700">{t("mp3Ready")}</p>

                    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-emerald-600/75">
                      {t("readyHelp")}
                    </p>
                  </div>

                  <a
                    href={file.url}
                    className={`mt-3 flex h-[58px] w-full items-center justify-center gap-2 rounded-[20px] ${gradient} font-black text-white shadow-[0_18px_40px_rgba(236,72,153,0.25)] transition hover:brightness-110`}
                  >
                    <DownloadIcon size={19} />
                    {t("saveMp3")}
                  </a>

                  <button
                    onClick={reset}
                    className="mt-3 w-full rounded-[17px] bg-slate-900 py-3.5 text-sm font-black text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-slate-800"
                  >
                    {t("convertAnother")}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* FOOTER */}

        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center justify-center gap-3 text-center sm:flex-row">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
            <span className="h-px w-8 bg-slate-200" />
            <span className="font-medium tracking-wide">{t("footer")}</span>
            <span className="h-px w-8 bg-slate-200" />
          </div>
        </div>
      </main>
    </div>
    </I18nContext.Provider>
  );
}