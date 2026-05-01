import admin from "firebase-admin";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

import { Request } from "express";

// Extend Express Request interface to include custom properties
export interface CustomRequest extends Request {
  user?: any;
  idToken?: string;
}

// Load firebase config
let firebaseConfig: any = {};
try {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const rawConfig = fs.readFileSync(configPath, "utf8");
    firebaseConfig = JSON.parse(rawConfig);
    console.log("[Config] Loaded from file system at", configPath);
  } else {
    console.warn("[Config] firebase-applet-config.json not found at cwd, trying import fallback");
    // We avoid dynamic imports here for simplicity in serverless
    firebaseConfig = { error: "Configuration missing" };
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

export { firebaseConfig };

let adminApp: any = null;
export function getAdminApp() {
  if (adminApp) return adminApp;
  
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  
  const projectId = projectIdEnv || firebaseConfig.projectId;

  if (projectId) {
    try {
      if (admin.apps.length === 0) {
        if (clientEmail && privateKey) {
          adminApp = admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
            projectId
          });
          console.log(`[Firebase Admin] Initialized with Service Account for project: ${projectId}`);
        } else {
          adminApp = admin.initializeApp({ 
            projectId: projectId 
          });
          console.warn(`[Firebase Admin] Initialized with Project ID ONLY (No Service Account) for: ${projectId}. Administrative tasks may fail.`);
        }
      } else {
        adminApp = admin.apps[0];
      }
      return adminApp;
    } catch (e: any) {
      console.error("[Firebase Admin] Initialization failed:", e.message);
      return null;
    }
  }
  
  console.error("[Firebase Admin] Cannot initialize: No Project ID found in environment or config.");
  return null;
}

export { getAdminFirestore };

// Initialize Firestore Helper using REST API
export const firestoreRest = {
  getDoc: async (collection: string, docId: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { headers });
    if (res.status === 404) return { exists: false };
    
    const resText = await res.text();
    if (!res.ok) {
      let errorMessage = "Firestore REST error";
      try {
        const error = JSON.parse(resText);
        errorMessage = error.error?.message || errorMessage;
      } catch (pe) {
        errorMessage = resText.substring(0, 200);
      }
      throw new Error(errorMessage);
    }
    
    try {
      const data = JSON.parse(resText);
      return { exists: true, data: parseFirestoreFields(data.fields) };
    } catch (e) {
      throw new Error("Invalid response from Firestore: " + resText.substring(0, 100));
    }
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
    
    const resText = await res.text();
    if (!res.ok) {
      let errorMessage = "Firestore REST error";
      try {
        const error = JSON.parse(resText);
        errorMessage = error.error?.message || errorMessage;
      } catch (pe) {
        errorMessage = resText.substring(0, 200);
      }
      throw new Error(errorMessage);
    }
    return JSON.parse(resText);
  },

  deleteDoc: async (collection: string, docId: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const resText = await res.text();
      let errorMessage = "Firestore REST error";
      try {
        const error = JSON.parse(resText);
        errorMessage = error.error?.message || errorMessage;
      } catch (pe) {
        errorMessage = resText.substring(0, 200);
      }
      throw new Error(errorMessage);
    }
    return true;
  },

  listDocs: async (collection: string, idToken?: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { headers });
    const resText = await res.text();
    
    if (!res.ok) {
      let errorMessage = `Firestore REST error (Status ${res.status})`;
      try {
        const error = JSON.parse(resText);
        errorMessage = error.error?.message || errorMessage;
      } catch (pe) {
        errorMessage = resText.substring(0, 200);
      }
      throw new Error(errorMessage);
    }
    
    try {
      const data = JSON.parse(resText);
      return (data.documents || []).map((doc: any) => ({
        id: doc.name.split('/').pop(),
        ...parseFirestoreFields(doc.fields)
      }));
    } catch (e) {
      throw new Error("Invalid response from Firestore list: " + resText.substring(0, 100));
    }
  }
};

// Helper to parse Firestore REST fields
export function parseFirestoreFields(fields: any) {
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
export function encodeFirestoreFields(data: any) {
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
