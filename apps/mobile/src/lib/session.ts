import * as SecureStore from 'expo-secure-store';

/**
 * Session storage.
 *
 * Tokens go in the device keychain rather than AsyncStorage: a warehouse phone
 * is shared, lost and handed around, and AsyncStorage is readable by anything
 * that can reach the app's sandbox.
 */
const ACCESS_KEY = 'mizmar.accessToken';
const REFRESH_KEY = 'mizmar.refreshToken';
const COMPANY_KEY = 'mizmar.companyId';

export interface StoredSession {
  accessToken: string | null;
  refreshToken: string | null;
  companyId: string | null;
}

export async function readSession(): Promise<StoredSession> {
  const [accessToken, refreshToken, companyId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(COMPANY_KEY),
  ]);
  return { accessToken, refreshToken, companyId };
}

export async function writeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
  ]);
}

export async function writeCompany(companyId: string): Promise<void> {
  await SecureStore.setItemAsync(COMPANY_KEY, companyId);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(COMPANY_KEY),
  ]);
}
