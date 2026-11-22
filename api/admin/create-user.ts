import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, firestoreRest, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin, sendApiError } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    
    const { email, password, displayName, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    // v10.3: kiểm tra kiểu dữ liệu đầu vào
    if (typeof email !== "string" || typeof password !== "string" || (displayName != null && typeof displayName !== "string")) {
      return res.status(400).json({ error: "Dữ liệu không hợp lệ" });
    }

    let uid = "";
    try {
      const currentAdminApp = getAdminApp();
      if (!currentAdminApp) throw new Error("Admin SDK not initialized");
      const userRecord = await admin.auth(currentAdminApp).createUser({ 
        email, 
        password, 
        displayName: displayName || email.split('@')[0], 
        emailVerified: true 
      });
      uid = userRecord.uid;
    } catch (e) {
      const signUpResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName: displayName || email.split('@')[0], returnSecureToken: true })
      });
      // v10.3: JSON.parse an toàn
      const signUpData: any = await signUpResponse.json().catch(() => ({}));
      if (!signUpResponse.ok) {
        // v10.3: chỉ trả mã lỗi Firebase dạng hằng (VD EMAIL_EXISTS), không trả chuỗi thô
        const code = String(signUpData?.error?.message || "").match(/^[A-Z_]+/)?.[0];
        throw { status: 400, error: code ? `Lỗi tạo tài khoản: ${code}` : "Lỗi tạo tài khoản" };
      }
      uid = signUpData.localId;
    }
    
    // v10.3: role chỉ nhận 'user' | 'admin'
    const userData = { uid, email, displayName: displayName || email.split('@')[0], role: role === "admin" ? "admin" : "user", createdAt: new Date().toISOString() };
    await firestoreRest.setDoc("users", uid, userData, req.idToken);
    
    return res.status(200).json({ success: true, uid, userData });
  } catch (err: any) {
    // v10.3: không trả err.message thô
    return sendApiError(res, err);
  }
}
