import { PaintStageDef } from '../types';

export const PROCS: string[] = [
  "Раскрой NESTING",
  "2 пильный",
  "кромка",
  "Присадка",
  "ФАСАД NESTING",
  "Ровер",
  "Фигурный кромка",
  "Пленка PVC",
  "Шлиповка",
  "Грунтовка",
  "краска",
  "OTK",
  "Упаковка",
  "Сборка"
];

export const PAINT_PROCS: string[] = ["Шлиповка", "Грунтовка", "Краска"];

export const ALL_WORKER_PROCS: string[] = Array.from(new Set([...PROCS, ...PAINT_PROCS]));

export const KANBAN_PROCS: string[] = PROCS.filter(
  p => !["краска", "Упаковка", "Сборка", "Пленка PVC", "ФАСАД NESTING", "Ровер"].includes(p)
);

export const PAINT_STAGES_DEF: PaintStageDef[] = [
  { key: 'шлиф_1',  label: 'Шлиповка 1',  type: 'шлиповка' },
  { key: 'грунт_1', label: 'Грунтовка 1', type: 'грунтовка' },
  { key: 'шлиф_2',  label: 'Шлиповка 2',  type: 'шлиповка' },
  { key: 'грунт_2', label: 'Грунтовка 2', type: 'грунтовка' },
  { key: 'краска_1',label: 'Краска 1',    type: 'краска' },
  { key: 'краска_2',label: 'Краска 2',    type: 'краска' },
];

export const PAINT_WORKER_TYPES: Record<string, string[]> = {
  'Шлиповка':  ['шлиф_1', 'шлиф_2'],
  'Грунтовка': ['грунт_1', 'грунт_2'],
  'Краска':    ['краска_1', 'краска_2'],
  'краска':    ['шлиф_1', 'грунт_1', 'шлиф_2', 'грунт_2', 'краска_1', 'краска_2'],
};
