/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from 'firebase-functions/v2';

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

export { connectClalitForFarm } from './connectClalitForFarm';

export { createHostedPaymentUrl, tranzilaHandshake , recordOneTimePayment , savePaymentMethod ,chargeSelectedChargesForParent } from './tranzila.js';
export {
  ensureTranzilaInvoiceForPayment
} from './tranzilaInvoices.js';
export { sendEmailGmail } from './email';

//export  *  from "../createParent.js";

export {autoRejectRequestAndNotify} from './auto-reject-and-notify'; 
export { approveRemoveChildAndNotify } from './approve-remove-child-and-notify';
export { notifySeriesApproved } from './notifySeriesApproved';
export { notifySeriesRejected } from './notifySeriesRejected';
export { rejectRemoveChildAndNotify } from './rejectRemoveChildAndNotify';
export { notifyUser } from './notifyUser';
export { approveMakeupLessonAndNotify } from './approveMakeupLessonAndNotify';
export { rejectMakeupLessonAndNotify } from './rejectMakeupLessonAndNotify';
export { approveFillInAndNotify } from './approveFillInAndNotify';
export { rejectFillInAndNotify } from './rejectFillInAndNotify';
export {approveCancelOccurrenceAndNotify} from './approveCancelOccurrenceAndNotify'
export {rejectCancelOccurrenceAndNotify} from './rejectCancelOccurrenceAndNotify'
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
