import { 
  firebaseConfig, 
  getAdminApp, 
  getAdminFirestore,
  firestoreRest, 
} from "../lib/firebaseAdmin.js";
import admin from "firebase-admin";

// In-memory cache for verified tokens
export const tokenCache = new Map();

export const PRIMARY_ADMIN_EMAILS = ["hoanghiep1296@gmail.com", "mrihachnach@gmail.com"];
export const PRIMARY_ADMIN_UIDS = ["4cFbfQhPMpgStJXZ9EpAVcd90i33"];

export const checkAdmin = async (req) => {
  try {
    if (firebaseConfig.error) {
      console.error("[Server] Firebase config error:", firebaseConfig.error);
      throw { status: 500, error: "Dịch vụ chưa được cấu hình đúng.", details: firebaseConfig.error };
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[Server] checkAdmin: Missing auth header");
      throw { status: 401, error: "Unauthorized: Thiếu token xác thực" };
    }

    const idToken = authHeader.split("Bearer ")[1].trim();
    req.idToken = idToken;

    // Check cache first
    const now = Date.now();
    const cached = tokenCache.get(idToken);
    if (cached && cached.expiry > now) {
      console.log("[Server] checkAdmin: Using cached token info");
      const decodedToken = cached.decodedToken;
      const userEmail = (decodedToken.email || "").toLowerCase();
      const userUid = decodedToken.uid;
      const isEmailVerified = Boolean(decodedToken.email_verified || decodedToken.emailVerified);
      
      const isPrimaryAdmin = (userEmail !== "" && PRIMARY_ADMIN_EMAILS.includes(userEmail) && isEmailVerified) || (PRIMARY_ADMIN_UIDS.includes(userUid));
      if (isPrimaryAdmin) {
        req.user = decodedToken;
        return decodedToken;
      }

      // Check role in DB
      let roleIsAdmin = false;
      const adminApp = getAdminApp();
      if (adminApp && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        try {
          const dbId = firebaseConfig.firestoreDatabaseId || 'ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b';
          const adminDb = getAdminFirestore(adminApp, dbId);
          const snap = await adminDb.collection("users").doc(userUid).get();
          if (snap.exists && snap.data()?.role === "admin") {
            roleIsAdmin = true;
          }
        } catch (e) {
          console.warn("[checkAdmin cache] Admin Firestore lookup error:", e.message);
        }
      }
      if (!roleIsAdmin) {
        const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
        if (userDoc.exists && userDoc.data.role === "admin") {
          roleIsAdmin = true;
        }
      }

      if (roleIsAdmin) {
        req.user = decodedToken;
        return decodedToken;
      }
      throw { status: 403, error: "Bạn không có quyền quản trị (Admin)" };
    }

    let decodedToken = null;
    const adminApp = getAdminApp();

    if (adminApp) {
      try {
        console.log("[Server] checkAdmin: Verifying ID token via Admin SDK...");
        decodedToken = await admin.auth(adminApp).verifyIdToken(idToken);
      } catch (e) {
        console.warn("[Server] checkAdmin: Admin SDK verification failed, falling back to REST API:", e.message);
      }
    }

    if (!decodedToken) {
      console.log("[Server] checkAdmin: Verifying ID token via Identity Toolkit REST API...");
      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      
      const verifyData = await verifyRes.json();
      
      if (verifyRes.status === 429) {
        throw { status: 429, error: "Hệ thống đang bận (Rate Limit Exceeded).", details: "Vui lòng đợi 1-2 phút và thử lại." };
      }

      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        throw { status: 401, error: "Xác thực token thất bại." };
      }

      decodedToken = verifyData.users[0];
      decodedToken.uid = decodedToken.localId;
    }

    // Cache the result
    tokenCache.set(idToken, { decodedToken, expiry: now + 5 * 60 * 1000 });
    
    const userEmail = (decodedToken.email || "").toLowerCase();
    const userUid = decodedToken.uid;
    const isEmailVerified = Boolean(decodedToken.email_verified || decodedToken.emailVerified);
    
    const isPrimaryAdmin = (userEmail !== "" && PRIMARY_ADMIN_EMAILS.includes(userEmail) && isEmailVerified) || (PRIMARY_ADMIN_UIDS.includes(userUid));
    if (isPrimaryAdmin) {
      req.user = decodedToken;
      return decodedToken;
    }

    let roleIsAdmin = false;
    if (adminApp && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      try {
        const dbId = firebaseConfig.firestoreDatabaseId || 'ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b';
        const adminDb = getAdminFirestore(adminApp, dbId);
        const snap = await adminDb.collection("users").doc(userUid).get();
        if (snap.exists && snap.data()?.role === "admin") {
          roleIsAdmin = true;
        }
      } catch (e) {
        console.warn("[checkAdmin] Admin Firestore lookup error:", e.message);
      }
    }
    if (!roleIsAdmin) {
      const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
      if (userDoc.exists && userDoc.data.role === "admin") {
        roleIsAdmin = true;
      }
    }

    if (roleIsAdmin) {
      req.user = decodedToken;
      return decodedToken;
    }
    throw { status: 403, error: "Bạn không có quyền quản trị (Admin)" };
  } catch (err) {
    if (err.status) throw err;
    throw { status: 500, error: err.error || "Lỗi hệ thống", details: err.message || err.details };
  }
};
