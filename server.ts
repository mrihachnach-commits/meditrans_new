import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import multer from "multer";

// Load firebase config
let firebaseConfig: any = {};
try {
  // Use a safer path resolution for Vercel
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const rawConfig = fs.readFileSync(configPath, "utf8");
    firebaseConfig = JSON.parse(rawConfig);
    console.log("[Config] Loaded from file system at", configPath);
  } else {
    // Try to find it in other locations
    console.warn("[Config] firebase-applet-config.json not found at cwd, trying import fallback");
    try {
       // This handles the bundling if Vite included it
       const configImport = await import("./firebase-applet-config.json", { 
         assert: { type: "json" } 
       }).catch(() => import("./firebase-applet-config.json"));
       firebaseConfig = configImport.default || configImport;
       console.log("[Config] Loaded via fallback import");
    } catch (importErr) {
       console.error("[Config] All loading methods failed");
       firebaseConfig = { error: "Configuration missing" };
    }
  }
} catch (err: any) {
  console.error("[Config] Critical error during load:", err.message);
  firebaseConfig = { error: err.message };
}

// Allow override from environment variable if provided
if (process.env.FIREBASE_CONFIG_JSON) {
  try {
    const envConfig = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
    firebaseConfig = { ...firebaseConfig, ...envConfig };
    console.log("Applied FIREBASE_CONFIG_JSON from environment");
  } catch (err) {
    console.error("Failed to parse FIREBASE_CONFIG_JSON:", err);
  }
}

// Set environment variables for firebase-admin
if (firebaseConfig.projectId) {
  process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;
}

// Initialize Firebase Admin (for token verification and administrative tasks)
// We keep this lazy to avoid startup issues on Vercel
let adminApp: any = null;
function getAdminApp() {
  if (adminApp) return adminApp;
  if (firebaseConfig && firebaseConfig.projectId && !firebaseConfig.error) {
    try {
      if (admin.apps.length === 0) {
        adminApp = admin.initializeApp({ 
          projectId: firebaseConfig.projectId 
        });
        console.log(`[Firebase Admin] Lazy-initialized for project: ${firebaseConfig.projectId}`);
      } else {
        adminApp = admin.apps[0];
      }
      return adminApp;
    } catch (e: any) {
      console.error("[Firebase Admin] Lazy-initialization failed:", e.message);
      return null;
    }
  }
  return null;
}

// Initialize Firestore Helper using REST API
const firestoreRest = {
  getDoc: async (collection: string, docId: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { headers });
    if (res.status === 404) return { exists: false };
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || "Firestore REST error");
    }
    const data = await res.json();
    return { exists: true, data: parseFirestoreFields(data.fields) };
  },
  
  setDoc: async (collection: string, docId: string, data: any, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const body = { fields: encodeFirestoreFields(data) };
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || "Firestore REST error");
    }
    return await res.json();
  },

  deleteDoc: async (collection: string, docId: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const error = await res.json();
      throw new Error(error.error?.message || "Firestore REST error");
    }
    return true;
  },

  listDocs: async (collection: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    console.log(`[Firestore REST] Listing ${collection} from ${url}`);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const error = await res.json();
      console.error(`[Firestore REST] List failed:`, JSON.stringify(error));
      throw new Error(error.error?.message || "Firestore REST error");
    }
    const data = await res.json();
    return (data.documents || []).map((doc: any) => ({
      id: doc.name.split('/').pop(),
      ...parseFirestoreFields(doc.fields)
    }));
  }
};

  // Helper to parse Firestore REST fields
  function parseFirestoreFields(fields: any) {
    if (!fields) return {};
    const result: any = {};
    try {
      for (const key in fields) {
        const valueObj = fields[key];
        if (!valueObj) continue;
        
        if ('stringValue' in valueObj) result[key] = valueObj.stringValue;
        else if ('integerValue' in valueObj) result[key] = parseInt(valueObj.integerValue);
        else if ('doubleValue' in valueObj) result[key] = valueObj.doubleValue;
        else if ('booleanValue' in valueObj) result[key] = valueObj.booleanValue;
        else if ('timestampValue' in valueObj) result[key] = valueObj.timestampValue;
        else if ('mapValue' in valueObj && valueObj.mapValue.fields) result[key] = parseFirestoreFields(valueObj.mapValue.fields);
        else if ('arrayValue' in valueObj) {
          result[key] = (valueObj.arrayValue.values || []).map((v: any) => {
            const temp = parseFirestoreFields({ temp: v });
            return temp.temp;
          });
        }
      }
    } catch (e) {
      console.warn("Error parsing Firestore fields:", e);
    }
    return result;
  }

// Helper to encode Firestore REST fields
function encodeFirestoreFields(data: any) {
  const fields: any = {};
  for (const key in data) {
    const val = data[key];
    if (typeof val === 'string') fields[key] = { stringValue: val };
    else if (typeof val === 'number') {
      if (Number.isInteger(val)) fields[key] = { integerValue: val.toString() };
      else fields[key] = { doubleValue: val };
    }
    else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
    else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
    else if (Array.isArray(val)) {
      fields[key] = { arrayValue: { values: val.map(v => encodeFirestoreFields({ temp: v }).temp) } };
    }
    else if (typeof val === 'object' && val !== null) {
      fields[key] = { mapValue: { fields: encodeFirestoreFields(val) } };
    }
  }
  return fields;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Simple ping endpoint for health checks
  app.get("/api/ping", (req, res) => {
    res.json({ 
      status: "alive", 
      time: new Date().toISOString(),
      env: process.env.NODE_ENV,
      vercel: process.env.VERCEL || "0"
    });
  });

   // Middleware to check if user is admin
   const checkAdmin = async (req: any, res: any, next: any) => {
     if (firebaseConfig.error) {
       console.error("[Admin Check] Configuration error:", firebaseConfig.error);
       return res.status(500).json({ 
         error: "Dịch vụ chưa được cấu hình đúng.", 
         details: firebaseConfig.error 
       });
     }

     if (!firebaseConfig.apiKey) {
       console.error("[Admin Check] API Key is missing from config");
       return res.status(500).json({ 
         error: "Thiếu Firebase API Key trong cấu hình." 
       });
     }

     const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[Admin Check] Missing or invalid authorization header");
      return res.status(401).json({ error: "Unauthorized: Missing token" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken === "null" || idToken === "undefined") {
      console.warn("[Admin Check] Token itself is null or undefined");
      return res.status(401).json({ error: "Invalid token: Token is missing or null" });
    }

    try {
      if (!firebaseConfig.apiKey) {
         throw new Error("Dịch vụ chưa được cấu hình đúng: Thiếu API Key.");
      }

      // 1. Verify token using REST API (Always works with client API Key)
      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      
      let verifyData: any;
      const text = await verifyRes.text();
      try {
        verifyData = JSON.parse(text);
      } catch (e) {
        console.error("[Admin Check] Failed to parse verification response:", text);
        return res.status(500).json({ error: "Dịch vụ xác thực phản hồi không hợp lệ." });
      }
      
      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        return res.status(401).json({ error: verifyData.error?.message || "Xác thực token thất bại." });
      }

      const decodedToken = verifyData.users[0];
      decodedToken.uid = decodedToken.localId;
      const userEmail = (decodedToken.email || "").toLowerCase();
      
      // 2. Immediate Admin check for Primary Admins (NO DB REQUIRED)
      const isPrimaryAdmin = userEmail === "hoanghiep1296@gmail.com" || 
                             userEmail === "mrihachnach@gmail.com" || 
                             userEmail === "admin@gmail.com" ||
                             userEmail === "hoctap853@gmail.com";

      if (isPrimaryAdmin) {
        console.log(`[Admin Check] Primary admin verified: ${userEmail}`);
        req.user = decodedToken;
        return next();
      }

      // 3. Database Role Check for non-primary admins
      let userData: any = null;
      
      // Try REST first as it's more predictable on Vercel
      try {
        const restUser = await firestoreRest.getDoc("users", decodedToken.uid, idToken);
        if (restUser.exists) {
          userData = restUser.data;
          console.log(`[Admin Check] User role from REST: ${userData?.role}`);
        }
      } catch (restErr: any) {
        console.warn(`[Admin Check] REST Fetch failed: ${restErr.message}`);
        
        // Fallback to Admin SDK ONLY if REST failed
        try {
          const currentAdminApp = getAdminApp();
          if (currentAdminApp) {
            const db = getAdminFirestore(currentAdminApp, firebaseConfig.firestoreDatabaseId);
            const userDoc = await db.collection("users").doc(decodedToken.uid).get();
            if (userDoc.exists) {
              userData = userDoc.data();
              console.log(`[Admin Check] User role from Admin SDK: ${userData?.role}`);
            }
          }
        } catch (adminErr: any) {
          console.error(`[Admin Check] Admin SDK Check failed: ${adminErr.message}`);
        }
      }

      if (userData?.role === "admin") {
        req.user = decodedToken;
        return next();
      }

      console.log(`[Admin Check] Access denied for ${userEmail}`);
      return res.status(403).json({ error: "Tài khoản của bạn không có quyền truy cập quản trị." });

    } catch (error: any) {
      console.error("Admin check critical failure:", error);
      res.status(500).json({ error: "Lỗi hệ thống khi kiểm tra quyền: " + error.message });
    }
  };

  // Diagnostic Endpoint
  app.get("/api/admin/diagnostics", checkAdmin, async (req, res) => {
    try {
      const idToken = req.headers.authorization!.split("Bearer ")[1];
      const results: any = {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        auth: { status: "unknown" },
        firestore: { status: "unknown" },
        env: {
          GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
          NODE_ENV: process.env.NODE_ENV,
          VERCEL: process.env.VERCEL
        }
      };

      try {
        // Test Auth REST API
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
        if (verifyRes.ok) {
          results.auth.status = "ok";
        } else {
          results.auth.status = "error";
          try {
            const errBody = await verifyRes.json();
            results.auth.message = errBody.error?.message;
          } catch (pe) {
            results.auth.message = "Non-JSON error from Auth API";
          }
        }
      } catch (e: any) {
        results.auth.status = "error";
        results.auth.message = e.message;
      }

    try {
      // Test Firestore REST API
      await firestoreRest.getDoc("test_connection", "diagnostic", idToken);
      results.firestore.status = "ok";
    } catch (e: any) {
      results.firestore.status = "error";
      results.firestore.message = e.message;
    }

    res.json(results);
    } catch (err: any) {
      console.error("[Diagnostics] Failed:", err);
      res.status(500).json({ error: "Diagnostics failed", details: err.message });
    }
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global Server Error:", err);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: err.message,
      path: req.url 
    });
  });

  // Proxy TinyVault Upload
  app.post("/api/tinyvault", async (req, res) => {
    try {
      const upload = multer({ 
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
      });

      upload.single("file")(req as any, res as any, async (err) => {
        const request = req as any;
        if (err) {
          console.error("Multer error:", err);
          return res.status(500).json({ error: "Lỗi xử lý tệp tin: " + err.message });
        }
        if (!request.file) return res.status(400).json({ error: "Không có tệp tin nào được tải lên" });

        const formData = new FormData();
        formData.append("file", request.file.buffer, {
          filename: request.file.originalname,
          contentType: request.file.mimetype,
        });

        try {
          const response = await axios.post("https://tinyvault.space/api/upload", formData, {
            headers: { ...formData.getHeaders() },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000 // 60 seconds timeout
          });
          res.json(response.data);
        } catch (axiosError: any) {
          console.error("TinyVault API error:", axiosError.response?.data || axiosError.message);
          res.status(axiosError.response?.status || 500).json({ 
            error: "Lỗi từ máy chủ TinyVault", 
            details: axiosError.response?.data || axiosError.message 
          });
        }
      });
    } catch (error: any) {
      console.error("Proxy internal error:", error);
      res.status(500).json({ error: "Lỗi hệ thống nội bộ: " + error.message });
    }
  });

  // API Routes
  
  // Admin: Create User
  app.post("/api/admin/create-user", checkAdmin, async (req, res) => {
    const { email, password, displayName, role } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }

    try {
      let uid: string = "";
      let authMethod = "admin-sdk";

      // 1. Attempt to create user in Firebase Auth via Admin SDK first
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
        console.log(`[Admin] Successfully created user via Admin SDK: ${uid}`);
      } catch (adminError: any) {
        console.warn("[Admin] Admin SDK user creation failed, trying REST signup:", adminError.message);
        
        // 2. Fallback to Identity Toolkit REST API
        authMethod = "rest-signup";
        if (!firebaseConfig.apiKey) throw new Error("Thiếu Firebase API Key.");

        const signUpResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            displayName: displayName || email.split('@')[0],
            returnSecureToken: true
          })
        });

        const signUpData: any = await signUpResponse.json();
        if (!signUpResponse.ok) {
          const msg = signUpData.error?.message;
          if (msg === 'EMAIL_EXISTS') throw new Error("Email này đã được sử dụng.");
          throw new Error(msg || "Lỗi khi tạo tài khoản");
        }
        uid = signUpData.localId;
      }
      
      // 3. Create user document in Firestore
      const userData = {
        uid,
        email,
        displayName: displayName || email.split('@')[0],
        role: role || "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let dbSuccess = false;
      const authHeader = req.headers.authorization;
      const adminToken = authHeader ? authHeader.split("Bearer ")[1] : undefined;

      try {
        // Try REST first using the admin's token
        if (adminToken) {
          await firestoreRest.setDoc("users", uid, userData, adminToken);
          dbSuccess = true;
        } else {
          // Try Admin SDK fallback
          const currentAdminApp = getAdminApp();
          if (currentAdminApp) {
            const db = getAdminFirestore(currentAdminApp, firebaseConfig.firestoreDatabaseId);
            await db.collection("users").doc(uid).set(userData);
            dbSuccess = true;
          }
        }
      } catch (dbError: any) {
        console.warn("[Admin] Firestore update failed during creation:", dbError.message);
      }
      
      return res.json({ 
        success: true, 
        uid, 
        dbSuccess,
        authMethod,
        userData
      });
    } catch (error: any) {
      console.error("[Admin] Error creating user:", error);
      res.status(500).json({ error: error.message || "Lỗi không xác định khi tạo người dùng" });
    }
  });

  // Admin: List Users (Source from Firestore only to avoid project mismatch)
  app.get("/api/admin/list-users", checkAdmin, async (req, res) => {
    try {
      // 1. Try Admin SDK first (fastest, bypasses rules if configured)
      try {
        const currentAdminApp = getAdminApp();
        if (currentAdminApp) {
          const db = getAdminFirestore(currentAdminApp, firebaseConfig.firestoreDatabaseId);
          const usersSnapshot = await db.collection("users").get();
          const users = usersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...(doc.data() as any)
          }));
          
          return res.json({ 
            success: true, 
            users,
            projectId: firebaseConfig.projectId,
            databaseId: firebaseConfig.firestoreDatabaseId,
            source: "admin-sdk"
          });
        }
      } catch (adminError: any) {
        console.warn("[Admin] Admin SDK list-users failed (likely permission denied on Vercel), falling back to REST API.");
      }
      
      // 2. Fallback to REST API using the admin's token
      // This works because the admin's token HAS list permissions in security rules
      const authHeader = req.headers.authorization;
      if (!authHeader) throw new Error("Missing auth header for fallback");
      const idToken = authHeader.split("Bearer ")[1];
      
      try {
        const users = await firestoreRest.listDocs("users", idToken);
        return res.json({ 
          success: true, 
          users,
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          source: "rest-api"
        });
      } catch (restErr: any) {
        console.error("[Admin] REST list-users failed:", restErr.message);
        throw restErr;
      }
    } catch (error: any) {
      console.error("[Admin] List users final failure:", error.message);
      res.status(500).json({ error: "Không thể lấy danh sách người dùng: " + error.message });
    }
  });

  // Admin: Reset Password (Soft Reset - Notify user to use email reset)
  app.post("/api/admin/reset-password", checkAdmin, async (req, res) => {
    res.status(400).json({ 
      error: "Tính năng đặt mật khẩu trực tiếp bị hạn chế bởi Firebase.",
      details: "Để bảo mật, vui lòng sử dụng nút 'Gửi email đặt lại mật khẩu' để người dùng tự đặt mật khẩu mới."
    });
  });

  // Admin: Delete User (Soft Delete + Firestore Cleanup)
  app.post("/api/admin/delete-user", checkAdmin, async (req, res) => {
    const { uid, email } = req.body;
    const idToken = req.headers.authorization.split("Bearer ")[1];
    let authDeleted = false;
    let authError = null;

    try {
      // 1. Attempt to delete from Firebase Authentication using Admin SDK
      try {
        const currentAdminApp = getAdminApp();
        if (!currentAdminApp) throw new Error("Admin SDK not initialized");
        await admin.auth(currentAdminApp).deleteUser(uid);
        authDeleted = true;
        console.log(`[Admin] Successfully deleted User Auth: ${uid}`);
      } catch (ae: any) {
        console.warn(`[Admin] Admin SDK Auth delete failed for ${uid}:`, ae.message);
        authError = ae.message;
        
        /**
         * EXPLANATION FOR USER:
         * You can ADD users but not DELETE them because:
         * 1. ADDING: Uses a Public API (SignUp) which only needs an API Key.
         * 2. DELETING: Uses a Restricted Administrative API that requires 
         *    'Identity Toolkit API' to be ENABLED in your project settings.
         */
        if (ae.message?.includes('identitytoolkit.googleapis.com') || ae.code === 'auth/internal-error') {
          authError = "Identity Toolkit API chưa được kích hoạt. Bạn có thể THÊM người dùng vì đó là tính năng công khai, " +
                     "nhưng để XÓA người dùng (tính năng quản trị), bạn PHẢI kích hoạt API này trong Console.";
        }
      }

      // 2. Delete Firestore document
      const currentAdminApp = getAdminApp();
      if (currentAdminApp) {
        const db = getAdminFirestore(currentAdminApp, firebaseConfig.firestoreDatabaseId);
        await db.collection("users").doc(uid).delete();
        
        // 3. Add to blacklist to prevent re-registration or access if Auth delete failed
        if (email) {
          await db.collection("blacklist").doc(email.toLowerCase()).set({
            email: email.toLowerCase(),
            uid: uid,
            reason: "Deleted by admin",
            authDeleted,
            createdAt: new Date().toISOString()
          });
        }
      } else {
        // Fallback to REST for deletion if possible
        const idToken = req.headers.authorization.split("Bearer ")[1];
        await firestoreRest.deleteDoc("users", uid, idToken);
        if (email) {
          await firestoreRest.setDoc("blacklist", email.toLowerCase(), {
            email: email.toLowerCase(),
            uid: uid,
            reason: "Deleted by admin",
            authDeleted,
            createdAt: new Date().toISOString()
          }, idToken);
        }
      }
      
      res.json({ 
        success: true, 
        authDeleted,
        authError,
        message: authDeleted 
          ? "Đã xóa tài khoản khỏi hệ thống và xóa dữ liệu thành công." 
          : "Đã xóa dữ liệu và chặn truy cập (Xóa Auth thất bại: " + authError + ")"
      });
    } catch (error: any) {
      console.error("[Admin] Error in delete-user route:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== '1') {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // API 404 handler to prevent returning index.html for missing API routes
    app.use("/api/*", (req, res) => {
      res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
    });

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not running in a serverless environment (like Vercel)
  const isServerless = process.env.VERCEL === '1' || process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME;
  
  if (!isServerless) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } else {
    console.log("Running in serverless environment, skipping app.listen()");
  }

  return app;
}

const serverPromise = startServer();

export default async (req: any, res: any) => {
  // Add a quick check for ping without waiting for the full server promise if possible
  if (req.url === "/api/ping") {
     res.setHeader('Content-Type', 'application/json');
     return res.end(JSON.stringify({ status: "alive (pree-flight)", vercel: "1" }));
  }

  try {
    const app = await serverPromise;
    
    // Check if configuration failed during initialization
    if (firebaseConfig.error) {
      console.error("Serverless handler invoked but config is invalid:", firebaseConfig.error);
      if (req.url && req.url.startsWith("/api/")) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).end(JSON.stringify({ 
          error: "Server configuration error", 
          details: firebaseConfig.error,
          env: process.env.NODE_ENV,
          vercel: process.env.VERCEL
        }));
      }
    }
    
    // Express apps are functions that take (req, res)
    return app(req, res);
  } catch (error: any) {
    console.error("Vercel serverless function crashed:", error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).end(JSON.stringify({ 
      error: "Critical Server Error", 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      type: error.name
    }));
  }
};
