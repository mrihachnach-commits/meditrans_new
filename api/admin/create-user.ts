import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, firestoreRest, CustomRequest } from "../../src/lib/firebaseAdmin";
import { checkAdmin } from "../_utils";

export default async function handler(req: CustomRequest, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await checkAdmin(req);
    
    const { email, password, displayName, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });

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
    
    const userData = { uid, email, displayName: displayName || email.split('@')[0], role: role || "user", createdAt: new Date().toISOString() };
    await firestoreRest.setDoc("users", uid, userData, req.idToken);
    
    return res.status(200).json({ success: true, uid, userData });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.error || err.message, details: err.details });
  }
}
