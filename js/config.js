// --- CONFIG ---
export const SUPABASE_URL = 'https://xknujpljgfgkzgokogexz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_96Ews89Vjt4la_07SQhf6A_WOmDGSSN';

// ОБНОВЛЕНО: 11 процессов без "Установка"
export const PROCS = ["Раскрой NESTING", "2 пильный", "кромка", "Присадка", "ФАСАД NESTING", "Ровер", "Фигурный кромка", "Пленка PVC", "Шлиповка", "Грунтовка", "краска", "OTK", "Упаковка", "Сборка"];

// PAINT_PROCS — отображаются у работника как спец-тип (с покрасочным UI)
export const PAINT_PROCS = ["Шлиповка", "Грунтовка", "Краска"];

export const ALL_WORKER_PROCS = [...new Set([...PROCS, ...PAINT_PROCS])];

// Kanban показывает 8 процессов (исключены: краска, Упаковка, Сборка, Пленка PVC, ФАСАД NESTING, Ровер)
export const KANBAN_PROCS = PROCS.filter(p => !["краска", "Упаковка", "Сборка", "Пленка PVC", "ФАСАД NESTING", "Ровер"].includes(p));
