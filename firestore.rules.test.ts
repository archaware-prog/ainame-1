import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'ainame-76af5';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules — My Library Dashboard', () => {
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'userA'), {
        displayName: 'User A',
        email: 'a@example.com',
        role: 'user',
        status: 'active',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'userB'), {
        displayName: 'User B',
        email: 'b@example.com',
        role: 'user',
        status: 'active',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'bannedUser'), {
        displayName: 'Banned User',
        email: 'banned@example.com',
        role: 'user',
        status: 'banned',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'userB', 'library', 'mov-1'), {
        titleId: 'mov-1',
        titleName: 'Neon Horizon',
        titleType: 'movie',
        addedAt: '2026-01-01T00:00:00.000Z',
        status: 'watching',
      });
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it('denies signed-out users from reading or writing library subcollections', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(anonDb, 'users', 'userA', 'library')));
    await assertFails(
      setDoc(doc(anonDb, 'users', 'userA', 'library', 'mov-1'), {
        titleId: 'mov-1',
        titleName: 'Neon Horizon',
        titleType: 'movie',
        addedAt: '2026-01-01T00:00:00.000Z',
        status: 'watching',
      })
    );
  });

  it('denies user A from reading or writing user B library, progress, activity, and achievements', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertFails(getDoc(doc(dbA, 'users', 'userB', 'library', 'mov-1')));
    await assertFails(getDocs(collection(dbA, 'users', 'userB', 'progress')));
    await assertFails(
      setDoc(doc(dbA, 'users', 'userB', 'library', 'mov-2'), {
        titleId: 'mov-2',
        titleName: 'Solar Echo',
        titleType: 'movie',
        addedAt: '2026-01-01T00:00:00.000Z',
        status: 'watching',
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'users', 'userB', 'activity', 'act-1'), {
        type: 'library',
        titleId: 'mov-1',
        titleName: 'Neon Horizon',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('denies banned users from writing to their own library', async () => {
    const bannedDb = testEnv.authenticatedContext('bannedUser').firestore();
    await assertFails(
      setDoc(doc(bannedDb, 'users', 'bannedUser', 'library', 'mov-1'), {
        titleId: 'mov-1',
        titleName: 'Neon Horizon',
        titleType: 'movie',
        addedAt: '2026-01-01T00:00:00.000Z',
        status: 'watching',
      })
    );
  });

  it('rejects forged achievements when progressPercent is not 100', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(
      setDoc(doc(dbA, 'users', 'userA', 'progress', 'ser-1'), {
        titleId: 'ser-1',
        totalUnits: 2,
        completedUnits: 1,
        completedEpisodeIds: ['ep-1'],
        progressPercent: 50,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    await assertFails(
      setDoc(doc(dbA, 'users', 'userA', 'achievements', 'title_completed_ser-1'), {
        kind: 'title_completed',
        titleId: 'ser-1',
        titleName: 'Starlight Chronicles',
        issuedAt: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('allows valid batch title completion creating progress=100, activity, and deterministic achievement', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    const batch = writeBatch(dbA);

    batch.set(doc(dbA, 'users', 'userA', 'library', 'mov-1'), {
      titleId: 'mov-1',
      titleName: 'Neon Horizon',
      titleType: 'movie',
      addedAt: '2026-01-01T00:00:00.000Z',
      status: 'completed',
    });
    batch.set(doc(dbA, 'users', 'userA', 'progress', 'mov-1'), {
      titleId: 'mov-1',
      totalUnits: 1,
      completedUnits: 1,
      completedEpisodeIds: ['mov-1'],
      progressPercent: 100,
      updatedAt: '2026-01-01T00:10:00.000Z',
    });
    batch.set(doc(dbA, 'users', 'userA', 'activity', 'act-watch-1'), {
      type: 'watch',
      titleId: 'mov-1',
      titleName: 'Neon Horizon',
      durationSeconds: 1800,
      createdAt: '2026-01-01T00:10:00.000Z',
    });
    batch.set(doc(dbA, 'users', 'userA', 'achievements', 'title_completed_mov-1'), {
      kind: 'title_completed',
      titleId: 'mov-1',
      titleName: 'Neon Horizon',
      issuedAt: '2026-01-01T00:10:00.000Z',
    });

    await assertSucceeds(batch.commit());

    // Achievements cannot be updated or deleted by user
    await assertFails(
      updateDoc(doc(dbA, 'users', 'userA', 'achievements', 'title_completed_mov-1'), {
        titleName: 'Tampered',
      })
    );
    await assertFails(
      deleteDoc(doc(dbA, 'users', 'userA', 'achievements', 'title_completed_mov-1'))
    );

    // Activity is append-only (no update or delete by user)
    await assertFails(
      updateDoc(doc(dbA, 'users', 'userA', 'activity', 'act-watch-1'), {
        titleName: 'Tampered',
      })
    );
    await assertFails(
      deleteDoc(doc(dbA, 'users', 'userA', 'activity', 'act-watch-1'))
    );
  });
});

describe('Firestore Security Rules — Orders, Posts & Admin Hardening', () => {
  before(async () => {
    if (!testEnv) {
      testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
          rules: readFileSync('firestore.rules', 'utf8'),
        },
      });
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'studentA'), {
        displayName: 'Student A',
        email: 'studenta@example.com',
        role: 'user',
        status: 'active',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'studentB'), {
        displayName: 'Student B',
        email: 'studentb@example.com',
        role: 'user',
        status: 'active',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'bannedStudent'), {
        displayName: 'Banned Student',
        email: 'banned@example.com',
        role: 'user',
        status: 'banned',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'adminUser'), {
        displayName: 'Site Admin',
        email: 'admin@example.com',
        role: 'admin',
        status: 'active',
        plan: 'premium',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'plans', 'plan-plus'), {
        name: 'Cinema Plus',
        slug: 'cinema-plus',
        pricePerMonth: 9.99,
        currency: 'USD',
        billingInterval: 'monthly',
        isActive: true,
        order: 1,
      });
      await setDoc(doc(db, 'orders', 'ord-existing-a'), {
        userId: 'studentA',
        userEmail: 'studenta@example.com',
        userName: 'Student A',
        planId: 'plan-plus',
        planName: 'Cinema Plus',
        amount: 9.99,
        currency: 'USD',
        paymentStatus: 'pending',
        paymentMethod: 'manual',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
      await setDoc(doc(db, 'posts', 'post-pub'), {
        title: 'Spring Anime Guide',
        slug: 'spring-anime-guide',
        excerpt: 'Top simulcasts this season.',
        contentHtml: '<p>Full season lineup</p>',
        status: 'published',
        authorUid: 'adminUser',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        publishedAt: '2026-01-02T00:00:00.000Z',
      });
      await setDoc(doc(db, 'posts', 'post-draft'), {
        title: 'Internal Draft',
        slug: 'internal-draft',
        excerpt: 'Not yet public.',
        contentHtml: '<p>WIP</p>',
        status: 'draft',
        authorUid: 'adminUser',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    });
  });

  it('prevents students from self-upgrading to premium on users/{uid}', async () => {
    const dbA = testEnv.authenticatedContext('studentA').firestore();
    await assertFails(
      updateDoc(doc(dbA, 'users', 'studentA'), {
        plan: 'premium',
        subscriptionPlanId: 'plan-plus',
        subscriptionPlanName: 'Cinema Plus',
        planExpiresAt: '2026-02-02T00:00:00.000Z',
        lastLoginAt: '2026-01-03T00:00:00.000Z',
      })
    );
  });

  it('allows student to create own pending order matching active plan and read it, while blocking wrong amount, paid status, or reading others', async () => {
    const dbA = testEnv.authenticatedContext('studentA').firestore();
    const dbB = testEnv.authenticatedContext('studentB').firestore();

    // Valid pending order creation
    await assertSucceeds(
      setDoc(doc(dbA, 'orders', 'ord-new-a'), {
        userId: 'studentA',
        userEmail: 'studenta@example.com',
        userName: 'Student A',
        planId: 'plan-plus',
        planName: 'Cinema Plus',
        amount: 9.99,
        currency: 'USD',
        paymentStatus: 'pending',
        paymentMethod: 'manual',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );

    // Owner can read own order
    await assertSucceeds(getDoc(doc(dbA, 'orders', 'ord-new-a')));

    // Student B cannot read Student A's order or list all orders
    await assertFails(getDoc(doc(dbB, 'orders', 'ord-existing-a')));
    await assertFails(getDocs(collection(dbB, 'orders')));

    // Student cannot create a paid order or spoof amount
    await assertFails(
      setDoc(doc(dbA, 'orders', 'ord-fake-paid'), {
        userId: 'studentA',
        userEmail: 'studenta@example.com',
        userName: 'Student A',
        planId: 'plan-plus',
        planName: 'Cinema Plus',
        amount: 9.99,
        currency: 'USD',
        paymentStatus: 'paid',
        paymentMethod: 'manual',
        createdAt: '2026-01-03T00:00:00.000Z',
        paidAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'orders', 'ord-wrong-amt'), {
        userId: 'studentA',
        userEmail: 'studenta@example.com',
        userName: 'Student A',
        planId: 'plan-plus',
        planName: 'Cinema Plus',
        amount: 0.01,
        currency: 'USD',
        paymentStatus: 'pending',
        paymentMethod: 'manual',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );

    // Student cannot update or delete an order
    await assertFails(
      updateDoc(doc(dbA, 'orders', 'ord-existing-a'), {
        paymentStatus: 'paid',
        paidAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );
    await assertFails(deleteDoc(doc(dbA, 'orders', 'ord-existing-a')));
  });

  it('denies banned students from creating orders and restricts users list / posts / plans / settings writes', async () => {
    const bannedDb = testEnv.authenticatedContext('bannedStudent').firestore();
    const dbA = testEnv.authenticatedContext('studentA').firestore();

    await assertFails(
      setDoc(doc(bannedDb, 'orders', 'ord-banned'), {
        userId: 'bannedStudent',
        userEmail: 'banned@example.com',
        userName: 'Banned Student',
        planId: 'plan-plus',
        planName: 'Cinema Plus',
        amount: 9.99,
        currency: 'USD',
        paymentStatus: 'pending',
        paymentMethod: 'manual',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );

    await assertFails(getDocs(collection(dbA, 'users')));
    await assertFails(
      setDoc(doc(dbA, 'posts', 'post-stu'), {
        title: 'Hack',
        slug: 'hack',
        excerpt: 'No',
        contentHtml: '<p>No</p>',
        status: 'published',
        authorUid: 'studentA',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      })
    );
    await assertFails(updateDoc(doc(dbA, 'plans', 'plan-plus'), { pricePerMonth: 0 }));
    await assertFails(
      setDoc(doc(dbA, 'settings', 'site'), {
        siteName: 'Pwned',
        primaryColor: '#000000',
        maintenanceMode: false,
        allowRegistration: true,
      })
    );
  });

  it('allows admin batch confirmation (pending -> paid + user upgrade + activityLog), blocks order amount/userId edits & deletes, and blocks self-demotion/self-deletion', async () => {
    const adminDb = testEnv.authenticatedContext('adminUser').firestore();

    // Atomic batch: mark pending order paid, upgrade studentA to premium, write activityLogs
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, 'orders', 'ord-existing-a'), {
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      reference: 'UTR-9988',
      paidAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    });
    batch.update(doc(adminDb, 'users', 'studentA'), {
      plan: 'premium',
      subscriptionPlanId: 'plan-plus',
      subscriptionPlanName: 'Cinema Plus',
      planExpiresAt: '2026-02-04T00:00:00.000Z',
      lastLoginAt: '2026-01-04T00:00:00.000Z',
    });
    batch.set(doc(adminDb, 'activityLogs', 'log-order-1'), {
      adminUid: 'adminUser',
      action: 'mark_order_paid',
      targetId: 'ord-existing-a',
      createdAt: '2026-01-04T00:00:00.000Z',
    });
    await assertSucceeds(batch.commit());

    // Admin cannot mutate immutable amount or userId, and cannot delete orders
    await assertFails(
      updateDoc(doc(adminDb, 'orders', 'ord-existing-a'), {
        amount: 1.0,
        paymentStatus: 'refunded',
        updatedAt: '2026-01-05T00:00:00.000Z',
      })
    );
    await assertFails(
      updateDoc(doc(adminDb, 'orders', 'ord-existing-a'), {
        userId: 'studentB',
        paymentStatus: 'refunded',
        updatedAt: '2026-01-05T00:00:00.000Z',
      })
    );
    await assertFails(deleteDoc(doc(adminDb, 'orders', 'ord-existing-a')));

    // Admin cannot demote or delete own account
    await assertFails(updateDoc(doc(adminDb, 'users', 'adminUser'), { role: 'user' }));
    await assertFails(deleteDoc(doc(adminDb, 'users', 'adminUser')));
  });

  it('allows signed-out users to read published posts only, while admins manage drafts', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const adminDb = testEnv.authenticatedContext('adminUser').firestore();

    await assertSucceeds(getDoc(doc(anonDb, 'posts', 'post-pub')));
    await assertFails(getDoc(doc(anonDb, 'posts', 'post-draft')));
    await assertSucceeds(getDoc(doc(adminDb, 'posts', 'post-draft')));
  });
});

