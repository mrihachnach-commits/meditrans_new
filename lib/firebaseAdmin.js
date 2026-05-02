import admin from "firebase-admin";

// Singleton admin app
let adminApp = null;
let parsedServiceAccount = null;

export let firebaseConfig = { error: "Not initialized" };

export function getAdminApp() {
  if (adminApp) return adminApp;

  const envVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!envVar) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is not set.");
  }

  try {
    parsedServiceAccount = JSON.parse(envVar);
    
    // Populate firebaseConfig for backward compatibility
    firebaseConfig = {
      projectId: parsedServiceAccount.project_id,
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      apiKey: process.env.FIREBASE_API_KEY // If available
    };
    
    // Check if initialized already
    if (admin.apps.length === 0) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(parsedServiceAccount),
      });
      console.log("[Firebase Admin] Initialized with Service Account.");
    } else {
      adminApp = admin.apps[0];
    }
    return adminApp;
  } catch (e) {
    console.error("[Firebase Admin] Initialization failed:", e.message);
    firebaseConfig = { error: e.message };
    throw e;
  }
}

export function getAdminFirestore() {
  const app = getAdminApp();
  return admin.firestore(app);
}

// Helper for REST API, projectId is derived from serviceAccount
const getProjectId = () => {
    if (!parsedServiceAccount) getAdminApp();
    return parsedServiceAccount.project_id;
};

// Database ID: default if not provided
const getDatabaseId = () => process.env.FIREBASE_DATABASE_ID || "(default)";

// Firestore Helper using REST API
export const firestoreRest = {
  getDoc: async (collection, docId, idToken) => {
    const projectId = getProjectId();
    const databaseId = getDatabaseId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/${docId}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { headers });
    if (res.status === 404) return { exists: false };
    
    const resText = await res.text();
    if (!res.ok) {
      throw new Error(`Firestore REST error: ${resText}`);
    }
    
    try {
      const data = JSON.parse(resText);
      return { exists: true, data: parseFirestoreFields(data.fields) };
    } catch (e) {
      throw new Error("Invalid response from Firestore: " + resText.substring(0, 100));
    }
  },
  
  setDoc: async (collection, docId, data, idToken) => {
    const projectId = getProjectId();
    const databaseId = getDatabaseId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/${docId}`;
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
      throw new Error(`Firestore REST error: ${resText}`);
    }
    return JSON.parse(resText);
  },

  deleteDoc: async (collection, docId, idToken) => {
    const projectId = getProjectId();
    const databaseId = getDatabaseId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/${docId}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const resText = await res.text();
      throw new Error(`Firestore REST error: ${resText}`);
    }
    return true;
  },

  listDocs: async (collection, idToken) => {
    const projectId = getProjectId();
    const databaseId = getDatabaseId();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    
    const res = await fetch(url, { headers });
    const resText = await res.text();
    
    if (!res.ok) {
      throw new Error(`Firestore REST error (Status ${res.status}): ${resText}`);
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
