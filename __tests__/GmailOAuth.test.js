let mockTokens=null;
const mockPrompt=jest.fn();
const mockRequest=jest.fn().mockImplementation(options=>({codeVerifier:'test-verifier',promptAsync:mockPrompt,options}));
const mockExchange=jest.fn(),mockRefresh=jest.fn();
jest.mock('expo-auth-session',()=>({AuthRequest:mockRequest,ResponseType:{Code:'code'},exchangeCodeAsync:mockExchange,refreshAsync:mockRefresh}));
jest.mock('expo-web-browser',()=>({maybeCompleteAuthSession:jest.fn()}));
jest.mock('expo-secure-store',()=>({getItemAsync:async()=>mockTokens,setItemAsync:async(key,value)=>{mockTokens=value;},deleteItemAsync:async()=>{mockTokens=null;}}));
jest.mock('@react-native-async-storage/async-storage',()=>require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../utils/NotificationService',()=>({sendTransactionNotification:jest.fn()}));
let tracker;
beforeAll(()=>{process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID='test-client';tracker=require('../utils/GmailTracker');});
afterAll(()=>{delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;});
beforeEach(()=>{
  jest.clearAllMocks();mockTokens=null;
  mockPrompt.mockResolvedValue({type:'success',params:{code:'test-code'}});
  mockExchange.mockResolvedValue({accessToken:'test-access',refreshToken:'test-refresh',issuedAt:Date.now()/1000,expiresIn:3600});
  mockRefresh.mockResolvedValue({accessToken:'refreshed-access',issuedAt:Date.now()/1000,expiresIn:3600});
  global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({messages:[]})});
});
test('code exchange sends verifier and secure credentials retain refresh token',async()=>{
  expect(await tracker.signInWithGoogle()).toEqual({success:true});
  expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({responseType:'code',usePKCE:true,redirectUri:'wealthmanager://auth'}));
  expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({code:'test-code',extraParams:{code_verifier:'test-verifier'}}),expect.anything());
  expect(JSON.parse(mockTokens).refreshToken).toBe('test-refresh');
});
test('expired token refreshes and keeps refresh token when Google omits it',async()=>{
  await tracker.signInWithGoogle();mockTokens=JSON.stringify({...JSON.parse(mockTokens),expiresAt:0});
  expect(await tracker.syncGmailTransactions()).toMatchObject({success:true,added:0});
  expect(mockRefresh).toHaveBeenCalledTimes(1);expect(JSON.parse(mockTokens).refreshToken).toBe('test-refresh');
});
test('401 refreshes once then retries',async()=>{
  await tracker.signInWithGoogle();
  global.fetch.mockResolvedValueOnce({ok:false,status:401});
  expect(await tracker.syncGmailTransactions()).toMatchObject({success:true});expect(mockRefresh).toHaveBeenCalledTimes(1);expect(global.fetch).toHaveBeenCalledTimes(2);
});
test('invalid grant clears credentials and requires reconnect',async()=>{
  await tracker.signInWithGoogle();mockTokens=JSON.stringify({...JSON.parse(mockTokens),expiresAt:0});
  mockRefresh.mockRejectedValueOnce(Object.assign(new Error('Revoked'),{code:'invalid_grant'}));
  expect(await tracker.syncGmailTransactions()).toEqual({success:false,error:'token_expired'});expect(mockTokens).toBeNull();
});
