import React, { createContext, useContext, useMemo, useState } from 'react';
import Storage from '../data/Storage';
import { View as NativeView,Text as NativeText,TextInput as NativeInput,ScrollView as NativeScroll,TouchableOpacity as NativeTouch,StyleSheet } from 'react-native';
import { SafeAreaView as NativeSafeArea } from 'react-native-safe-area-context';
const ThemeContext=createContext({dark:false,setDark:()=>{}});
export const ThemeProvider=({children})=>{
  const [dark,setValue]=useState(false);
  React.useEffect(()=>{Storage.getItem('dark_mode').then(value=>setValue(value==='true')).catch(()=>{});},[]);
  const setDark=async value=>{await Storage.setItem('dark_mode',String(value));setValue(value);};
  return <ThemeContext.Provider value={{dark,setDark}}>{children}</ThemeContext.Provider>;
};
export const useAppTheme=()=>useContext(ThemeContext);
const shade=(value,key)=>{
  if(typeof value!=='string'||!/^#[\da-f]{3,8}$/i.test(value))return value;
  const full=value.length===4?value.slice(1).split('').map(c=>c+c).join(''):value.slice(1,7);
  if(full.length!==6)return value;
  const channels=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16));
  const neutral=Math.max(...channels)-Math.min(...channels)<40;
  if(key.toLowerCase().includes('background')&&Math.min(...channels)>170)return '#20242B';
  if(key==='color'&&neutral&&channels[0]<180)return '#E4E7EB';
  if(key.toLowerCase().includes('border')&&neutral)return '#555B66';
  return value;
};
export const useThemeStyles=base=>{
  const {dark}=useAppTheme();
  return useMemo(()=>dark?Object.fromEntries(Object.entries(base).map(([name,style])=>[name,Object.fromEntries(Object.entries(style).map(([key,value])=>[key,shade(value,key)]))])):base,[dark,base]);
};
const themed=Component=>function ThemedPrimitive(props){
  const {dark}=useAppTheme();
  const map=style=>{
    const flat=StyleSheet.flatten(style)||{};
    return dark?Object.fromEntries(Object.entries(flat).map(([key,value])=>[key,shade(value,key)])):flat;
  };
  const defaults=dark&&(Component===NativeText||Component===NativeInput)?{color:'#E4E7EB'}:{};
  return <Component {...props} style={[defaults,map(props.style)]} contentContainerStyle={props.contentContainerStyle?map(props.contentContainerStyle):undefined} placeholderTextColor={Component===NativeInput?(dark?'#B8BEC8':'#777'):undefined}/>;
};
export const Text=themed(NativeText),View=themed(NativeView),TextInput=themed(NativeInput),ScrollView=themed(NativeScroll),TouchableOpacity=themed(NativeTouch),SafeAreaView=themed(NativeSafeArea);
