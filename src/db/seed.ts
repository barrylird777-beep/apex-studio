import { db } from "./index";
import { characters } from "./schema";

const seedCharacters = [
["Adam",["Adamah"],["Genesis"],["Eve — wife"],["first man"],["Genesis 2:7","Genesis 3:6"]],
["Eve",[],["Genesis"],["Adam — husband"],["first woman"],["Genesis 2:22","Genesis 3:20"]],
["Noah",[],["Genesis"],["Shem — son","Ham — son","Japheth — son"],["righteous","builder of the ark"],["Genesis 6:9","Genesis 7:1"]],
["Abraham",["Abram"],["Genesis"],["Sarah — wife","Isaac — son","Ishmael — son"],["patriarch","faithful"],["Genesis 12:1","Genesis 22:2"]],
["Sarah",["Sarai"],["Genesis"],["Abraham — husband","Isaac — son"],["matriarch"],["Genesis 17:15","Genesis 21:1"]],
["Isaac",[],["Genesis"],["Abraham — father","Sarah — mother","Rebekah — wife"],["patriarch"],["Genesis 21:3","Genesis 22:9"]],
["Rebekah",[],["Genesis"],["Isaac — husband","Jacob — son","Esau — son"],["matriarch"],["Genesis 24:67","Genesis 25:28"]],
["Jacob",["Israel"],["Genesis"],["Isaac — father","Rachel — wife","Leah — wife","Joseph — son"],["patriarch","wrestled with God"],["Genesis 28:10","Genesis 32:28"]],
["Rachel",[],["Genesis"],["Jacob — husband","Joseph — son","Benjamin — son"],["matriarch"],["Genesis 29:30","Genesis 30:22"]],
["Joseph",[],["Genesis"],["Jacob — father","Benjamin — brother"],["dreamer","ruler in Egypt"],["Genesis 37:5","Genesis 41:41"]],
["Moses",[],["Exodus","Numbers","Deuteronomy"],["Aaron — brother","Miriam — sister","Pharaoh — adversary"],["prophet","leader"],["Exodus 3:10","Exodus 14:13"]],
["Aaron",[],["Exodus","Leviticus","Numbers"],["Moses — brother","Miriam — sister"],["first high priest"],["Exodus 4:14","Leviticus 8:12"]],
["Miriam",[],["Exodus","Numbers"],["Moses — brother","Aaron — brother"],["prophetess"],["Exodus 15:20","Numbers 12:1"]],
["Joshua",[],["Joshua"],["Moses — mentor"],["leader","warrior"],["Joshua 1:1","Joshua 6:2"]],
["Rahab",[],["Joshua"],["Salmon — husband"],["woman of Jericho","protected spies"],["Joshua 2:1","Joshua 6:25"]],
["Deborah",[],["Judges"],["Barak — ally"],["prophetess","judge"],["Judges 4:4","Judges 5:7"]],
["Gideon",["Jerubbaal"],["Judges"],["Abimelech — son"],["judge","warrior"],["Judges 6:12","Judges 7:7"]],
["Samson",[],["Judges"],["Delilah — companion"],["judge","strong"],["Judges 13:24","Judges 16:28"]],
["Ruth",[],["Ruth"],["Naomi — mother-in-law","Boaz — husband"],["loyal","Moabite"],["Ruth 1:16","Ruth 4:13"]],
["Naomi",[],["Ruth"],["Ruth — daughter-in-law"],["widow","faithful"],["Ruth 1:20","Ruth 4:17"]],
["Samuel",[],["1 Samuel"],["Eli — mentor","Saul — king he anointed","David — king he anointed"],["prophet","judge"],["1 Samuel 3:20","1 Samuel 16:13"]],
["Saul",[],["1 Samuel"],["Jonathan — son","David — rival"],["first king of Israel"],["1 Samuel 10:1","1 Samuel 15:23"]],
["David",[],["1 Samuel","2 Samuel","Psalms"],["Jonathan — friend","Saul — predecessor","Solomon — son"],["king","psalmist"],["1 Samuel 16:13","2 Samuel 5:4"]],
["Jonathan",[],["1 Samuel"],["Saul — father","David — friend"],["loyal","warrior"],["1 Samuel 18:1","1 Samuel 20:17"]],
["Solomon",[],["1 Kings","Proverbs","Ecclesiastes"],["David — father","Bathsheba — mother"],["king","wise"],["1 Kings 3:12","1 Kings 4:29"]],
["Elijah",[],["1 Kings","2 Kings"],["Elisha — successor"],["prophet"],["1 Kings 17:1","1 Kings 18:21"]],
["Elisha",[],["1 Kings","2 Kings"],["Elijah — mentor"],["prophet"],["2 Kings 2:9","2 Kings 4:1"]],
["Esther",["Hadassah"],["Esther"],["Mordecai — cousin"],["queen","courageous"],["Esther 2:7","Esther 4:14"]],
["Mordecai",[],["Esther"],["Esther — cousin"],["faithful","guardian"],["Esther 2:5","Esther 4:1"]],
["Job",[],["Job"],[],["righteous sufferer"],["Job 1:1","Job 42:12"]],
["Isaiah",[],["Isaiah"],[],["prophet"],["Isaiah 1:1","Isaiah 6:8"]],
["Jeremiah",[],["Jeremiah"],[],["prophet"],["Jeremiah 1:5","Jeremiah 20:9"]],
["Daniel",[],["Daniel"],["Nebuchadnezzar — king"],["prophet","wise"],["Daniel 1:6","Daniel 6:23"]],
["Jonah",[],["Jonah"],[],["prophet"],["Jonah 1:1","Jonah 3:1"]],
["Mary",["Mary mother of Jesus"],["Matthew","Mark","Luke","John"],["Joseph — husband","Jesus — son"],["mother of Jesus","faithful"],["Luke 1:30","Luke 2:7"]],
["Joseph",["Joseph of Nazareth"],["Matthew","Luke"],["Mary — wife","Jesus — son"],["carpenter","righteous"],["Matthew 1:19","Matthew 1:24"]],
["John the Baptist",["John"],["Matthew","Mark","Luke","John"],["Jesus — relative"],["prophet","baptizer"],["Matthew 3:1","John 1:29"]],
["Jesus",["Jesus Christ","Christ"],["Matthew","Mark","Luke","John"],["Mary — mother","Joseph — earthly guardian","Peter — disciple"],["Messiah","Son of God"],["Matthew 1:1","John 3:16"]],
["Peter",["Simon Peter","Simon"],["Matthew","Mark","Luke","John","Acts"],["Jesus — teacher","Andrew — brother"],["apostle","disciple"],["Matthew 4:18","Matthew 16:16"]],
["John",["John the Apostle"],["Matthew","Mark","Luke","John"],["James — brother","Jesus — teacher"],["apostle","disciple"],["Mark 1:19","John 21:24"]],
["James",["James son of Zebedee"],["Matthew","Mark","Luke","Acts"],["John — brother","Jesus — teacher"],["apostle"],["Mark 1:19","Acts 12:2"]],
["Paul",["Saul of Tarsus"],["Acts","Romans","1 Corinthians"],["Barnabas — co-worker"],["apostle","missionary"],["Acts 9:1","Acts 13:2"]]
] as const;

const existing = new Set(db.select({name: characters.canonicalName}).from(characters).all().map(x=>x.name));
for (const [canonicalName, aliases, primaryStories, relationships, keyTraits, scriptureReferences] of seedCharacters) {
  if (existing.has(canonicalName)) continue;
  db.insert(characters).values({canonicalName,aliases:[...aliases],primaryStories:[...primaryStories],relationships:relationships.map(x=>{const [name,relation]=x.split(" — ");return {name,relation};}),keyTraits:[...keyTraits],notes:null,scriptureReferences:[...scriptureReferences]}).run();
}
console.log(`SPEC-002 seed ready: ${db.select().from(characters).all().length} characters`);