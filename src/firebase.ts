import { initializeApp, onLog } from 'firebase/app';
import { 
  getAuth, 
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  getFirestore, 
  arrayUnion,
  arrayRemove,
  collection, 
  addDoc, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  serverTimestamp, 
  Timestamp, 
  getDocFromServer,
  or,
  collectionGroup,
  setLogLevel as setFirestoreLogLevel
} from 'firebase/firestore';
import { noteFirestoreError, onFirestoreQuota } from './services/firestoreQuota';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
const firestoreDbId = (firebaseConfig as any).firestoreDatabaseId || 'ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b';
export const db = firestoreDbId && firestoreDbId !== '(default)'
  ? getFirestore(app, firestoreDbId)
  : getFirestore(app);

// v9.9: khi Firestore hết hạn mức ghi miễn phí, SDK tự thử ghi lại mãi (lỗi resource-exhausted không làm promise
// thất bại) và in lỗi đỏ liên tục "Quota limit exceeded… Using maximum backoff delay". Bắt lỗi này từ log của SDK →
// đánh dấu hết hạn mức (ngừng mọi lượt ghi mới tới khi hạn mức đặt lại), báo MỘT lần, rồi tắt log lỗi lặp của SDK.
try {
  onLog(({ message, type }) => {
    if (type && !/firestore/i.test(type)) return;
    if (/resource-exhausted|quota (limit )?exceeded/i.test(message || '')) noteFirestoreError({ code: 'resource-exhausted', message });
  }, { level: 'error' });
  onFirestoreQuota(() => { try { setFirestoreLogLevel('silent'); } catch { /* */ } });
} catch { /* môi trường không hỗ trợ */ }
export const auth = getAuth();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('[Firestore Error]:', errInfo);
  return errInfo;
}

export { 
  firebaseConfig,
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  collection, 
  addDoc,
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  serverTimestamp,
  Timestamp,
  getDocFromServer,
  or,
  collectionGroup,
  arrayUnion,
  arrayRemove
};
export type { User };
