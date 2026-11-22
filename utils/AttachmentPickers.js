/**
 * AttachmentPickers.js (B1) - Camera, Gallery and Any file. Each returns
 * { uri, name, mime, size } or null when the owner cancels. Opening a file uses Share so
 * Android picks the right viewer.
 */
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { suppressNextLock } from './LockSuppress';

const fromImage = (res) => {
  if (!res || res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const name = a.fileName || `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  return { uri: a.uri, name, mime: a.mimeType || 'image/jpeg', size: a.fileSize ?? null };
};

export const pickFromCamera = async () => {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access to photograph a bill.');
  suppressNextLock();
  return fromImage(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 }));
};

export const pickFromGallery = async () => {
  suppressNextLock();
  return fromImage(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 }));
};

export const pickAnyFile = async () => {
  suppressNextLock();
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (!res || res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mime: a.mimeType || null, size: a.size ?? null };
};

export const openAttachment = async (file) => {
  if (!(await Sharing.isAvailableAsync())) throw new Error('No app on this phone can open files.');
  suppressNextLock();
  await Sharing.shareAsync(file.uri, { mimeType: file.mime || undefined, dialogTitle: file.name });
};
