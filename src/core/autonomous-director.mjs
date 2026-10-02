import { uid, now } from "./id.mjs";
import { diagnoseEpisode, repairPlan } from "./production-doctor.mjs";

export const DIRECTOR_MODES=Object.freeze(["plan","repair","produce","review","release"]);

const arr=v=>Array.isArray(v)?v:[];

export function createAutonomousPlan({episode={},canon={},characters=[],previousCharacters=[],mode="plan"}={}) {
  const diagnosis=diagnoseEpisode({episode,canon,characters,previousCharacters});
  const plan=repairPlan(diagnosis);
  const actions=arr(plan.steps).map(step=>({
    id:uid("action"),
    order:step.order,
    action:step.action,
    dependencies:step.dependencies,
    mode,
    status:"ready"
  }));
  return {
    id:uid("director-plan"),
    episodeId:episode.id??null,
    mode,
    actions,
    blocked:diagnosis.findings.filter(x=>x.severity==="blocker"),
    parallelizable:actions.filter((action,index)=>index>0&&action.dependencies.length===0),
    diagnosisId:diagnosis.id,
    createdAt:now()
  };
}

export function nextDirectorAction(plan={}) {
  const action=arr(plan.actions).find(item=>item.status==="ready");
  return action??null;
}

export function directorDecision({plan={},stage=null}={}) {
  const action=nextDirectorAction(plan);
  if(plan.blocked?.length) return {decision:"repair",reason:"quality blockers exist",action};
  if(!action) return {decision:stage==="release"?"release":"review",reason:"no pending production actions"};
  return {decision:"execute",action};
}
