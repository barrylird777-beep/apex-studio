import { KORN_NUTZ, createKornNutzRating, kornNutzStatus } from "../core/korn-nutz.mjs";

export { KORN_NUTZ, createKornNutzRating };

export function kornNutzAppStatus() {
  return {
    app: {
      id: "apex-studio",
      name: "ApexStudio",
      role: "creative production, editing, mastering, QC and delivery"
    },
    ...kornNutzStatus()
  };
}
