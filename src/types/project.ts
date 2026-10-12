export type ProjectStatus = "development" | "pre-production" | "production" | "post";

export interface Project {
  id: number; title: string; description: string | null; primaryScripture: string | null;
  status: ProjectStatus; createdAt: Date; updatedAt: Date;
}
export interface ProjectOverview extends Project {
  sceneCount: number; characterCount: number; nextShootDay: string | null;
}