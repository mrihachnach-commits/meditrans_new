export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: 'admin' | 'user';
  level?: number; // 1: Free, 2: VIP / ShopAIKey access, 3: Pro/Admin
  levelExpiresAt?: any; // Timestamp, ISO string or null (null = permanent/unlimited)
  isBlocked?: boolean;
  createdAt?: any;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  value: string;
  engine: string;
  ownerId: string;
  sharedWith?: string[];
  status?: 'active' | 'error';
  createdAt?: any;
  lastUsed?: any;
}

export interface SystemShopAiKey {
  id: string;
  name: string;
  value: string;
  engine: string;
  isActive: boolean;
  createdAt?: any;
  lastTestedAt?: any;
  latencyMs?: number;
  status?: 'active' | 'error';
}

/**
  Helper function to calculate effective level based on expiration date.
 */
export function getEffectiveUserLevel(user: Partial<UserProfile> | null | undefined): number {
  if (!user) return 1;
  // Admin role always has highest level (Level 3)
  if (user.role === 'admin') return 3;

  const rawLevel = user.level ?? 1;
  if (rawLevel <= 1) return 1;

  // Check if level has expired
  if (user.levelExpiresAt) {
    let expDate: Date | null = null;
    if (typeof user.levelExpiresAt === 'string') {
      expDate = new Date(user.levelExpiresAt);
    } else if (user.levelExpiresAt?.toDate && typeof user.levelExpiresAt.toDate === 'function') {
      expDate = user.levelExpiresAt.toDate();
    } else if (user.levelExpiresAt?._seconds) {
      expDate = new Date(user.levelExpiresAt._seconds * 1000);
    } else if (user.levelExpiresAt instanceof Date) {
      expDate = user.levelExpiresAt;
    }

    if (expDate && expDate.getTime() < Date.now()) {
      return 1; // Expired VIP level reverts to Level 1
    }
  }

  return rawLevel;
}

/**
 * Format remaining time for a level subscription.
 */
export function formatLevelExpiration(expiresAt: any): { text: string; isExpired: boolean; daysLeft: number | null } {
  if (!expiresAt) {
    return { text: 'Vĩnh viễn', isExpired: false, daysLeft: null };
  }

  let expDate: Date | null = null;
  if (typeof expiresAt === 'string') {
    expDate = new Date(expiresAt);
  } else if (expiresAt?.toDate && typeof expiresAt.toDate === 'function') {
    expDate = expiresAt.toDate();
  } else if (expiresAt?._seconds) {
    expDate = new Date(expiresAt._seconds * 1000);
  } else if (expiresAt instanceof Date) {
    expDate = expiresAt;
  }

  if (!expDate || isNaN(expDate.getTime())) {
    return { text: 'Vĩnh viễn', isExpired: false, daysLeft: null };
  }

  const diffMs = expDate.getTime() - Date.now();
  if (diffMs <= 0) {
    return { text: 'Đã hết hạn', isExpired: true, daysLeft: 0 };
  }

  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft === 1) {
    const hoursLeft = Math.ceil(diffMs / (1000 * 60 * 60));
    return { text: `Còn ${hoursLeft} giờ`, isExpired: false, daysLeft: 1 };
  }

  return { text: `Còn ${daysLeft} ngày`, isExpired: false, daysLeft };
}
