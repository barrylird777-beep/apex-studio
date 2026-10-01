export function rankDocuments(query,documents=[],limit=8){
 const terms=String(query).toLowerCase().split(/\\W+/).filter(Boolean);
 return documents.map(d=>{const text=JSON.stringify(d).toLowerCase();const hits=terms.reduce((n,t)=>n+(text.includes(t)?1:0),0);return {...d,score:terms.length?hits/terms.length:0};}).filter(d=>d.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
