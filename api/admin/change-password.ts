import { getAuth } from "firebase-admin/auth";
import { getAdminApp, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    
    const { uid, newPassword, email } = req.body || {};
    if (!uid || typeof uid !== 'string') return res.status(400).json({ error: "UID không hợp lệ" });
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: "Mật khẩu mới phải từ 6 ký tự trở lên" });
    }

    const currentAdminApp = getAdminApp();
    if (currentAdminApp) {
      console.log(`[Server] Admin changing password for user ${uid} (${email})...`);
      await getAuth(currentAdminApp).updateUser(uid, { password: newPassword });
      return res.status(200).json({ success: true });
    } else {
      throw { status: 500, error: "Admin SDK chưa được cấu hình đầy đủ (Service Account)." };
    }
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.error || err.message, details: err.details });
  }
}
