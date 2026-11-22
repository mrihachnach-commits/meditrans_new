import { firestoreRest, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin, sendApiError } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    const users = await firestoreRest.listDocs("users", req.idToken);
    return res.status(200).json({ success: true, users });
  } catch (err: any) {
    // v10.3: không trả err.message thô
    return sendApiError(res, err);
  }
}
