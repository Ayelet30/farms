import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { createClient } from '@supabase/supabase-js';

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');

// ===== פונקציה מתוזמנת =====
export const processDueChildDeletions = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'Asia/Jerusalem',
    secrets: [SUPABASE_URL_S, SUPABASE_SERVICE_KEY_S],
  },
  async () => {
    const supabase = createClient(
      SUPABASE_URL_S.value(),
      SUPABASE_SERVICE_KEY_S.value()
    );

    const { data, error } = await supabase.rpc(
  'process_due_child_deletions_all_schemas'
);

    if (error) {
      console.error('❌ process_due_child_deletions_all_schemas failed', error);
      throw error;
    }

    console.log('✅ process_due_child_deletions_all_schemas finished. affected:', data);
  }
);
