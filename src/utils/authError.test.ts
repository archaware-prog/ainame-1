import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFirebaseAuthError } from './authError';

test('mapFirebaseAuthError maps Sign In credential errors to exact message', () => {
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/wrong-password' }, 'signin'),
    'Email or password is incorrect'
  );
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/user-not-found' }, 'signin'),
    'Email or password is incorrect'
  );
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/invalid-credential' }, 'signin'),
    'Email or password is incorrect'
  );
  assert.equal(
    mapFirebaseAuthError(new Error('Firebase: Error (auth/invalid-credential).'), 'signin'),
    'Email or password is incorrect'
  );
});

test('mapFirebaseAuthError maps Sign Up existing email error to exact message', () => {
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/email-already-in-use' }, 'signup'),
    'User already exists. Please sign in'
  );
  assert.equal(
    mapFirebaseAuthError(new Error('Firebase: Error (auth/email-already-in-use).'), 'signup'),
    'User already exists. Please sign in'
  );
});

test('mapFirebaseAuthError maps all other errors to generic safe message', () => {
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/too-many-requests' }, 'signin'),
    'Something went wrong. Please try again.'
  );
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/weak-password' }, 'signup'),
    'Something went wrong. Please try again.'
  );
  assert.equal(
    mapFirebaseAuthError({ code: 'auth/network-request-failed' }, 'other'),
    'Something went wrong. Please try again.'
  );
  assert.equal(
    mapFirebaseAuthError(new Error('Unexpected failure'), 'signin'),
    'Something went wrong. Please try again.'
  );
});
