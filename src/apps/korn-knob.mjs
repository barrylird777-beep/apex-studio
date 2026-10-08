import { createKornKnob, KORNKNOB_DOMAINS, KORNKNOB_IDEA_DOMAINS, createKornKnobIdea, scoreKornKnobMoviePotential } from "../core/korn-knob.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("korn-knob");

export function createKornKnobApp(options = {}) {
  const knob = createKornKnob(options);
  return Object.freeze({
    app: { ...APP },
    domains: [...KORNKNOB_DOMAINS],
    ideaDomains: [...KORNKNOB_IDEA_DOMAINS],
    ideaRole: "in-app ideas with movie-potential percentage scoring",
    register: knob.register,
    unregister: knob.unregister,
    providers: knob.providers,
    run: knob.run,
    on: knob.on,
    off: knob.off,
    status() {
      return {
        app: { ...APP },
        ...knob.status(),
        checkedAt: new Date().toISOString()
      };
    }
  });
}

export { KORNKNOB_IDEA_DOMAINS, createKornKnobIdea, scoreKornKnobMoviePotential };

export function kornKnobStatus(providers = []) {
  return {
    app: { ...APP },
    domains: [...KORNKNOB_DOMAINS],
    providers: Array.isArray(providers) ? [...providers] : [],
    checkedAt: new Date().toISOString()
  };
}
