export const TORAH_BOOKS = Object.freeze([
 {id:"genesis",order:1,english:"Genesis",hebrew:"Bereshit",alt:"Genesis / בראשית"},
 {id:"exodus",order:2,english:"Exodus",hebrew:"Shemot",alt:"Exodus / שמות"},
 {id:"leviticus",order:3,english:"Leviticus",hebrew:"Vayikra",alt:"Leviticus / ויקרא"},
 {id:"numbers",order:4,english:"Numbers",hebrew:"Bamidbar",alt:"Numbers / במדבר"},
 {id:"deuteronomy",order:5,english:"Deuteronomy",hebrew:"Devarim",alt:"Deuteronomy / דברים"}
]);

export const TORAH_TRADITIONS = Object.freeze([
 {id:"masoretic",name:"Masoretic Hebrew Torah",family:"Hebrew Bible / Tanakh"},
 {id:"samaritan",name:"Samaritan Pentateuch",family:"Samaritan"},
 {id:"septuagint",name:"Septuagint Pentateuch",family:"Septuagint (LXX)"},
 {id:"peshitta",name:"Syriac Peshitta Pentateuch",family:"Peshitta"},
 {id:"vulgate",name:"Latin Vulgate Pentateuch",family:"Latin Vulgate"},
 {id:"jewish-translation",name:"Jewish Torah translations",family:"Jewish"},
 {id:"catholic",name:"Catholic Pentateuch traditions",family:"Roman Catholic"},
 {id:"orthodox",name:"Eastern Orthodox Pentateuch traditions",family:"Eastern Orthodox"},
 {id:"protestant",name:"Protestant Pentateuch traditions",family:"Protestant"}
]);

export function getTorahBook(id){return TORAH_BOOKS.find(b=>b.id===id)??null}
export function listTorahBooks(){return [...TORAH_BOOKS]}
export function listTorahTraditions(){return [...TORAH_TRADITIONS]}
