export const BIBLE_FAMILIES = Object.freeze([
  {id:"hebrew-bible", name:"Hebrew Bible / Tanakh", tradition:"Jewish", textFamilies:["Masoretic Text","Leningrad Codex","Aleppo Codex"], canon:"Tanakh"},
  {id:"septuagint", name:"Septuagint (LXX)", tradition:"Greek/Jewish-Christian", textFamilies:["Greek Septuagint","Rahlfs","Rahlfs-Hanhart"], canon:"expanded"},
  {id:"samaritan-pentateuch", name:"Samaritan Pentateuch", tradition:"Samaritan", textFamilies:["Samaritan Pentateuch"], canon:"Torah"},
  {id:"peshitta", name:"Peshitta", tradition:"Syriac Christian", textFamilies:["Syriac Peshitta"], canon:"tradition-dependent"},
  {id:"vulgate", name:"Latin Vulgate", tradition:"Latin Christian", textFamilies:["Vulgate","Clementine Vulgate","Nova Vulgata"], canon:"Catholic"},
  {id:"ethiopian", name:"Ethiopian Biblical tradition", tradition:"Ethiopian Orthodox", textFamilies:["Ge'ez biblical tradition"], canon:"expanded"},
  {id:"armenian", name:"Armenian Biblical tradition", tradition:"Armenian Apostolic", textFamilies:["Classical Armenian"], canon:"tradition-dependent"},
  {id:"coptic", name:"Coptic Biblical tradition", tradition:"Coptic Christian", textFamilies:["Coptic Sahidic","Coptic Bohairic"], canon:"tradition-dependent"},
  {id:"eastern-orthodox", name:"Eastern Orthodox Bible traditions", tradition:"Eastern Orthodox", textFamilies:["Greek Orthodox","Slavonic traditions"], canon:"expanded"},
  {id:"roman-catholic", name:"Roman Catholic Bible traditions", tradition:"Catholic", textFamilies:["Latin and vernacular Catholic traditions"], canon:"deuterocanonical"},
  {id:"protestant", name:"Protestant Bible traditions", tradition:"Protestant", textFamilies:["66-book tradition"], canon:"66"},
  {id:"jewish-english", name:"Jewish English translations", tradition:"Jewish", textFamilies:["JPS 1917","JPS/NJPS","Orthodox Jewish translations"], canon:"Tanakh"},
  {id:"messianic", name:"Messianic Jewish translations", tradition:"Messianic Jewish", textFamilies:["Messianic English editions"], canon:"tradition-dependent"}
]);

export const BIBLE_EDITIONS = Object.freeze([
  ["KJV","King James Version",1611,"public-domain"],
  ["ASV","American Standard Version",1901,"public-domain"],
  ["WEB","World English Bible",2020,"public-domain"],
  ["WEBC","World English Bible Catholic",2020,"public-domain"],
  ["WEBBE","World English Bible British Edition with Deuterocanon",2020,"public-domain"],
  ["YLT","Young's Literal Translation",1898,"public-domain"],
  ["DR","Douay-Rheims",1899,"public-domain"],
  ["JPS1917","Jewish Publication Society Tanakh",1917,"public-domain"],
  ["GENEVA1599","Geneva Bible",1599,"public-domain"],
  ["RV1885","English Revised Version",1885,"public-domain"],
  ["DARBY","Darby Translation",1890,"public-domain"],
  ["WEBU","World English Bible Updated","modern","public-domain"],
  ["BSB","Berean Standard Bible",2022,"public-domain"],
  ["MSB","Majority Standard Bible",2022,"public-domain"],
  ["NIV","New International Version","modern","licensed"],
  ["ESV","English Standard Version","modern","licensed"],
  ["NASB","New American Standard Bible","modern","licensed"],
  ["NRSVUE","New Revised Standard Version Updated Edition","modern","licensed"],
  ["NKJV","New King James Version","modern","licensed"],
  ["CSB","Christian Standard Bible","modern","licensed"],
  ["NLT","New Living Translation","modern","licensed"],
  ["AMP","Amplified Bible","modern","licensed"],
  ["NET","New English Translation","modern","licensed"],
  ["JPSNJPS","JPS New Tanakh / NJPS","modern","licensed"],
  ["ARTSCROLL","ArtScroll Tanakh","modern","licensed"]
]);

export function bibleCatalog() {
  return {
    families: BIBLE_FAMILIES.map(x => ({...x, textFamilies:[...x.textFamilies]})),
    editions: BIBLE_EDITIONS.map(([id,title,date,license]) => ({id,title,date,license}))
  };
}
