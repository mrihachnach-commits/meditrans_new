import { getAuth } from "firebase-admin/auth";
import { getAdminApp, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin, isPrimaryAdminToken, isPrimaryAdminTarget, sendApiError } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const caller = await checkAdmin(req);
    
    const { uid, newPassword, email } = req.body || {};
    if (!uid || !newPassword) return res.status(400).json({ error: "UID và mật khẩu mới là bắt buộc" });
    // v10.3: kiểm tra kiểu / độ dài mật khẩu
    if (typeof uid !== "string" || typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 128) {
      return res.status(400).json({ error: "Mật khẩu mới phải từ 6 đến 128 ký tự." });
    }
    // v10.3: chỉ admin chính mới được đổi mật khẩu của admin chính
    if (!isPrimaryAdminToken(caller) && await isPrimaryAdminTarget(uid, email)) {
      return res.status(403).json({ error: "Không được đổi mật khẩu của quản trị viên chính." });
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
    // v10.3: không trả err.message thô
    return sendApiError(res, err);
  }
}
