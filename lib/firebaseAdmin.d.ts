import { Request } from "express";

export interface CustomRequest extends Request {
  user?: any;
  idToken?: string;
}

export declare const firebaseConfig: any;
export declare function getAdminApp(): any;
export declare const getAdminFirestore: any;
export declare const firestoreRest: {
  getDoc: (collection: string, docId: string, idToken?: string) => Promise<any>;
  setDoc: (collection: string, docId: string, data: any, idToken?: string) => Promise<any>;
  deleteDoc: (collection: string, docId: string, idToken?: string) => Promise<any>;
  listDocs: (collection: string, idToken?: string) => Promise<any[]>;
};

export declare function parseFirestoreFields(fields: any): any;
export declare function encodeFirestoreFields(data: any): any;
