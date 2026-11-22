import { getAuth } from "firebase-admin/auth";
import { getAdminApp, firestoreRest, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin, isPrimaryAdminToken, isPrimaryAdminTarget, sendApiError } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const caller = await checkAdmin(req);
    
    const { uid, email } = req.body || {};
    // v10.3: kiểm tra đầu vào
    if (!uid || typeof uid !== "string") return res.status(400).json({ error: "Thiếu UID người dùng." });
    // v10.3: chỉ admin chính mới được xóa admin chính
    if (!isPrimaryAdminToken(caller) && await isPrimaryAdminTarget(uid, email)) {
      return res.status(403).json({ error: "Không được xóa tài khoản quản trị viên chính." });
    }
    console.log(`[Server] Admin delete-user request for ${email} (${uid})`);
    
    let authDeleted = false;
    const currentAdminApp = getAdminApp();
    
    if (currentAdminApp) {
      try {
        console.log(`[Server] Deleting user ${uid} from Firebase Auth...`);
        await getAuth(currentAdminApp).deleteUser(uid);
        console.log(`[Server] User ${uid} deleted from Firebase Auth.`);
        authDeleted = true;
      } catch (ae: any) {
        console.error(`[Server] Error deleting user from Auth: ${ae.message}`);
        if (ae.code === 'auth/user-not-found') {
          authDeleted = true; 
        } else {
          // v10.3: không trả ae.message thô
          throw { status: 500, error: "Lỗi xóa tài khoản khỏi Authentication." };
        }
      }
    } else {
      throw { status: 500, error: "Admin SDK chưa được cấu hình đầy đủ (Service Account)." };
    }
    
    await firestoreRest.deleteDoc("users", uid, req.idToken);
    
    if (email && typeof email === "string") {
      await firestoreRest.setDoc("blacklist", email.toLowerCase(), {
        email: email.toLowerCase(),
        uid: uid,
        reason: "Deleted by admin",
        createdAt: new Date().toISOString()
      }, req.idToken);
    }
    
    return res.status(200).json({ success: true, authDeleted });
  } catch (err: any) {
    // v10.3: không trả err.message thô
    return sendApiError(res, err);
  }
}
