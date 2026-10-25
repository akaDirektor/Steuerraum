import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
const client=new PublicClientApplication({auth:{clientId:'68ef307f-52fb-4b5f-9b90-5eb4bdbf5dbf',authority:'https://login.microsoftonline.com/ab8e99bd-8256-41fa-89bc-a5ddefc4613c',redirectUri:location.origin+location.pathname,navigateToLoginRequestUrl:false},cache:{cacheLocation:'sessionStorage'}});
const scopes=['https://graph.microsoft.com/Files.ReadWrite'];
let cloudFile=null,cloudAccount=null,etag=null,baseline=null,busy=false,dirty=false,saveTimer=null,conflict=false,configuredPath='';
let initializing=true,authReady=false,needsReauth=false,syncError=false,activity='',lastCloudEvent=null;
const el=id=>document.getElementById(id);
function status(text,error=false){syncError=error;el('cloudStatus').textContent=text;el('cloudStatus').className=error?'cloudError':'';controls();}
function controls(){
const identity=el('cloudIdentity'),indicator=el('cloudSync'),storage=el('storage'),time=el('cloudTimestamp');
const accountName=cloudAccount?.username||cloudAccount?.name||'робочий акаунт';
identity.textContent=initializing?'Перевіряємо вхід Microsoft…':needsReauth?'Потрібен повторний вхід · '+accountName:authReady?'✓ Ви увійшли · '+accountName:cloudAccount?'Перевіряємо доступ · '+accountName:'Ви не увійшли в Microsoft';
identity.className='cloudIdentity '+(authReady&&!needsReauth?'isConnected':needsReauth?'isWarning':'');
let text,tone='isWarning';
if(initializing){text='Перевіряємо підключення';tone='isPending';}
else if(needsReauth){text='Потрібен повторний вхід';}
else if(activity==='load'){text='Завантаження з OneDrive…';tone='isPending';}
else if(activity==='save'){text='Збереження в OneDrive…';tone='isPending';}
else if(conflict){text='Конфлікт версій — зміни лише у браузері';}
else if(syncError){text=dirty?'Не збережено в OneDrive':'Помилка підключення OneDrive';}
else if(dirty){text=cloudFile&&authReady?'Очікує збереження в OneDrive':'Зміни лише у цьому браузері';}
else if(cloudFile&&authReady&&baseline!==null){text='✓ Синхронізовано з OneDrive';tone='isConnected';}
else if(authReady){text='Вхід виконано — реєстр не завантажено';}
else{text='Лише локальна копія · OneDrive не підключено';}
storage.textContent=text;storage.className='syncBadge '+tone;
indicator.textContent=text;indicator.className='cloudSync '+tone;
time.textContent=lastCloudEvent?(lastCloudEvent.kind==='save'?'Останнє збереження в OneDrive: ':'Останнє завантаження з OneDrive: ')+lastCloudEvent.at.toLocaleString('uk-UA'):'У цій сесії обмін із OneDrive ще не підтверджено.';
el('cloudLoad').disabled=initializing||busy||!cloudAccount||!configuredPath||needsReauth;
el('cloudSave').disabled=initializing||busy||!cloudFile||conflict||needsReauth;
el('cloudLogin').hidden=!!cloudAccount&&!needsReauth;
el('cloudLogin').disabled=initializing||busy;
el('cloudLogin').textContent=needsReauth?'Повторно увійти через Microsoft':'Увійти через Microsoft';
el('cloudLogout').hidden=!cloudAccount;
el('cloudLogout').disabled=initializing||busy;
el('cloudSettings').disabled=initializing||busy||!cloudAccount||needsReauth;
}
async function token(){if(!cloudAccount)throw Error('Спершу увійдіть через Microsoft.');try{const result=await client.acquireTokenSilent({account:cloudAccount,scopes});authReady=true;needsReauth=false;controls();return result.accessToken;}catch(e){authReady=false;if(e instanceof InteractionRequiredAuthError){needsReauth=true;status('Сесія Microsoft потребує повторного входу. Локальні дані залишилися у браузері.',true);}controls();throw e;}}
async function graph(path,options={}){const accessToken=await token();const response=await fetch('https://graph.microsoft.com/v1.0'+path,{...options,headers:{Authorization:'Bearer '+accessToken,...options.headers},cache:'no-store'});if(!response.ok){if(response.status===401){authReady=false;needsReauth=true;controls();throw Error('Microsoft просить повторний вхід. Зміни ще не збережено в OneDrive.');}if(response.status===412){conflict=true;throw Error('Реєстр змінився в OneDrive. Локальні зміни збережено в браузері. Експортуйте резервну копію та оновіть реєстр перед повторним збереженням.');}if(response.status===404)throw Error('Файл не знайдено. Перевірте шлях до папки та наявність register-2025.json.');if(response.status===403)throw Error('Microsoft не дозволив доступ. Перевірте дозвіл Files.ReadWrite або зверніться до адміністратора.');throw Error('Помилка OneDrive ('+response.status+').');}return response;}
function accountKey(){return 'steuerraum-cloud-'+cloudAccount.homeAccountId;}
function pathParts(path){const parts=path.trim().replace(/^\/+|\/+$/g,'').split('/');if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||/[\u0000-\u001f]/.test(p)))throw Error('Вкажіть шлях усередині OneDrive через /, без повного URL.');return parts;}
function filePath(){return '/me/drive/root:/'+pathParts(configuredPath).map(encodeURIComponent).join('/')+'/register-2025.json';}
async function loadCloud(ask=true){if(busy)return;if(dirty&&ask&&!confirm('У браузері є незбережені зміни. Оновлення замінить їх даними OneDrive. Спочатку рекомендуємо завантажити резервну копію JSON. Продовжити?'))return;
busy=true;activity='load';controls();status('Завантаження приватного реєстру з OneDrive…');
try{const item=await(await graph(filePath())).json();if(!item.id||!item.eTag||!item['@microsoft.graph.downloadUrl'])throw Error('Не вдалося отримати файл реєстру.');const downloadUrl=new URL(item['@microsoft.graph.downloadUrl']);if(downloadUrl.protocol!=='https:')throw Error('Некоректна адреса завантаження.');const response=await fetch(downloadUrl.href,{cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('Не вдалося завантажити реєстр.');const incoming=validate(await response.json());if(item.size>20*1024*1024)throw Error('Реєстр завеликий.');
if(!originalPersist(incoming))throw Error('Браузер не зберіг реєстр.');cloudFile=item.id;etag=item.eTag;baseline=JSON.stringify(data);dirty=false;localStorage.removeItem(accountKey()+'-dirty');conflict=false;lastCloudEvent={kind:'load',at:new Date()};year=incoming.records[0]?.date.slice(0,4)||year;render();status('Підключено · '+data.records.length+' операцій · '+money(data.records.reduce((s,r)=>s+r.amount,0))+'. Зміни зберігаються автоматично.');}
catch(e){status(e.message||'Не вдалося прочитати реєстр.',true);}finally{busy=false;activity='';controls();}}
async function saveCloud(){if(busy){dirty=true;return;}if(!cloudFile||conflict||!cloudAccount)return;const payload=JSON.stringify(data);if(payload===baseline){dirty=false;controls();return;}busy=true;activity='save';controls();status('Збереження в OneDrive…');
try{const latest=await(await graph('/me/drive/items/'+encodeURIComponent(cloudFile))).json();if(latest.eTag!==etag){conflict=true;throw Error('Реєстр змінився в OneDrive. Автозбереження зупинено. Збережіть локальну JSON-копію й оновіть дані.');}const response=await graph('/me/drive/items/'+encodeURIComponent(cloudFile)+'/content',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:payload});const saved=await response.json();if(!saved.eTag)throw Error('Не отримано підтвердження версії. Оновіть реєстр.');etag=saved.eTag;baseline=payload;lastCloudEvent={kind:'save',at:new Date()};dirty=JSON.stringify(data)!==baseline;if(!dirty)localStorage.removeItem(accountKey()+'-dirty');status(dirty?'Частину змін збережено. Нові зміни очікують синхронізації.':'✓ Усі поточні зміни збережено в OneDrive.');}catch(e){dirty=true;status(e.message||'Не збережено в OneDrive. Локальна копія залишилася у браузері.',true);}finally{busy=false;activity='';controls();if(dirty&&!conflict&&JSON.stringify(data)!==payload)queueSave();}}
function queueSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveCloud,900);}
const originalPersist=persist;
persist=function(next){const result=originalPersist(next);if(result){dirty=true;if(cloudAccount)localStorage.setItem(accountKey()+'-dirty','1');controls();if(cloudFile&&!conflict)queueSave();else status('Зміни збережено лише у браузері. Підключіть і завантажте реєстр OneDrive перед синхронізацією.');}return result;};
window.addEventListener('beforeunload',e=>{if(dirty&&cloudAccount){e.preventDefault();e.returnValue='';}});
el('cloudLogin').onclick=async()=>{try{await client.loginRedirect({scopes,prompt:'select_account'});}catch(e){status(e.message,true);}};
el('cloudSettings').onclick=()=>{if(!cloudAccount){status('Спершу увійдіть через Microsoft.',true);return;}const path=prompt('Шлях до папки в OneDrive (через /). Файл register-2025.json має бути всередині цієї папки.',configuredPath);if(path===null)return;try{pathParts(path);configuredPath=path.trim().replace(/^\/+|\/+$/g,'');localStorage.setItem(accountKey(),configuredPath);cloudFile=null;etag=null;baseline=null;conflict=false;controls();loadCloud();}catch(e){status(e.message,true);}};
el('cloudLoad').onclick=()=>loadCloud();
el('cloudSave').onclick=()=>saveCloud();
el('cloudLogout').onclick=async()=>{if(dirty&&!confirm('Є зміни, не збережені в OneDrive. Вийти й залишити їх у браузері?'))return;clearTimeout(saveTimer);cloudFile=null;etag=null;baseline=null;cloudAccount=null;authReady=false;lastCloudEvent=null;controls();await client.logoutRedirect({postLogoutRedirectUri:location.origin+location.pathname});};
async function init(){controls();try{await client.initialize();const result=await client.handleRedirectPromise();cloudAccount=result?.account||client.getActiveAccount()||client.getAllAccounts()[0]||null;initializing=false;if(cloudAccount){client.setActiveAccount(cloudAccount);configuredPath=localStorage.getItem(accountKey())||'';controls();await token();if(configuredPath&&localStorage.getItem(accountKey()+'-dirty')){dirty=true;status('У браузері є зміни, не підтверджені OneDrive. Збережіть JSON-резервну копію перед оновленням реєстру.',true);}else if(configuredPath)await loadCloud(false);else status('Вхід Microsoft підтверджено. Натисніть «Налаштувати папку», щоб завантажити реєстр.');}else status('Ви не увійшли. Дані на екрані можуть бути локальною копією; збереження в OneDrive не підключено.');}catch(e){status('Не вдалося підтвердити вхід Microsoft: '+(e.errorMessage||e.message),true);}finally{initializing=false;controls();}}
init();
