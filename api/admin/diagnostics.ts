import { firebaseConfig, getAdminApp, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    await checkAdmin(req);
    
    const results: any = {
      projectId: firebaseConfig ? firebaseConfig.projectId : "unknown",
      databaseId: firebaseConfig ? firebaseConfig.firestoreDatabaseId : "unknown",
      configLoaded: !!firebaseConfig && !firebaseConfig.error,
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
      results.adminSdk.message = e.message;
    }

    return res.status(200).json(results);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.error || "Diagnostics failed", message: err.details || err.message });
  }
}
