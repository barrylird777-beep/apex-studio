import pg from "pg";
import { createHash } from "node:crypto";
import { APEXUS_LANES } from "../src/core/apexus-production.mjs";

const { Pool } = pg;
if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,ssl:process.env.APEX_PG_SSL==="false"?false:{rejectUnauthorized:false}});

const nouns=["Ash","Garden","Moon","Crown","River","Star","Glass","Thunder","Lantern","Wolf","Ember","Hollow","Bell","Storm","Veil","Kingdom","Feather","Iron","Dream","Shadow","Dawn","Signal","Comet","Bone","Fire","Mirror","Clock","Sky","Maze","Harbor"];
const verbs=["Remember","Return","Awaken","Run","Fall","Rise","Hide","Cross","Find","Break","Guard","Chase","Open","Follow","Defend","Uncover","Steal","Build","Escape","Choose"];
const worlds=["a city above a sleeping sea","a haunted garden beneath an artificial moon","a kingdom where forgotten things become monsters","a neighborhood hiding a door to impossible worlds","a frontier where stories can physically change reality","a family home built around a secret underground theater"];
const hooks=["Something impossible appears before breakfast.","The hero hears a voice coming from tomorrow.","A harmless mistake wakes something ancient.","The town receives a message addressed to someone who has not been born.","A door appears where yesterday there was only a wall.","The sky changes color and only one character notices."];

function pick(a,n,s){return a[(n*s)%a.length]}
function hash(n){return createHash("sha256").update("apexus:"+n).digest("hex")}
function title(n){const h=hash(n);const a=parseInt(h.slice(0,8),16);const b=parseInt(h.slice(8,16),16);return `${pick(verbs,a,n)} ${pick(nouns,b,n)}`}
function lane(n){return APEXUS_LANES[(n-1)%APEXUS_LANES.length]}
function rating(n){return lane(n)==="Apexus Family"||lane(n)==="KornKids"?"TV-Y7":lane(n)==="Apexus After Dark"||lane(n)==="KornSwim"||lane(n)==="Dark Garden"?"TV-14":"TV-PG"}

try{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const rows=await client.query("SELECT id,global_episode_number FROM apexus_episodes ORDER BY global_episode_number");
  for(const e of rows.rows){
   const n=Number(e.global_episode_number), h=hash(n), t=title(n), l=lane(n);
   const brief={
    premise:`An original Apexus story set in ${pick(worlds,parseInt(h.slice(0,8),16),n)}.`,
    hook30:`30-second hook: ${pick(hooks,parseInt(h.slice(8,16),16),n)}`,
    protagonist:`A young outsider who refuses to accept the impossible as normal.`,
    conflict:`A personal choice collides with a larger threat before the truth can be hidden again.`,
    escalation:"Each discovery makes the next choice more dangerous.",
    reversal:"The apparent threat is connected to the protagonist's own unfinished decision.",
    climax:"The protagonist acts decisively rather than waiting for someone else to save the day.",
    payoff:"The immediate danger is resolved while a larger mystery remains alive.",
    visualDNA:"dark fantasy anime, sharp cel shading, high-contrast cinematic lighting, highly detailed, original characters and environments"
   };
   const runtime=Number(episodeRuntime(n));
   await client.query("UPDATE apexus_episodes SET title=$2,logline=$3,audience_lane=$4,maturity_rating=$5,visual_style=$6,runtime_target_seconds=$7,creative_brief=$8::jsonb,metadata=metadata||$9::jsonb,updated_at=NOW() WHERE id=$1",
    [e.id,t,brief.premise,l,rating(n),brief.visualDNA,runtime,JSON.stringify(brief),JSON.stringify({seed:h,episodeNumber:n,canonPrepared:true})]);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({status:"ok",prepared:rows.rowCount,first:"APX-0001",last:"APX-2785"}));
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}finally{await pool.end()}

function episodeRuntime(n){return 180+((n*37)%181)}
