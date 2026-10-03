import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Scene = {
  id: number;
  projectId: number;
  sceneNumber: number | null;
  title: string | null;
  scriptureRef: string;
  location: string | null;
  charactersPresent: number[];
  actionSummary: string | null;
  emotionalBeat: string | null;
  productionNotes: string | null;
  estimatedPages: number | null;
  dayOrNight: string | null;
};

type Character = { id: number; canonicalName: string };

const emptyDraft = {
  sceneNumber: "",
  title: "",
  scriptureRef: "",
  location: "",
  dayOrNight: "",
  actionSummary: "",
  emotionalBeat: "",
  productionNotes: "",
  estimatedPages: "",
  charactersPresent: [] as number[],
};

export default function SceneList() {
  const params = new URLSearchParams(location.search);
  const projectId = Number(params.get("projectId"));
  const [projectTitle, setProjectTitle] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Scene | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError("A valid project is required.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [sceneResponse, projectResponse, characterResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/scenes`),
        fetch(`/api/projects/${projectId}/overview`),
        fetch("/api/characters"),
      ]);
      if (!sceneResponse.ok) throw new Error("Unable to load scenes.");
      const sceneData = await sceneResponse.json();
      setScenes(sceneData);
      if (projectResponse.ok) {
        const project = await projectResponse.json();
        setProjectTitle(project.title || "");
      }
      if (characterResponse.ok) setCharacters(await characterResponse.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load scenes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  function openEditor(scene: Scene) {
    setEditing(scene);
    setDraft({
      sceneNumber: scene.sceneNumber == null ? "" : String(scene.sceneNumber),
      title: scene.title || "",
      scriptureRef: scene.scriptureRef,
      location: scene.location || "",
      dayOrNight: scene.dayOrNight || "",
      actionSummary: scene.actionSummary || "",
      emotionalBeat: scene.emotionalBeat || "",
      productionNotes: scene.productionNotes || "",
      estimatedPages: scene.estimatedPages == null ? "" : String(scene.estimatedPages),
      charactersPresent: scene.charactersPresent || [],
    });
  }

  function setField<K extends keyof typeof emptyDraft>(key: K, value: (typeof emptyDraft)[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!editing) return;
    if (!draft.scriptureRef.trim()) {
      setError("Scripture reference is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/scenes/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneNumber: draft.sceneNumber === "" ? null : Number(draft.sceneNumber),
          title: draft.title,
          scriptureRef: draft.scriptureRef,
          location: draft.location,
          dayOrNight: draft.dayOrNight,
          actionSummary: draft.actionSummary,
          emotionalBeat: draft.emotionalBeat,
          productionNotes: draft.productionNotes,
          estimatedPages: draft.estimatedPages === "" ? null : Number(draft.estimatedPages),
          charactersPresent: draft.charactersPresent,
        }),
      });
      if (!response.ok) throw new Error("Unable to save scene.");
      const updated = await response.json();
      setScenes(current => current.map(scene => scene.id === updated.id ? updated : scene)
        .sort((a, b) => (a.sceneNumber ?? Number.MAX_SAFE_INTEGER) - (b.sceneNumber ?? Number.MAX_SAFE_INTEGER) || a.id - b.id));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save scene.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(scene: Scene) {
    if (!confirm(`Delete scene ${scene.sceneNumber ?? ""}?`)) return;
    setError("");
    const response = await fetch(`/api/scenes/${scene.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Unable to delete scene.");
      return;
    }
    setScenes(current => current.filter(item => item.id !== scene.id));
  }

  async function move(scene: Scene, direction: -1 | 1) {
    const index = scenes.findIndex(item => item.id === scene.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= scenes.length) return;

    const next = [...scenes];
    const other = next[target];
    const currentNumber = scene.sceneNumber ?? index + 1;
    const otherNumber = other.sceneNumber ?? target + 1;
    next[index] = { ...scene, sceneNumber: otherNumber };
    next[target] = { ...other, sceneNumber: currentNumber };
    next.sort((a, b) => (a.sceneNumber ?? Number.MAX_SAFE_INTEGER) - (b.sceneNumber ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);

    try {
      const [a, b] = await Promise.all([
        fetch(`/api/scenes/${scene.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneNumber: otherNumber }),
        }),
        fetch(`/api/scenes/${other.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneNumber: currentNumber }),
        }),
      ]);
      if (!a.ok || !b.ok) throw new Error("Unable to reorder scenes.");
      setScenes(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reorder scenes.");
      await load();
    }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading scenes...</div>;

  return (
    <div className="container mx-auto max-w-7xl p-6">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <button className="mb-2 text-sm text-muted-foreground hover:underline" onClick={() => location.href = "/"}>
            ← Projects
          </button>
          <h1 className="text-3xl font-bold tracking-tight">{projectTitle || "Scene List"}</h1>
          <p className="text-muted-foreground">Scenes and production breakdown</p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {scenes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="py-16 text-center">
              <h2 className="text-xl font-semibold">No scenes yet</h2>
              <p className="mt-2 text-muted-foreground">Generate a scripture breakdown or add scenes to this project to begin.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Scenes ({scenes.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3">Scene</th>
                  <th className="px-4 py-3">Scripture</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Day/Night</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scenes.map((scene, index) => (
                  <tr key={scene.id} className="border-b last:border-0">
                    <td className="px-4 py-3 align-top font-medium">{scene.sceneNumber ?? index + 1}</td>
                    <td className="px-4 py-3 align-top font-mono text-xs">{scene.scriptureRef}</td>
                    <td className="px-4 py-3 align-top">{scene.location || "—"}</td>
                    <td className="px-4 py-3 align-top">{scene.dayOrNight || "—"}</td>
                    <td className="max-w-md px-4 py-3 align-top">{scene.actionSummary || "—"}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => move(scene, -1)} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" disabled={index === scenes.length - 1} onClick={() => move(scene, 1)} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditor(scene)} title="Edit scene"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(scene)} title="Delete scene"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Edit Scene {editing?.sceneNumber ?? ""}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Scene number<Input type="number" min="1" value={draft.sceneNumber} onChange={e => setField("sceneNumber", e.target.value)} /></label>
              <label className="text-sm font-medium">Scripture reference<Input value={draft.scriptureRef} onChange={e => setField("scriptureRef", e.target.value)} /></label>
            </div>
            <label className="text-sm font-medium">Title<Input value={draft.title} onChange={e => setField("title", e.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Location<Input value={draft.location} onChange={e => setField("location", e.target.value)} /></label>
              <label className="text-sm font-medium">Day / Night<select className="mt-1 h-10 w-full rounded-md border px-3" value={draft.dayOrNight} onChange={e => setField("dayOrNight", e.target.value)}><option value="">Unspecified</option><option value="DAWN">Dawn</option><option value="DAY">Day</option><option value="DUSK">Dusk</option><option value="NIGHT">Night</option></select></label>
            </div>
            <label className="text-sm font-medium">Characters present<div className="mt-2 grid max-h-36 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{characters.map(character => <label key={character.id} className="flex items-center gap-2 font-normal"><input type="checkbox" checked={draft.charactersPresent.includes(character.id)} onChange={e => setField("charactersPresent", e.target.checked ? [...draft.charactersPresent, character.id] : draft.charactersPresent.filter(id => id !== character.id))} />{character.canonicalName}</label>)}</div></label>
            <label className="text-sm font-medium">Action summary<Textarea value={draft.actionSummary} onChange={e => setField("actionSummary", e.target.value)} /></label>
            <label className="text-sm font-medium">Emotional / spiritual beat<Textarea value={draft.emotionalBeat} onChange={e => setField("emotionalBeat", e.target.value)} /></label>
            <label className="text-sm font-medium">Production notes<Textarea value={draft.productionNotes} onChange={e => setField("productionNotes", e.target.value)} /></label>
            <label className="text-sm font-medium">Estimated pages<Input type="number" min="0" step="0.1" value={draft.estimatedPages} onChange={e => setField("estimatedPages", e.target.value)} /></label>
            <Button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save changes"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
