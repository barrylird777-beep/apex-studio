import { KORN_POPZ, createKornPopzRating, kornPopzStatus } from "../core/korn-popz.mjs";

export { KORN_POPZ, createKornPopzRating };

export function kornPopzAppStatus() {
  return {
    app: {
      id: "apex-studio",
      name: "ApexStudio",
      role: "creative production, editing, mastering, QC and delivery"
    },
    ...kornPopzStatus()
  };
}
