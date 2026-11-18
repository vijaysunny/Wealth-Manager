import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '../data/Storage';
import { saveWithDedup } from './DeduplicationEngine';
import { parseTransactionText } from './TransactionParser';
import { capturedFields } from './CaptureMapper';
import { isGmailEnabled } from './Features';
import { extractEmailText } from './GmailMime';
WebBrowser.maybeCompleteAuthSession();
const KEY = 'gmail_oauth_credentials';
const SYNC = 'gmail_last_sync_time';
const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';
const redirectUri = 'wealthmanager://auth';
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};
let refreshing, syncing;
const load = async () => {
  await AsyncStorage.removeItem('gmail_oauth_token');
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? JSON.parse(raw) : null;
};
const store = async (response, previous = {}) => {
  const tokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken || previous.refreshToken,
    expiresAt: (response.issuedAt || Date.now() / 1000) * 1000 + (response.expiresIn || 3600) * 1000,
  };
  if (!tokens.refreshToken)
    throw new Error('No refresh token returned. Revoke Google app access and reconnect.');
  await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  return tokens;
};
export const signInWithGoogle = async () => {
  if (!clientId || !isGmailEnabled()) return { success: false, error: 'not_configured' };
  try {
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
      extraParams: { access_type: 'offline', prompt: 'consent' },
    });
    const result = await request.promptAsync(discovery);
    if (result.type !== 'success' || !result.params.code) return { success: false, error: result.type };
    await store(
      await AuthSession.exchangeCodeAsync(
        {
          clientId,
          redirectUri,
          code: result.params.code,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery
      )
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
const refresh = () => {
  if (!refreshing)
    refreshing = (async () => {
      const previous = await load();
      if (!previous?.refreshToken) throw new Error('not_authenticated');
      try {
        return await store(
          await AuthSession.refreshAsync({ clientId, refreshToken: previous.refreshToken }, discovery),
          previous
        );
      } catch (error) {
        if (error.code === 'invalid_grant') {
          await SecureStore.deleteItemAsync(KEY);
          throw new Error('token_expired');
        }
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
  return refreshing;
};
export const getStoredToken = async () => (await load())?.accessToken || null;
export const isGmailConnected = async () => !!(await load())?.refreshToken;
export const signOutGmail = async () => {
  const tokens = await load();
  await SecureStore.deleteItemAsync(KEY);
  await AsyncStorage.removeItem(SYNC);
  if (tokens) {
    try {
      await fetch(discovery.revocationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(tokens.refreshToken || tokens.accessToken)}`,
      });
    } catch {
      /* local sign-out works offline */
    }
  }
};
const gmailFetch = async (path) => {
  let tokens = await load();
  if (!tokens) throw new Error('not_authenticated');
  if (tokens.expiresAt <= Date.now() + 60000) tokens = await refresh();
  const send = (token) =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  let response = await send(tokens.accessToken);
  if (response.status === 401) response = await send((await refresh()).accessToken);
  if (!response.ok)
    throw new Error(response.status === 401 ? 'token_expired' : `Gmail API error: ${response.status}`);
  return response.json();
};
const runSync = async () => {
  if (!clientId || !isGmailEnabled()) return { success: false, error: 'not_configured' };
  try {
    const startedAt = Date.now();
    const last = await AsyncStorage.getItem(SYNC);
    const since = last ? Number(last) - 60000 : startedAt - 30 * 86400000;
    const query = encodeURIComponent(
      `{subject:transaction subject:debited subject:credited subject:payment} after:${Math.floor(since / 1000)}`
    );
    let pageToken = '';
    const transactions = [];
    do {
      const page = await gmailFetch(
        `messages?q=${query}&maxResults=100&pageToken=${encodeURIComponent(pageToken)}`
      );
      for (const { id } of page.messages || []) {
        const message = await gmailFetch(`messages/${id}?format=full`);
        const parsed = parseTransactionText(extractEmailText(message.payload) || message.snippet || '', {
          bankFallback: 'Bank',
        });
        if (parsed)
          transactions.push({
            id: `gmail_${id}`,
            gmailMsgId: id,
            title: parsed.merchant || parsed.category,
            merchant: parsed.merchant,
            vpa: parsed.vpa,
            amount: parsed.amount,
            type: parsed.type,
            fullDate: new Date(Number(message.internalDate)).toISOString(),
            category: parsed.category,
            account: parsed.bankName,
            tags: ['Gmail-Sync'],
            refNo: parsed.refNo,
            extractedBalance: parsed.balance,
            ...capturedFields(parsed),
          });
      }
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    const { added, skipped } = await saveWithDedup(transactions, { balanceMode: 'captured' });
    await AsyncStorage.setItem(SYNC, String(startedAt));
    return { success: true, added, skipped };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
export const syncGmailTransactions = () => {
  if (!syncing)
    syncing = runSync().finally(() => {
      syncing = null;
    });
  return syncing;
};
