import {DrawingEngine} from './engine.mjs';
import {GestureState} from './gesture-state.mjs';
const $=id=>document.getElementById(id);
const cameraFrame=document.querySelector('.camera-frame');
document.querySelector('.canvas-space').prepend(cameraFrame);
const matrices=document.createElement('section');matrices.className='matrices';matrices.innerHTML='<section class="card"><h2>▧ Confusion Matrix — SVM</h2><div id="svmMatrix" class="matrix">Train with two takes to see results.</div></section><section class="card"><h2>▧ Confusion Matrix — Random Forest</h2><div id="rfMatrix" class="matrix">Train with two takes to see results.</div></section>';
document.querySelector('.board-column').append(matrices);
$('homeButton').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
$('headerExport').onclick=()=>$('export').click();
$('exampleGuide').onclick=()=>$('help').click();
const engine=new DrawingEngine(), temporal=new GestureState();
const colors={Black:'#172033',Red:'#e84f62',Blue:'#4667ee',Green:'#159879',Yellow:'#e9b52b',Purple:'#8b5cf6',Orange:'#ef883c',Pink:'#dc5caa'};
const poses={draw:'☝ Index up',erase:'✊ Fist',clear:'🖐 Open palm',select:'🤏 Pinch',pointer:'✌ Two fingers',confirm:'👍 Thumbs up',idle:'🫳 Relaxed hand'};
const algorithms={svm:'SVM',random_forest:'Random Forest'};
let selectedAlgorithm='svm';
const defaults={confidence:.8,smoothing:.4,showLandmarks:true,highContrast:false,cameraSelect:''};
let settings={...defaults},samples=[],modelId=null,stream=null,tracker=null,gestureEnabled=false;
let tool='pen',pointerDown=false,gestureDrawing=false,gestureErasing=false,lastLandmarks=null,lastSeen=0;
let capture=null,frameBusy=false,lastVideoTime=-1,lastInference=0,raf=null,cameraGeneration=0;
let chatHistory=[],lastAnswer='',recognition=null,voiceActive=false,dwellTarget=null,dwellSince=0;
function notify(text){$('notice').textContent=text;}
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{notify('Browser storage is full or unavailable. Download your board before closing.');return false;}}
async function api(path,body,raw=false){
  const response=await fetch('/api/'+path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(path==='tutor'?100000:path.startsWith('train')?120000:15000)});
  if(!response.ok){let detail;try{detail=(await response.json()).detail;}catch{detail=response.statusText;}throw new Error(typeof detail==='string'?detail:'Invalid data. Check the inputs and try again.');}
  return raw?response.blob():response.json();
}
function save(){const ok=writeLocal('air-board',engine.state);$('saveStatus').textContent=ok?'Saved on this browser':'Not saved — export now';}
function repaint(){engine.paint($('canvas'));$('empty').hidden=engine.state.strokes.length>0;$('strokeCount').textContent=`${engine.state.strokes.length} strokes`;$('size').value=engine.state.width;$('sizeValue').textContent=engine.state.width;$('brushDot').style.cssText=`width:${engine.state.width}px;height:${engine.state.width}px;background:${engine.state.color}`;$('undo').disabled=!engine.past.length;$('redo').disabled=!engine.future.length;document.querySelectorAll('.swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===engine.state.color));}
function finish(){engine.commit();gestureDrawing=false;gestureErasing=false;pointerDown=false;repaint();save();}
function setTool(value){finish();tool=value;$('pen').classList.toggle('active',tool==='pen');$('eraser').classList.toggle('active',tool==='eraser');notify(`${tool==='pen'?'Pen':'Eraser'} selected`);}
function setColor(value){engine.change('color',value);$('customColor').value=value;repaint();save();}
function setSize(value){engine.change('width',Math.max(1,Math.min(40,value)));repaint();save();}
function openDialog(id){finish();document.querySelectorAll('dialog[open]').forEach(d=>d.close());$(id).showModal();}
function requestClear(){openDialog('clearDialog');}
function confirmClear(){if(!$('clearDialog').open)return;engine.clear();$('clearDialog').close();repaint();save();notify('Canvas cleared. Undo is available.');}
function pointFromEvent(e){const r=$('canvas').getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
function boardData(){return {strokes:engine.state.strokes};}
async function download(kind='png'){
  finish();try{const blob=await api('export/'+kind,boardData(),true);downloadBlob(blob,`air-canvas-${new Date().toISOString().slice(0,10)}.${kind}`);notify(`${kind.toUpperCase()} exported`);}catch(e){notify(e.message);}
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

for(const [name,color] of Object.entries(colors))for(const id of ['palette','gesturePalette']){
  const b=document.createElement('button');b.className='swatch';b.style.background=color;b.dataset.color=color;b.title=name;b.setAttribute('aria-label',name+' ink');
  if(id==='gesturePalette')b.dataset.dwell='';b.onclick=()=>{setColor(color);if(id==='gesturePalette')$('actionMenu').close();};$(id).append(b);
}
$('canvas').addEventListener('pointerdown',e=>{if(e.button!==0)return;finish();pointerDown=true;$('canvas').setPointerCapture(e.pointerId);const p=pointFromEvent(e);if(tool==='pen')engine.start(p);else engine.erase(p);repaint();});
$('canvas').addEventListener('pointermove',e=>{if(!pointerDown)return;const p=pointFromEvent(e);tool==='pen'?engine.add(p):engine.erase(p);repaint();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('canvas').addEventListener(event,()=>{if(pointerDown)finish();});
$('pen').onclick=()=>setTool('pen');$('eraser').onclick=()=>setTool('eraser');
$('customColor').oninput=e=>setColor(e.target.value);$('size').onchange=e=>setSize(+e.target.value);
$('undo').onclick=()=>{engine.undo();repaint();save();};$('redo').onclick=()=>{engine.redo();repaint();save();};
$('clear').onclick=requestClear;$('newBoard').onclick=requestClear;$('confirmClear').onclick=confirmClear;
$('export').onclick=()=>download($('format').value);$('help').onclick=()=>openDialog('guide');
$('demo').onclick=()=>document.body.classList.toggle('present');
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{capture=null;temporal.reset();resetDwell();}));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){document.body.classList.remove('present');finish();return;}
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?$('redo').click():$('undo').click();}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();$('redo').click();}
  else if(e.key.toLowerCase()==='p')setTool('pen');else if(e.key.toLowerCase()==='e')setTool('eraser');
});
new ResizeObserver(()=>{const r=$('canvas').getBoundingClientRect();$('canvas').width=Math.round(r.width*devicePixelRatio);$('canvas').height=Math.round(r.height*devicePixelRatio);repaint();}).observe($('board'));

function applySettings(){for(const key of Object.keys(defaults)){const el=$(key);if(el.type==='checkbox')el.checked=settings[key];else el.value=settings[key];}document.body.classList.toggle('contrast',settings.highContrast);}
$('settingsButton').onclick=()=>openDialog('settings');
for(const key of Object.keys(defaults))$(key).onchange=e=>{settings[key]=e.target.type==='checkbox'?e.target.checked:e.target.type==='range'?+e.target.value:e.target.value;writeLocal('air-settings',settings);applySettings();};
$('resetSettings').onclick=()=>{settings={...defaults};writeLocal('air-settings',settings);applySettings();};

function renderPoseButtons(){
  $('poseList').replaceChildren();for(const [label,name] of Object.entries(poses)){
    const count=samples.filter(s=>s.label===label).length,b=document.createElement('button');
    b.textContent=`${name} · ${count}/40 samples`;b.disabled=$('train').disabled;b.onclick=()=>{
      if(!stream){$('captureStatus').textContent='Start the camera before recording.';return;}
      samples=samples.filter(s=>s.label!==label||s.take===0);
      const take=samples.filter(s=>s.label===label).length>=20?1:0;
      capture={label,take,count:0,start:performance.now()+2500,last:0};
      $('captureStatus').textContent=`Prepare ${name}. Recording starts in 2.5 seconds…`;
    };$('poseList').append(b);
  }
}
$('calibrate').onclick=()=>{renderPoseButtons();openDialog('calibration');};
$('downloadSamples').onclick=()=>downloadBlob(new Blob([JSON.stringify({version:1,samples},null,2)],{type:'application/json'}),'air-canvas-gestures.json');
async function train(){
  if($('train').disabled)return;
  invalidateModel();$('train').disabled=true;$('algorithm').disabled=true;capture=null;renderPoseButtons();
  const algorithm=selectedAlgorithm;
  $('captureStatus').textContent=`Training ${algorithms[algorithm]} on your samples…`;
  try{
    const result=await api('train-comparison',{algorithm,samples});
    if(result.algorithm!==algorithm)throw new Error('The server is running an older version. Restart Air Canvas to use SVM and Random Forest.');
    renderEvaluation(result.evaluation);modelId=result.model_id;resetPredictions('Ready — start camera');$('modelBadge').textContent=`${algorithms[algorithm]} · ${samples.length} samples`;
    $('toggleGesture').disabled=false;$('captureStatus').textContent=`Both models trained. ${algorithms[algorithm]} controls drawing. Close this panel and enable gestures.`;
    writeLocal('air-samples',samples);notify(`Your ${algorithms[algorithm]} model is ready. Enable gestures to use it.`);
  }catch(e){$('captureStatus').textContent=e.message;notify(e.message);}
  finally{$('train').disabled=false;$('algorithm').disabled=false;renderPoseButtons();}
}
function resetPredictions(message){for(const prefix of ['svm','rf']){$(prefix+'Prediction').textContent=message;$(prefix+'Confidence').textContent='Confidence: —';$(prefix+'Progress').value=0;}$('detectedGesture').textContent=message;}
function invalidateModel(){
  resetPredictions('Not trained');
  finish();temporal.reset();modelId=null;gestureEnabled=false;
  $('toggleGesture').disabled=true;$('toggleGesture').textContent='Enable gestures';$('mode').textContent='Pointer input';
  $('modelBadge').textContent=`${algorithms[selectedAlgorithm]} · Not calibrated`;
}
$('algorithm').onchange=()=>{
  selectedAlgorithm=$('algorithm').value;writeLocal('air-algorithm',selectedAlgorithm);invalidateModel();
  $('train').textContent='Train SVM + Random Forest';
  $('captureStatus').textContent='Samples are retained. Click Train to use the selected model.';
};
$('train').onclick=train;
$('toggleGesture').onclick=()=>{gestureEnabled=!gestureEnabled;finish();temporal.reset();$('toggleGesture').textContent=gestureEnabled?'Pause gestures':'Enable gestures';$('mode').textContent=gestureEnabled?`${algorithms[selectedAlgorithm]} gesture input`:'Pointer input';};

async function startCamera(){
  const generation=++cameraGeneration;$('camera').disabled=true;
  try{
    notify('Requesting webcam access and loading the hand detector…');
    stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},...(settings.cameraSelect?{deviceId:{exact:settings.cameraSelect}}:{})},audio:false});
    document.body.classList.add('camera-active');$('video').srcObject=stream;await $('video').play();
    if(!tracker){
      const {HandLandmarker,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
      const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
      tracker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.6,minTrackingConfidence:.6});
    }
    if(generation!==cameraGeneration)return;
    $('camera').textContent='◉ Stop camera';$('cameraPlaceholder').hidden=true;
    const devices=await navigator.mediaDevices.enumerateDevices();$('cameraSelect').replaceChildren(new Option('Default camera',''));
    for(const d of devices.filter(d=>d.kind==='videoinput'))$('cameraSelect').add(new Option(d.label||'Camera',d.deviceId));$('cameraSelect').value=settings.cameraSelect;
    notify(modelId?'Camera active. Enable gestures to draw.':'Camera active. Select Train gestures to calibrate your model.');lastVideoTime=-1;raf=requestAnimationFrame(tick);
  }catch(e){stopCamera();notify(e.name==='NotAllowedError'?'Camera permission denied. Allow camera access in your browser; pointer drawing is still available.':`Camera or hand detector unavailable: ${e.message}. Pointer drawing is still available.`);}
  finally{$('camera').disabled=false;}
}
function stopCamera(){
  document.body.classList.remove('camera-active');resetPredictions(modelId?'Ready — camera off':'Not trained');
  cameraGeneration++;if(raf)cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;lastLandmarks=null;capture=null;finish();temporal.reset();
  $('camera').textContent='◉ Start camera';$('cameraPlaceholder').hidden=false;$('gesture').textContent='Camera off';$('trackingMessage').textContent='Pointer drawing remains available.';$('cursor').hidden=true;
  $('landmarks').getContext('2d').clearRect(0,0,$('landmarks').width,$('landmarks').height);
}
$('camera').onclick=()=>stream?stopCamera():startCamera();
function resetDwell(){dwellTarget?.classList.remove('dwelling');dwellTarget=null;dwellSince=0;}
function dwell(p,now){
  const dialog=document.querySelector('dialog[open]');if(!dialog||!['actionMenu','clearDialog'].includes(dialog.id)){resetDwell();return;}
  const r=dialog.getBoundingClientRect(),x=r.left+p[0]*r.width,y=r.top+p[1]*r.height;
  const target=document.elementFromPoint(x,y)?.closest('[data-dwell]');
  if(target!==dwellTarget){resetDwell();dwellTarget=target;dwellSince=now;target?.classList.add('dwelling');}
  if(target&&now-dwellSince>900){target.click();resetDwell();}
}
function processGesture(result,landmarks,now){
  for(const [key,prefix] of [['svm','svm'],['random_forest','rf']]){const prediction=result.comparison?.[key];if(prediction){$(prefix+'Prediction').textContent=poses[prediction.gesture];$(prefix+'Confidence').textContent='Confidence: '+Math.round(prediction.confidence*100)+'%';$(prefix+'Progress').value=prediction.confidence;}}
  $('detectedGesture').textContent=poses[result.gesture];
  const state=temporal.update(result.gesture,result.confidence,now,settings.confidence);
  const action=state.gesture==='draw'&&tool==='eraser'?'erase':state.gesture;
  const raw=landmarks[result.gesture==='erase'?9:8],p=temporal.point([1-raw[0],raw[1]],settings.smoothing).map(v=>Math.max(0,Math.min(1,v)));
  $('gesture').textContent=`${state.gesture.toUpperCase()} · ${Math.round(result.confidence*100)}%`;
  $('holdProgress').value=state.progress;$('trackingMessage').textContent=`Hand detected · Python ${algorithms[result.algorithm]} prediction`;
  $('cursor').hidden=false;$('cursor').style.left=`${p[0]*100}%`;$('cursor').style.top=`${p[1]*100}%`;
  if(!gestureEnabled||pointerDown){if(gestureDrawing||gestureErasing)finish();return;}
  if(document.querySelector('dialog[open]')){
    if(gestureDrawing||gestureErasing)finish();
    if(state.gesture==='confirm'&&state.event&&$('clearDialog').open)confirmClear();
    if(['pointer','select','idle'].includes(state.gesture))dwell(p,now);else resetDwell();return;
  }
  if(action!=='draw'&&gestureDrawing)finish();if(action!=='erase'&&gestureErasing)finish();
  if(action==='draw'){
    if(!gestureDrawing){engine.start(p);gestureDrawing=true;}else engine.add(p);repaint();
  }else if(action==='erase'){engine.erase(p);gestureErasing=true;repaint();}
  else if(state.event&&state.gesture==='clear')requestClear();
  else if(state.event&&state.gesture==='select')openDialog('actionMenu');
}
const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
async function tick(now){
  if(!stream)return;
  raf=requestAnimationFrame(tick);
  if(frameBusy||now-lastInference<65||$('video').currentTime===lastVideoTime)return;
  frameBusy=true;lastInference=now;lastVideoTime=$('video').currentTime;const generation=cameraGeneration;
  try{
    const result=tracker.detectForVideo($('video'),now),hand=result.landmarks[0];
    const c=$('landmarks');c.width=320;c.height=240;const ctx=c.getContext('2d');
    if(!hand){resetPredictions('No hand detected');lastLandmarks=null;temporal.reset();resetDwell();if(gestureDrawing||gestureErasing)finish();$('cursor').hidden=true;$('gesture').textContent='Looking for your hand';$('trackingMessage').textContent='Move one hand into the camera frame.';return;}
    lastLandmarks=hand.map(p=>[p.x,p.y,p.z]);lastSeen=now;
    if(settings.showLandmarks){ctx.strokeStyle='#86e6c3';ctx.lineWidth=2;for(const [a,b]of connections){ctx.beginPath();ctx.moveTo((1-hand[a].x)*320,hand[a].y*240);ctx.lineTo((1-hand[b].x)*320,hand[b].y*240);ctx.stroke();}ctx.fillStyle='#fff';for(const p of hand){ctx.beginPath();ctx.arc((1-p.x)*320,p.y*240,2,0,Math.PI*2);ctx.fill();}}
    if(capture&&now>=capture.start&&now-capture.last>110){
      samples.push({label:capture.label,landmarks:lastLandmarks,take:capture.take});capture.last=now;capture.count++;
      $('captureStatus').textContent=`Recording ${poses[capture.label]}: ${capture.count}/20. Move slightly.`;
      if(capture.count>=20){capture=null;writeLocal('air-samples',samples);renderPoseButtons();$('captureStatus').textContent='Take saved. Record a second take, then continue to the next pose.';}return;
    }
    if(modelId&&!$('calibration').open){
      const requestedModel=modelId;
      const prediction=await api('gesture',{model_id:requestedModel,landmarks:lastLandmarks});
      if(generation===cameraGeneration&&stream&&modelId===requestedModel)processGesture(prediction,lastLandmarks,performance.now());
    }else{$('gesture').textContent='Hand detected';$('trackingMessage').textContent='Calibrate seven poses to train your gesture classifier.';}
  }catch(e){if(gestureDrawing||gestureErasing)finish();temporal.reset();$('trackingMessage').textContent=e.message;if(e.message.includes('expired'))invalidateModel();}
  finally{frameBusy=false;}
}
setInterval(()=>{if(stream&&performance.now()-lastSeen>600){if(gestureDrawing||gestureErasing)finish();temporal.reset();$('cursor').hidden=true;}},250);
document.addEventListener('visibilitychange',()=>{if(document.hidden){finish();temporal.reset();}});
window.addEventListener('pagehide',()=>{stopCamera();recognition?.stop();});

function appendMessage(text,role){const d=document.createElement('div');d.className='message '+role;d.textContent=text;$('chat').append(d);$('chat').scrollTop=$('chat').scrollHeight;}
async function ask(question){
  if(!question.trim()||$('send').disabled)return;
  finish();$('send').disabled=true;appendMessage(question,'user');$('question').value='';
  try{const result=await api('tutor',{question,...boardData(),history:chatHistory.slice(-12)});lastAnswer=result.answer;appendMessage(lastAnswer,'assistant');chatHistory.push({role:'user',content:question},{role:'assistant',content:lastAnswer});}
  catch(e){appendMessage(e.message,'error');}finally{$('send').disabled=false;}
}
$('chatForm').onsubmit=e=>{e.preventDefault();ask($('question').value);};
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>ask(b.dataset.question));
$('clearChat').onclick=()=>{chatHistory=[];lastAnswer='';$('chat').replaceChildren();};
$('readAnswer').onclick=()=>{if(!('speechSynthesis'in window)){notify('Read aloud is not supported by this browser.');return;}if(lastAnswer){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(lastAnswer));}};
async function execute(intent,parameter,text){
  switch(intent){
    case 'undo':$('undo').click();break;case 'redo':$('redo').click();break;
    case 'clear':requestClear();break;case 'confirm':confirmClear();break;
    case 'cancel':document.querySelectorAll('dialog[open]').forEach(d=>d.close());break;
    case 'pen':case 'eraser':setTool(intent);break;
    case 'color':setColor(parameter);break;case 'thicker':setSize(engine.state.width+3);break;case 'thinner':setSize(engine.state.width-3);break;
    case 'export':await download(parameter||'png');break;
    case 'tutor':await ask(text||'Explain my drawing step by step.');break;
    default:notify('Command not recognized. Try “undo”, “use eraser”, or “change color to blue”.');return;
  }
}
async function runCommand(text){try{const result=await api('voice',{text});notify(`“${text}” → ${result.intent} · ${result.algorithm_name} ${Math.round(result.confidence*100)}%`);await execute(result.intent,result.parameter,text);}catch(e){notify(e.message);}}
$('commandForm').onsubmit=e=>{e.preventDefault();if($('command').value.trim())runCommand($('command').value);};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{$('actionMenu').close();execute(b.dataset.action,null,null);});
$('voice').onclick=()=>{
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){notify('Voice recognition is unavailable in this browser. Type commands in the command box.');return;}
  if(voiceActive){recognition.stop();return;}
  recognition=new SpeechRecognition();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=false;
  recognition.onstart=()=>{voiceActive=true;$('voice').textContent='Stop listening';notify('Listening. Your browser may send speech to its recognition service.');};
  recognition.onend=()=>{voiceActive=false;$('voice').textContent='Start voice';};
  recognition.onerror=e=>notify(`Voice recognition: ${e.error}. You can type commands instead.`);
  recognition.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)runCommand(e.results[i][0].transcript);};
  try{recognition.start();}catch(e){notify(e.message);}
};

settings={...defaults,...readLocal('air-settings',{})};applySettings();
const saved=readLocal('air-board',null);
if(saved&&Array.isArray(saved.strokes)&&/^#[0-9a-f]{6}$/i.test(saved.color)&&Number.isFinite(saved.width)){
  try{engine.state=saved;repaint();}catch{engine.state={strokes:[],color:'#4667ee',width:5};notify('Could not restore the saved board.');}
}
samples=readLocal('air-samples',[]);if(!Array.isArray(samples))samples=[];
const savedAlgorithm=readLocal('air-algorithm','svm');
selectedAlgorithm=Object.hasOwn(algorithms,savedAlgorithm)?savedAlgorithm:'svm';
$('algorithm').value=selectedAlgorithm;$('train').textContent='Train SVM + Random Forest';
$('modelBadge').textContent=`${algorithms[selectedAlgorithm]} · Not calibrated`;
renderPoseButtons();repaint();
if(Object.keys(poses).every(label=>samples.filter(s=>s.label===label).length>=15))train();
api('status').catch(()=>notify('Python server is unavailable. Restart it to use ML, AI, or exports.'));
if(!readLocal('air-onboarded',false)){openDialog('guide');$('guide').addEventListener('close',()=>writeLocal('air-onboarded',true),{once:true});}

function renderEvaluation(evaluation){
  $('svmRole').textContent=selectedAlgorithm==='svm'?'(Primary)':'';
  $('rfRole').textContent=selectedAlgorithm==='random_forest'?'(Primary)':'';
  $('evaluationNote').textContent=evaluation.note;
  if(!evaluation.results)return;
  const labels=evaluation.labels,short={draw:'Draw',erase:'Erase',clear:'Clear',select:'Pinch',pointer:'Point',confirm:'Yes',idle:'Idle'};
  for(const [algorithm,id] of [['svm','svmMatrix'],['random_forest','rfMatrix']]){
    const matrix=evaluation.results[algorithm].confusion_matrix,table=document.createElement('table');
    const caption=document.createElement('caption');caption.textContent='Actual ↓ / Predicted → · row %';table.append(caption);
    const heading=document.createElement('tr');for(const text of ['',...labels.map(x=>short[x])]){const cell=document.createElement('th');cell.textContent=text;heading.append(cell);}table.append(heading);
    matrix.forEach((row,i)=>{const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=short[labels[i]];tr.append(th);const total=row.reduce((a,b)=>a+b,0);row.forEach(count=>{const td=document.createElement('td'),value=total?count/total:0;td.textContent=Math.round(value*100);td.style.background=algorithm==='svm'?`rgba(139,64,235,${.08+value*.85})`:`rgba(224,65,165,${.08+value*.85})`;td.style.color=value>.5?'white':'#514768';tr.append(td);});table.append(tr);});$(id).replaceChildren(table);
  }
  $('comparisonChart').replaceChildren();
  for(const label of labels){const group=document.createElement('div');group.className='bar-group';for(const algorithm of ['svm','random_forest']){const recall=evaluation.results[algorithm].classification_report[label].recall;const bar=document.createElement('div');bar.className='bar '+algorithm;bar.style.height=`${recall*100}%`;bar.title=`${algorithms[algorithm]} ${short[label]} recall: ${Math.round(recall*100)}%`;const value=document.createElement('span');value.textContent=Math.round(recall*100);bar.append(value);group.append(bar);}const name=document.createElement('small');name.textContent=short[label];group.append(name);$('comparisonChart').append(group);}
}
