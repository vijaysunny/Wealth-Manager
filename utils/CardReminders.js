import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
export const scheduleCardReminder = async (account,day) => {
  if(!Number.isInteger(day)||day<1||day>31) throw new Error('Due day must be from 1 to 31');
  const {status}=await Notifications.requestPermissionsAsync();
  if(status!=='granted') throw new Error('Notification permission is required');
  const key=`card_reminder_${account.id}`;
  const previous=JSON.parse(await Storage.getItem(key)||'[]');
  for(const id of previous) await Notifications.cancelScheduledNotificationAsync(id);
  const now=new Date(), ids=[];
  for(let offset=0;offset<12;offset++) {
    const due=new Date(now.getFullYear(),now.getMonth()+offset,1,9);
    due.setDate(Math.min(day,new Date(due.getFullYear(),due.getMonth()+1,0).getDate()));
    if(due<=now) continue;
    ids.push(await Notifications.scheduleNotificationAsync({content:{title:'Credit card payment due',body:`Check the ${account.name} bill and make your payment.`,data:{cardId:account.id}},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:due}}));
  }
  await Storage.setItem(key,JSON.stringify(ids));
};
