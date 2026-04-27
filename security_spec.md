# Security Specification for MediTrans AI

## 1. Data Invariants

- **User Ownership**: All user-related resources (folders, documents, translations, summaries, API keys) MUST be owned by the user who created them.
- **Relational Integrity**: Documents must belong to an existing user. Folders must belong to an existing user.
- **Identity Protection**: Users cannot modify their own roles or block status unless they are an admin.
- **Terminal State Locking**: Once a translation status is 'success', it should ideally be preserved or updated only by authorized users.
- **Server Timestamp Enforcement**: all `createdAt` and `updatedAt` fields MUST match `request.time`.
- **Identity Integrity**: `uid` and `email` in the user profile must match the authenticated user's token.
- **PII Isolation**: User profiles and emails should only be readable by the owner or an admin.

## 2. The "Dirty Dozen" Payloads (Red Team Tests)

| #  | Target Collection | Operation | Payload / Condition | Expected Outcome |
|----|-------------------|-----------|---------------------|------------------|
| 1  | `users`           | Update    | Changing `role` to 'admin' (Non-admin user) | DENIED |
| 2  | `users`           | Create    | Using a different `uid` than request.auth.uid | DENIED |
| 3  | `apiKeys`         | Create    | Setting `ownerId` to another user's UID | DENIED |
| 4  | `documents`       | Create    | Setting `createdAt` to a client-side timestamp | DENIED |
| 5  | `documents`       | Update    | Modifying `ownerId` of an existing document | DENIED (affectedKeys) |
| 6  | `pages`           | Create    | Writing to a document owned by another user | DENIED |
| 7  | `blacklist`       | Create    | Non-admin user trying to blacklist an email | DENIED |
| 8  | `users`           | Get       | Authenticated user reading another user's profile | DENIED |
| 9  | `documents`       | Create    | Creating a document with a 1MB string as `docId` | DENIED (isValidId size check) |
| 10 | `translations`    | Create    | Creating a translation with size > 1MB | DENIED (size check) |
| 11 | `apiKeys`         | Update    | Modifying the `value` of another user's API key | DENIED |
| 12 | `users`           | List      | Non-admin user trying to list all users | DENIED |

## 3. Test Runner (firestore.rules.test.ts)

I will implement a test runner following these scenarios.
