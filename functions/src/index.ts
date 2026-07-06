/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

// ===== Global options =====
setGlobalOptions({
  region: 'us-central1',
});

export { connectGmailForFarm } from './connectGmailForFarm';


export * from "./loginBootstrap.js";

export * from "./dailyBilling.js";

export * from "./publicSignup.js";


export { processDueChildDeletions } from './processDueChildDeletions';

export { openClaimsClalit } from './clalit-claims';

export { connectClalitForFarm, connectHmoForFarm } from './connectHmoForFarm';

export { createHostedPaymentUrl, tranzilaHandshake, recordOneTimePayment, savePaymentMethod, chargeSelectedChargesForParent, chargeSelectedChargesForRider, createManualPaymentAndInvoice } from './tranzila.js';
export {
  ensureTranzilaInvoiceForPayment, ensureTranzilaInvoiceForRiderPayment
} from './tranzilaInvoices.js';
export { sendEmailGmail } from './email';
export { notifyAvailabilityLessonAction } from './notify-availability-lesson-action';
//export  *  from "../createParent.js";
export { secretaryCancelOccurrenceAndNotify } from './secretary-cancel-occurrence-and-notify';

export { autoRejectRequestAndNotify } from './auto-reject-and-notify';
export { approveRemoveChildAndNotify } from './approve-remove-child-and-notify';
export { notifySeriesApproved } from './notifySeriesApproved';
export { notifySeriesRejected } from './notifySeriesRejected';
export { rejectRemoveChildAndNotify } from './rejectRemoveChildAndNotify';
export { notifyUser } from './notifyUser';
export { approveMakeupLessonAndNotify } from './approveMakeupLessonAndNotify';
export { rejectMakeupLessonAndNotify } from './rejectMakeupLessonAndNotify';
export { approveFillInAndNotify } from './approveFillInAndNotify';
export { rejectFillInAndNotify } from './rejectFillInAndNotify';
export { approveCancelOccurrenceAndNotify } from './approveCancelOccurrenceAndNotify'
export { rejectCancelOccurrenceAndNotify } from './rejectCancelOccurrenceAndNotify'
export { approveInstructorDayOffAndNotify } from './approve-instructor-day-off-and-notify';
export { rejectInstructorDayOffAndNotify } from './reject-instructor-day-off-and-notify';
export { approveAddChildAndNotify } from './approve-add-child-and-notify';
export { rejectAddChildAndNotify } from './reject-add-child-and-notify';
export { notifySingleLessonApproved } from './notify-single-lesson-approved'
export { notifySingleLessonRejected } from './notify-single-lesson-rejected'
export { secretaryCreateInstructorDayOffAndNotify } from './secretary-create-instructor-day-off-and-notify'
export { sendFarmDayOffCancellationEmails } from './send-farm-day-off-cancellation-emails';
export { previewInstructorDeactivationImpact } from './preview-instructor-deactivation-impact';
export { deactivateInstructorAndCancelFutureLessons } from './deactivate-instructor-and-cancel-future-lessons';
// export { createMaccabiAutomationJob } from './automation/maccabiJobs';
export {
  approveRiderServiceRequestAndNotify,
  rejectRiderServiceRequestAndNotify,
  createRiderServiceBySecretaryAndNotify,
} from './rider-service-request-decision';

export {
  upsertFarmBillingCustomer,
  createFarmBillingPaymentLink,
  markFarmBillingPaidManually,
  setFarmBillingStopped,
  cancelFarmBillingPayment,
  sendFarmBillingReceipt,
  cronMonthlyFarmBilling,
} from './farm-billing';
// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
import { defineSecret } from 'firebase-functions/params';

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const INTEGRATIONS_MASTER_KEY = defineSecret('INTEGRATIONS_MASTER_KEY');
export const testOpenMaccabi = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '1GiB',
    secrets: [
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY,
      INTEGRATIONS_MASTER_KEY,
    ],
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    try {
      console.log('Received request to testOpenMaccabi with body:', req.body);
      const schema =
        String(req.query.schema || req.body?.schema || 'bereshit_farm').trim();

      const { openMaccabiSite } = await import('./automation/maccabiAutomation');
      console.log(`Testing openMaccabiSite with schema: ${schema}`);
      const result = await openMaccabiSite(schema);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        message: error?.message ?? 'Unknown error',
      });
    }
  }
);