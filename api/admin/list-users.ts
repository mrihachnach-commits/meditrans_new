import { firestoreRest, CustomRequest } from "../../src/lib/firebaseAdmin";
import { checkAdmin } from "../_utils";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    const users = await firestoreRest.listDocs("users", req.idToken);
    return res.status(200).json({ success: true, users });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.error || err.message, details: err.details });
  }
}
