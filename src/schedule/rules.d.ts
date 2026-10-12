export interface ScheduleScene {
  id: number;
  sequence: number;
  location?: { name?: string; timeOfDay?: string };
}

export interface ScheduleWarning {
  code: string;
  message: string;
}

export interface CalendarDay {
  id: number;
  shootDate: string;
  scenes: ScheduleScene[];
  warnings: ScheduleWarning[];
}

export function analyzeDay(
  scenes: ScheduleScene[],
  options?: { maxScenes?: number },
): ScheduleWarning[];

export function buildCalendar(args: {
  days: Array<Record<string, unknown> & { id: number; shootDate: string }>;
  assignments: Array<{ sceneId: number; shootDayId: number; position: number }>;
  scenes: ScheduleScene[];
  options?: { maxScenes?: number };
}): {
  days: CalendarDay[];
  unassigned: ScheduleScene[];
  missingSceneIds: number[];
  summary: { totalScenes: number; assigned: number; unassigned: number };
};

export function autoSchedule(
  scenes: ScheduleScene[],
  days: Array<{ id: number; existingCount?: number }>,
  options?: { maxScenes?: number },
): { plan: Array<{ dayId: number; sceneIds: number[] }>; overflow: number[] };
