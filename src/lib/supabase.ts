import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xknypljgfgkzgokogexz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_96Ews89Vjt4la_07SQhf6A_WOmDGSSN';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
