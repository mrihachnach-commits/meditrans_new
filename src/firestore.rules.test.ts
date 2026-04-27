import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';
import fs from 'fs';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules', () => {
  before(async () => {
    setLogLevel('error');
    testEnv = await initializeTestEnvironment({
      projectId: 'rules-test-project',
      firestore: {
        rules: fs.readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const getContext = (auth: any) => testEnv.authenticatedContext(auth.uid, { email: auth.email, email_verified: true });
  const getAdminContext = () => testEnv.authenticatedContext('admin-uid', { email: 'admin@gmail.com', email_verified: true });
  const getUnverifiedContext = (auth: any) => testEnv.authenticatedContext(auth.uid, { email: auth.email, email_verified: false });

  it('Payload 1: Deny role change to admin for non-admin user', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', userId);
    
    // Initial setup with admin
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', userId), {
        uid: userId,
        email: 'user@test.com',
        role: 'user'
      });
    });

    await assertFails(updateDoc(userDoc, { role: 'admin' }));
  });

  it('Payload 2: Deny creating user with mismatched UID', async () => {
    const context = testEnv.authenticatedContext('user1', { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', 'user2');
    await assertFails(setDoc(userDoc, {
      uid: 'user2',
      email: 'user@test.com',
      role: 'user'
    }));
  });

  it('Payload 3: Deny API key creation with mismatched ownerId', async () => {
    const context = testEnv.authenticatedContext('user1', { email: 'user@test.com', email_verified: true });
    const keyDoc = doc(context.firestore(), 'apiKeys', 'key1');
    await assertFails(setDoc(keyDoc, {
      ownerId: 'user2',
      name: 'Key',
      value: 'secret',
      engine: 'gemini',
      createdAt: new Date()
    }));
  });

  it('Payload 4: Deny document creation with client-side timestamp', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const docRef = doc(context.firestore(), `users/${userId}/documents`, 'doc1');
    await assertFails(setDoc(docRef, {
      name: 'doc.pdf',
      ownerId: userId,
      token: 'tok',
      downloadUrl: 'http://foo.com',
      createdAt: new Date('2020-01-01') // Past date
    }));
  });

  it('Payload 8: Deny peer-to-peer user profile read', async () => {
    const context = testEnv.authenticatedContext('user1', { email: 'user1@test.com', email_verified: true });
    const otherUserDoc = doc(context.firestore(), 'users', 'user2');
    await assertFails(getDoc(otherUserDoc));
  });

  it('Pillar 0 check: Deny access to undefined collections', async () => {
    const context = testEnv.authenticatedContext('user1', { email: 'user@test.com', email_verified: true });
    const secretDoc = doc(context.firestore(), 'secrets', 'all');
    await assertFails(getDoc(secretDoc));
  });

  it('Email Verified Check: Deny writes from unverified users', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: false });
    const userDoc = doc(context.firestore(), 'users', userId);
    await assertFails(setDoc(userDoc, {
      uid: userId,
      email: 'user@test.com',
      role: 'user'
    }));
  });
});
