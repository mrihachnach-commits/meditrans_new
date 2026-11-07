import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import fs from 'fs';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules', () => {
  before(async () => {
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

  it('Payload 1: Deny role change to admin for non-admin user', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', userId);
    
    // Initial setup with admin
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', userId), {
        uid: userId,
        email: 'user@test.com',
        role: 'user',
        displayName: 'Old Name'
      });
    });

    await assertFails(updateDoc(userDoc, { role: 'admin' }));
  });

  it('Part 2 Test: Deny level change or levelExpiresAt change for non-admin user', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', userId);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', userId), {
        uid: userId,
        email: 'user@test.com',
        role: 'user',
        level: 1
      });
    });

    await assertFails(updateDoc(userDoc, { level: 3 }));
    await assertFails(updateDoc(userDoc, { levelExpiresAt: null }));
  });

  it('Part 2 Test: Deny normal user creating doc with role admin', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', userId);

    await assertFails(setDoc(userDoc, {
      uid: userId,
      email: 'user@test.com',
      role: 'admin'
    }));
  });

  it('Part 2 Test: Deny normal user reading systemShopAiKeys', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const keyDoc = doc(context.firestore(), 'systemShopAiKeys', 'key1');

    await assertFails(getDoc(keyDoc));
  });

  it('Part 2 Test: Allow normal user updating displayName', async () => {
    const userId = 'user1';
    const context = testEnv.authenticatedContext(userId, { email: 'user@test.com', email_verified: true });
    const userDoc = doc(context.firestore(), 'users', userId);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', userId), {
        uid: userId,
        email: 'user@test.com',
        role: 'user',
        displayName: 'Old Name'
      });
    });

    await assertSucceeds(updateDoc(userDoc, { displayName: 'New Name' }));
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
});
