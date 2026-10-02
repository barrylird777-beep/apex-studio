export const SACRED_TEXT_FAMILIES = Object.freeze([
  {id:"tanakh",tradition:"Judaism",name:"Tanakh / Hebrew Bible",category:"biblical",includes:["Torah","Nevi'im","Ketuvim"]},
  {id:"torah",tradition:"Judaism",name:"Torah",category:"biblical",includes:["Pentateuch"]},
  {id:"christian-bible",tradition:"Christianity",name:"Christian Bible",category:"biblical",includes:["Old Testament","New Testament","tradition-dependent canon"]},
  {id:"deuterocanon",tradition:"Christianity",name:"Deuterocanonical Books",category:"biblical",includes:["Catholic and Orthodox traditions"]},
  {id:"peshitta",tradition:"Syriac Christianity",name:"Peshitta",category:"biblical",includes:["Syriac biblical tradition"]},
  {id:"ethiopian-canon",tradition:"Ethiopian Christianity",name:"Ethiopian Biblical Canon",category:"biblical",includes:["broader biblical tradition"]},
  {id:"samaritan-pentateuch",tradition:"Samaritanism",name:"Samaritan Pentateuch",category:"biblical",includes:["Torah tradition"]},
  {id:"quran",tradition:"Islam",name:"Qur'an",category:"sacred-text",includes:["Arabic Qur'anic text","translations"]},
  {id:"hadith",tradition:"Islam",name:"Hadith Collections",category:"sacred-text",includes:["major canonical collections by tradition"]},
  {id:"bahai",tradition:"Bahá'í Faith",name:"Bahá'í Sacred Writings",category:"sacred-text",includes:["Kitáb-i-Aqdas","Kitáb-i-Íqán","selected writings"]},
  {id:"zoroastrian",tradition:"Zoroastrianism",name:"Avesta",category:"sacred-text",includes:["Gathas","Yasna","Vendidad and related texts"]},
  {id:"other-ancient-near-eastern",tradition:"Ancient Near Eastern religions",name:"Ancient Religious Texts",category:"historical-text",includes:["comparative ancient sources"]},
  {id:"early-jewish-christian",tradition:"Early Jewish and Christian traditions",name:"Second Temple and Early Christian Texts",category:"historical-text",includes:["Dead Sea Scrolls","early Christian writings","other ancient witnesses"]}
]);
export const SACRED_LIBRARY_RULES = Object.freeze({
  principle:"Apex is a reading and study library that preserves the distinction between canonical scripture, translation, commentary, and historical source.",
  copyright:"Public-domain and openly licensed texts may be bundled. Copyrighted editions require licensed source access and are never copied into the repository without permission.",
  provenance:"Every imported text retains tradition, language, edition, source, license, and publication metadata.",
  comparison:"Readers may place editions and traditions side-by-side without Apex declaring one tradition authoritative over another."
});
export function sacredTextCatalog(){return {families:SACRED_TEXT_FAMILIES.map(x=>({...x,includes:[...x.includes]})),rules:{...SACRED_LIBRARY_RULES}};}
