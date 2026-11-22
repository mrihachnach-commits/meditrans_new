import { firebaseConfig, getAdminApp, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin, sendApiError } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    await checkAdmin(req);
    
    const results: any = {
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      configLoaded: !firebaseConfig.error,
      adminSdk: { status: "unknown" },
      env: {
        VERCEL: process.env.VERCEL || "0",
        HAS_ADMIN_KEYS: !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
      }
    };

    try {
      const adminApp = getAdminApp();
      if (adminApp) {
        results.adminSdk.status = "ok";
      } else {
        results.adminSdk.status = "error";
      }
    } catch (e: any) {
      results.adminSdk.status = "error";
      // v10.3: chỉ ghi log, không trả chi tiết
      console.error("[diagnostics] Admin SDK error:", e?.message);
    }

    return res.status(200).json(results);
  } catch (err: any) {
    // v10.3: không trả err.message thô
    return sendApiError(res, err, "Diagnostics failed");
  }
}
