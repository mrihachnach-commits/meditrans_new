import { 
  firebaseConfig, 
  getAdminApp, 
  getAdminFirestore,
  firestoreRest, 
} from "../lib/firebaseAdmin.js";
import admin from "firebase-admin";

// In-memory cache for verified tokens
// v10.3: giới hạn kích thước cache (tránh phình bộ nhớ) + không giữ quá hạn token
export const tokenCache = new Map();
const TOKEN_CACHE_MAX = 500;
const cacheToken = (idToken, decodedToken, now) => {
  const expMs = typeof decodedToken?.exp === "number" ? decodedToken.exp * 1000 : now + 5 * 60 * 1000;
  const expiry = Math.min(now + 5 * 60 * 1000, expMs);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    for (const [k, v] of tokenCache) {
      if (!v || v.expiry <= now) tokenCache.delete(k);
    }
    while (tokenCache.size >= TOKEN_CACHE_MAX) {
      const oldest = tokenCache.keys().next().value;
      if (oldest === undefined) break;
      tokenCache.delete(oldest);
    }
  }
  tokenCache.set(idToken, { decodedToken, expiry });
};

// v10.3: admin chính = UID cố định hoặc email chính ĐÃ XÁC MINH
export const isPrimaryAdminToken = (decodedToken) => {
  if (!decodedToken) return false;
  const email = String(decodedToken.email || "").toLowerCase();
  const verified = Boolean(decodedToken.email_verified || decodedToken.emailVerified);
  return PRIMARY_ADMIN_UIDS.includes(decodedToken.uid) || (email !== "" && verified && PRIMARY_ADMIN_EMAILS.includes(email));
};

// v10.3: tài khoản đích có phải admin chính không (tra email thật qua Admin SDK, không tin body)
export const isPrimaryAdminTarget = async (uid, emailHint) => {
  if (!uid) return false;
  if (PRIMARY_ADMIN_UIDS.includes(uid)) return true;
  if (emailHint && PRIMARY_ADMIN_EMAILS.includes(String(emailHint).toLowerCase())) return true;
  try {
    const adminApp = getAdminApp();
    if (adminApp) {
      const rec = await admin.auth(adminApp).getUser(uid);
      const email = String(rec?.email || "").toLowerCase();
      return email !== "" && PRIMARY_ADMIN_EMAILS.includes(email);
    }
  } catch (e) {
    // user-not-found → không phải admin chính
  }
  return false;
};

/**
 * v10.3: xác thực Firebase ID token (Bearer) cho mọi người dùng đã đăng nhập (không cần admin).
 * Ném { status, error } nếu thiếu / sai token.
 */
export const verifyUserToken = async (req) => {
  if (firebaseConfig.error) {
    console.error("[Server] Firebase config error:", firebaseConfig.error);
    throw { status: 500, error: "Dịch vụ chưa được cấu hình đúng." };
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { status: 401, error: "Unauthorized: Thiếu token xác thực" };
  }
  const idToken = authHeader.split("Bearer ")[1].trim();
  if (!idToken) throw { status: 401, error: "Unauthorized: Thiếu token xác thực" };
  req.idToken = idToken;
  const now = Date.now();
  const cached = tokenCache.get(idToken);
  if (cached && cached.expiry > now) {
    req.user = cached.decodedToken;
    return cached.decodedToken;
  }
  let decodedToken = null;
  const adminApp = getAdminApp();
  if (adminApp) {
    try {
      decodedToken = await admin.auth(adminApp).verifyIdToken(idToken);
    } catch (e) {
      console.warn("[Server] verifyUserToken: Admin SDK verification failed:", e.message);
    }
  }
  if (!decodedToken) {
    let verifyRes;
    let verifyData = null;
    try {
      verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      verifyData = await verifyRes.json().catch(() => null);
    } catch (e) {
      console.warn("[Server] verifyUserToken: REST lookup failed:", e.message);
      throw { status: 503, error: "Không xác thực được token (dịch vụ tạm lỗi)." };
    }
    if (verifyRes.status === 429) throw { status: 429, error: "Hệ thống đang bận (Rate Limit Exceeded)." };
    if (!verifyRes.ok || !verifyData?.users || verifyData.users.length === 0) {
      throw { status: 401, error: "Xác thực token thất bại." };
    }
    decodedToken = verifyData.users[0];
    decodedToken.uid = decodedToken.localId;
  }
  cacheToken(idToken, decodedToken, now);
  req.user = decodedToken;
  return decodedToken;
};

export const PRIMARY_ADMIN_EMAILS = ["hoanghiep1296@gmail.com", "mrihachnach@gmail.com"];
export const PRIMARY_ADMIN_UIDS = ["4cFbfQhPMpgStJXZ9EpAVcd90i33"];

export const checkAdmin = async (req) => {
  try {
    if (firebaseConfig.error) {
      console.error("[Server] Firebase config error:", firebaseConfig.error);
      throw { status: 500, error: "Dịch vụ chưa được cấu hình đúng." };
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
      
      // v10.3: JSON.parse an toàn
      const verifyData = await verifyRes.json().catch(() => ({}));
      
      if (verifyRes.status === 429) {
        throw { status: 429, error: "Hệ thống đang bận (Rate Limit Exceeded). Vui lòng đợi 1-2 phút và thử lại." };
      }

      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        throw { status: 401, error: "Xác thực token thất bại." };
      }

      decodedToken = verifyData.users[0];
      decodedToken.uid = decodedToken.localId;
    }

    // Cache the result (v10.3: cache có giới hạn)
    cacheToken(idToken, decodedToken, now);
    
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
    // v10.3: không trả chi tiết lỗi nội bộ cho client (chỉ ghi log)
    console.error("[Server] checkAdmin error:", err?.message || err);
    throw { status: 500, error: err.error || "Lỗi hệ thống" };
  }
};

/**
 * v10.3: trả lỗi cho client — chỉ thông điệp do máy chủ tự đặt (err.error), không lộ err.message / details nội bộ.
 */
export const sendApiError = (res, err, fallback = "Lỗi hệ thống") => {
  const status = Number(err?.status) || 500;
  if (!err?.status || status >= 500) {
    console.error("[Server] API error:", err?.message || err?.error || err, err?.details || "");
  }
  const msg = err?.status && typeof err?.error === "string" ? err.error : fallback;
  if (!res.headersSent) return res.status(status).json({ error: msg });
};
