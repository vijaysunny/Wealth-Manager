import { View, Text, TextInput , useAppTheme } from './Theme';
import React,{useEffect,useState} from 'react';
import { Button, Switch, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { LOCK_KEY,enableAppLock } from './AppLock';
import { buildBackup,validateBackup,formatSummary,restoreBackup } from '../utils/BackupService';
import { encryptBackup,decryptBackup } from '../utils/EncryptedBackup';
import { mergeRestore } from '../utils/FeatureService';
export default function SecurityPanel(){
  const {dark,setDark}=useAppTheme();
  const [locked,setLocked]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{SecureStore.getItemAsync(LOCK_KEY).then(value=>setLocked(value==='true')).catch(()=>{});},[]);
  const run=async task=>{if(busy)return;setBusy(true);try{await task();}catch(error){Alert.alert('Could not complete',error.message);}finally{setBusy(false);}};
  const restore=async()=>{
    const picked=await DocumentPicker.getDocumentAsync({type:'application/json'});
    if(picked.canceled)return;
    const content=JSON.parse(await FileSystem.readAsStringAsync(picked.assets[0].uri));
    const data=content.encrypted?decryptBackup(content,password):content;
    const check=validateBackup(data);if(!check.ok)throw new Error(check.errors.join('\n'));
    Alert.alert('Restore backup?',`${formatSummary(data)}\n\nMerge keeps current account balances and existing settings, adds new rows, and skips duplicates. Replace overwrites fields in this backup.`,[
      {text:'Cancel',style:'cancel'},
      {text:'Merge',onPress:()=>run(async()=>{const result=await mergeRestore(data);setPassword('');Alert.alert('Merged',`${result.added} transactions added; ${result.skipped} skipped.`);})},
      {text:'Replace',style:'destructive',onPress:()=>run(async()=>{await restoreBackup(data);setPassword('');Alert.alert('Restored','Restart the app to reload restored data.');})},
    ]);
  };
  return <View style={{padding:16}}>
    <Text style={{fontSize:16,fontWeight:'bold'}}>Security and appearance</Text>
    <View style={{flexDirection:'row',alignItems:'center'}}><Text style={{flex:1}}>Dark mode</Text><Switch value={dark} onValueChange={value=>run(()=>setDark(value))} disabled={busy}/></View>
    <View style={{flexDirection:'row',alignItems:'center'}}><Text style={{flex:1}}>Biometric app lock</Text><Switch value={locked} onValueChange={value=>run(async()=>{await enableAppLock(value);setLocked(value);})} disabled={busy}/></View>
    <Text>Backup passphrase (at least 10 characters)</Text><TextInput secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" style={{borderWidth:1,borderColor:'#999',padding:10,borderRadius:8,marginVertical:8}}/>
    <Button disabled={busy} title={busy?'Working…':'Export encrypted backup'} onPress={()=>run(async()=>{
      const data=encryptBackup(await buildBackup(),password);
      const uri=FileSystem.cacheDirectory+'wealthmanager_encrypted.json';
      await FileSystem.writeAsStringAsync(uri,JSON.stringify(data));
      if(!(await Sharing.isAvailableAsync()))throw new Error('Sharing is unavailable');
      await Sharing.shareAsync(uri);setPassword('');
    })}/>
    <Button disabled={busy} title="Restore or merge backup" onPress={()=>run(restore)}/>
    <Text style={{fontSize:12,marginTop:8}}>Keep your passphrase: encrypted backups cannot be recovered without it. App lock protects access to the app; database files use the device’s storage protection.</Text>
  </View>;
}
