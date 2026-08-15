import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, firestoreRest, CustomRequest } from "../../lib/firebaseAdmin.js";
import { checkAdmin } from "../_utils.js";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    
    const { email, password, displayName, role } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Email không hợp lệ" });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
    }
    const cleanRole = (role === 'admin' || role === 'user') ? role : 'user';

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
      const signUpData: any = await signUpResponse.json();
      if (!signUpResponse.ok) throw new Error(signUpData.error?.message || "Lỗi tạo tài khoản");
      uid = signUpData.localId;
    }
    
    const userData = { uid, email, displayName: displayName || email.split('@')[0], role: cleanRole, createdAt: new Date().toISOString() };
    await firestoreRest.setDoc("users", uid, userData, req.idToken);
    
    return res.status(200).json({ success: true, uid, userData });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.error || err.message, details: err.details });
  }
}
