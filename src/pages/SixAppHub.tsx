import { useMemo, useState } from "react";
import { ArrowUpRight, AudioLines, BookOpen, Blocks, CircleDollarSign, Eye, Globe2, LayoutGrid, LockKeyhole, Music2, Search, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import "./SixAppHub.css";

type AppKey = "kernelvision" | "xshield" | "kernelodies" | "planetapex" | "kashkorner" | "koinkob";

type ApexApp = {
  key: AppKey;
  name: string;
  role: string;
  tagline: string;
  description: string;
  icon: typeof Eye;
  accent: string;
  status: string;
  features: string[];
  links: { label: string; href: string; note: string }[];
};

const apps: ApexApp[] = [
  {
    key: "kernelvision", name: "KernelVision", role: "THE EYES", tagline: "Create what you can imagine.",
    description: "The production and media studio that creates original work and owns the 24/7 self-uploading entertainment stream, from development and rendering through publishing.",
    icon: Eye, accent: "violet", status: "Studio workspace",
    features: ["24/7 entertainment stream", "Creative development", "Media production pipeline", "Publishing and analytics"],
    links: [
      { label: "Open KernelVision", href: "/kernel-vision.html", note: "Production studio and continuous stream" },
      { label: "Open 24/7 network status", href: "/teevee.html", note: "TeeVee network capability under KernelVision" },
      { label: "Open scenes and shots", href: "/scenes", note: "Production workspace" },
      { label: "Open characters and worlds", href: "/characters", note: "Creative development workspace" },
    ],
  },
  {
    key: "xshield", name: "XShield", role: "THE SHIELD", tagline: "Privacy should be the default.",
    description: "The security and privacy surface for reviewing protection status, privacy controls, and network safeguards.",
    icon: ShieldCheck, accent: "cyan", status: "Security workspace",
    features: ["Protection overview", "Privacy controls", "Tracker and ad blocking", "Connection safety"],
    links: [
      { label: "Open XShield", href: "/xshield.html", note: "Security and privacy workspace" },
      { label: "Review privacy safeguards", href: "/network", note: "Network protection status" },
    ],
  },
  {
    key: "kernelodies", name: "Kernelodies", role: "THE EARS", tagline: "Your music, your way.",
    description: "The listening and discovery space for music, artists, albums, culture, and the DeckOfKobs player.",
    icon: Music2, accent: "rose", status: "Music workspace",
    features: ["Music library and playback", "Artist and album discovery", "DeckOfKobs controls", "KobSense and KornYtunes"],
    links: [
      { label: "Open Kernelodies", href: "/kernelodies.html", note: "Music library and discovery" },
      { label: "Return to APEX apps", href: "/apps", note: "Six-app home" },
    ],
  },
  {
    key: "planetapex", name: "PlanetApeX", role: "THE BRAIN", tagline: "A universe built to explore.",
    description: "The living world for Bible study, research, analytics, ancient texts, and GardenApex—the universe where Korn lives.",
    icon: Globe2, accent: "green", status: "Research and universe",
    features: ["Bible study and Scripture", "Manuscripts and source research", "GardenApex universe", "Research analytics"],
    links: [
      { label: "Open PlanetApeX", href: "/planet-apex.html", note: "Bible study and research universe" },
      { label: "Explore characters and worlds", href: "/characters", note: "Existing world-building workspace" },
      { label: "Explore research network", href: "/network", note: "Research and source discovery" },
    ],
  },
  {
    key: "kashkorner", name: "KashKorner", role: "MONEY AND DATA", tagline: "Useful tools. No forced subscriptions.",
    description: "The financial and data workspace for opportunities, transactions, and the public-facing rapid video-rendering offer.",
    icon: WalletCards, accent: "amber", status: "Finance workspace",
    features: ["Opportunity discovery", "Transaction surfaces", "Data tools", "Video-rendering storefront"],
    links: [
      { label: "Open KashKorner", href: "/kash-korner.html", note: "Financial tools and video storefront" },
      { label: "Return to APEX apps", href: "/apps", note: "Six-app home" },
    ],
  },
  {
    key: "koinkob", name: "KoinKob", role: "THE ECONOMY LAB", tagline: "Model systems. Test outcomes.",
    description: "The autonomous-economy lab for worker activity, asset markets, market clearing, simulations, and adversarial events—separate from the other apps and their private data.",
    icon: Blocks, accent: "blue", status: "Economy simulation workspace",
    features: ["Worker and agent economies", "Asset markets and market clearing", "Systemic and adversarial events", "Simulation and outcome analysis"],
    links: [
      { label: "Open KoinKob", href: "/koin-kob.html", note: "Autonomous-economy lab" },
      { label: "Return to APEX apps", href: "/apps", note: "Six-app home" },
    ],
  },
];

export default function SixAppHub() {
  const [activeKey, setActiveKey] = useState<AppKey>("kernelvision");
  const [query, setQuery] = useState("");
  const visibleApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((app) => !q || [app.name, app.role, app.tagline, app.description, ...app.features].join(" ").toLowerCase().includes(q));
  }, [query]);
  const active = visibleApps.find((app) => app.key === activeKey) ?? visibleApps[0] ?? apps.find((app) => app.key === activeKey) ?? apps[0];
  const ActiveIcon = active.icon;

  return (
    <div className="apex-hub">
      <header className="apex-hub-header">
        <div className="apex-hub-brand">
          <div className="apex-hub-mark"><Sparkles size={20} aria-hidden="true" /></div>
          <div><span className="apex-hub-eyebrow">APEX ANCHOR</span><strong>Six-app command deck</strong></div>
        </div>
        <div className="apex-hub-header-right"><span className="apex-hub-live-dot" /> Canonical app set <span className="apex-hub-count">06</span></div>
      </header>

      <main className="apex-hub-main">
        <section className="apex-hub-intro">
          <div className="apex-hub-kicker"><LayoutGrid size={14} /> ONE CONNECTED ECOSYSTEM · SIX DISTINCT APPS</div>
          <h1>Everything in its<br /><em>right place.</em></h1>
          <p>Six purpose-built spaces. Shared capabilities where useful, with each app’s identity and private data kept separate.</p>
          <div className="apex-hub-intro-meta"><span><LockKeyhole size={14} /> Privacy-first boundaries</span><span><Blocks size={14} /> Phone-ready layout</span></div>
        </section>

        <section className="apex-hub-workspace" aria-label="APEX app selector">
          <div className="apex-hub-app-list">
            <div className="apex-hub-section-head">
              <div><span className="apex-hub-label">YOUR ECOSYSTEM</span><h2>Choose an app</h2></div>
              <span className="apex-hub-number">{visibleApps.length.toString().padStart(2, "0")} / 06</span>
            </div>
            <label className="apex-hub-search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an app or capability" aria-label="Find an app or capability" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}</label>
            <div className="apex-hub-app-cards">
              {visibleApps.map((app, index) => {
                const Icon = app.icon;
                const selected = app.key === activeKey;
                return <button type="button" key={app.key} className={`apex-hub-app-card ${selected ? "is-selected" : ""} accent-${app.accent}`} onClick={() => setActiveKey(app.key)} aria-pressed={selected}>
                  <span className="apex-hub-app-icon"><Icon size={21} strokeWidth={1.8} /></span>
                  <span className="apex-hub-app-copy"><span className="apex-hub-app-role">{app.role}</span><strong>{app.name}</strong><small>{app.tagline}</small></span>
                  <span className="apex-hub-app-index">0{index + 1}</span>
                  <ArrowUpRight className="apex-hub-app-arrow" size={17} />
                </button>;
              })}
              {visibleApps.length === 0 && <div className="apex-hub-no-results">No apps match “{query}”. Try a different search.</div>}
            </div>
          </div>

          <section className={`apex-hub-detail accent-${active.accent}`} aria-live="polite">
            <div className="apex-hub-detail-top"><span className="apex-hub-label">APP PROFILE</span><span className="apex-hub-profile-state"><span /> {active.status}</span></div>
            <div className="apex-hub-detail-title">
              <div className="apex-hub-detail-icon"><ActiveIcon size={28} strokeWidth={1.7} /></div>
              <div><span className="apex-hub-app-role">{active.role}</span><h2>{active.name}</h2></div>
            </div>
            <h3>{active.tagline}</h3>
            <p className="apex-hub-detail-description">{active.description}</p>
            <div className="apex-hub-feature-block"><span className="apex-hub-label">CORE AREAS</span><div className="apex-hub-feature-list">{active.features.map((feature) => <span key={feature}><span className="apex-hub-feature-check">✓</span>{feature}</span>)}</div></div>
            <div className="apex-hub-detail-links"><span className="apex-hub-label">WORKSPACES</span>{active.links.map((link) => <a key={link.label} href={link.href}><span><strong>{link.label}</strong><small>{link.note}</small></span><ArrowUpRight size={17} /></a>)}</div>
            <div className="apex-hub-boundary-note"><LockKeyhole size={15} /><span><strong>APEX LAW</strong> · Preserve each app’s purpose and keep private data boundaries explicit.</span></div>
          </section>
        </section>

        <section className="apex-hub-bottom">
          <div><div className="apex-hub-bottom-icon"><BookOpen size={19} /></div><span><strong>PlanetApeX</strong><small>Research, Scripture, and the living universe.</small></span></div>
          <div><div className="apex-hub-bottom-icon"><AudioLines size={19} /></div><span><strong>Kernelodies</strong><small>Listening, discovery, and music culture.</small></span></div>
          <div><div className="apex-hub-bottom-icon"><CircleDollarSign size={19} /></div><span><strong>KashKorner</strong><small>Financial tools and data opportunities.</small></span></div>
        </section>
        <footer className="apex-hub-footer"><span>APEX ANCHOR / SIX CANONICAL APPS</span><button type="button" onClick={() => { setActiveKey("kernelvision"); setQuery(""); }}>Reset app selector</button><span>Built for small screens first</span></footer>
      </main>
    </div>
  );
}
