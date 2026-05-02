import admin from "firebase-admin";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

// Load Firebase configuration
let serviceAccount = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (error) {
  console.error("[Firebase Admin] Error parsing FIREBASE_SERVICE_ACCOUNT:", error);
}

const firebaseConfig = {
  projectId: serviceAccount ? serviceAccount.project_id : process.env.FIREBASE_PROJECT_ID,
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || "(default)"
};

export { firebaseConfig };

export function getAdminApp() {
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  if (!serviceAccount) {
    console.error("[Firebase Admin] Cannot initialize: FIREBASE_SERVICE_ACCOUNT missing or invalid");
    throw new Error("FIREBASE_SERVICE_ACCOUNT is required");
  }

  console.log("[Firebase Admin] Using ENV service account");
  const adminApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("[Firebase Admin] apps length:", admin.apps.length);
  return adminApp;
}

export { getAdminFirestore };

// Initialize Firestore Helper using REST API
export const firestoreRest = {
  getDoc: async (collection, docId, idToken) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers = { 'Content-Type': 'application/json' };
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
  
  setDoc: async (collection, docId, data, idToken) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers = { 'Content-Type': 'application/json' };
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

  deleteDoc: async (collection, docId, idToken) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
    const headers = { 'Content-Type': 'application/json' };
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

  listDocs: async (collection, idToken) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}`;
    const headers = { 'Content-Type': 'application/json' };
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
      return (data.documents || []).map((doc) => ({
        id: doc.name.split('/').pop(),
        ...parseFirestoreFields(doc.fields)
      }));
    } catch (e) {
      throw new Error("Invalid response from Firestore list: " + resText.substring(0, 100));
    }
  }
};

// Helper to parse Firestore REST fields
export function parseFirestoreFields(fields) {
  if (!fields) return {};
  const result = {};
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
        result[key] = (valueObj.arrayValue.values || []).map((v) => {
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
export function encodeFirestoreFields(data) {
  const fields = {};
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
