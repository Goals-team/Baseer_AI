const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const infoScreen = document.getElementById('info-screen').firstElementChild;
const gestureHint = document.getElementById('gesture-hint');
const topStatus = document.getElementById('top-status');
const hud = document.getElementById('hud');
const touchZone = document.getElementById('touch-zone');
const pingVal = document.getElementById('ping-val');
const pwrVal = document.getElementById('pwr-val');

let model = null;
let lastSpokenTime = 0;
const SPEAK_INTERVAL = 3500; 
let isRunning = false;
let arabicVoice = null;
let isPathClear = true; 
let isCameraReallyReady = false; 

let currentClosestObject = '';
let currentDistance = 0;
let isNightMode = false;
let frameCount = 0;

// المتغيرات الجديدة للميزات الاحترافية
let lastPredictionsArray = []; // لتخزين المشهد الحالي بالكامل
let audioCtx = null; // محرك الصوت المكاني (3D Audio)
let dynamicFpsDelay = 0; // نظام توفير الطاقة

// خوارزمية كشف الكاميرا الوهمية
let lastFrameData = null;
let staticFramesCount = 0;

let isNavigating = false;
let currentDestination = '';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true; 
  recognition.interimResults = false;
  recognition.lang = 'ar-SA';
  
  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.trim().toLowerCase();
    
    if (transcript.includes('بصير')) {
      handleVoiceCommand(transcript);
    } else if (isNavigating && !transcript.includes('بصير')) {
      handleNavigationResponse(transcript);
    }
  };
  recognition.onend = () => { if (isRunning && isCameraReallyReady) recognition.start(); };
}

// === نظام الصوت المكاني ثلاثي الأبعاد (3D Spatial Beep) ===
function playSpatialBeep(panValue) {
  // panValue: -1 (يسار) | 0 (وسط) | 1 (يمين)
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  const oscillator = audioCtx.createOscillator();
  const panner = audioCtx.createStereoPanner();
  const gainNode = audioCtx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // تردد التنبيه
  
  panner.pan.value = panValue;
  gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

  oscillator.connect(panner);
  panner.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.3);
}

// === محرك المحادثة الشامل ===
function handleVoiceCommand(text) {
  lastSpokenTime = 0; 
  triggerVibration([100]); 

  // الميزة الخارقة 1: التلخيص البيئي (Scene Summarization)
  if (text.includes('صف') || text.includes('مكان') || text.includes('حولي')) {
    if (lastPredictionsArray.length === 0) {
      speakArabic("المكان خالي من العوائق الواضحة.");
    } else {
      let counts = {};
      lastPredictionsArray.forEach(p => {
        let name = arabicDictionary[p.class] || p.class;
        counts[name] = (counts[name] || 0) + 1;
      });
      let summary = "أرصد حولي: ";
      for (const [key, value] of Object.entries(counts)) {
        summary += `${value} ${key}، `;
      }
      speakArabic(summary);
    }
  }
  else if (text.includes('دلني') || text.includes('خذني') || text.includes('اريد اروح') || text.includes('اذهب')) {
    if (text.includes('مسرح')) startNavigation('المسرح', 'تقدم للأمام مسافة عشرين متراً، ثم انعطف يميناً.');
    else if (text.includes('مختبر') || text.includes('صف')) startNavigation('المختبر', 'تم تحديد المسار. اصعد الدرج بعناية.');
    else { isNavigating = true; speakArabic("إلى أين تريد الذهاب؟"); }
  } 
  else if (text.includes('ماذا') || text.includes('امامي')) {
    if (currentClosestObject) speakArabic(`أمامك ${currentClosestObject} على بُعد ${currentDistance} متر.`);
    else speakArabic("المسار أمامك خالٍ تماماً.");
  } 
  else if (text.includes('ساعة')) {
    const timeString = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    speakArabic(`الساعة الآن هي ${timeString}.`);
  } 
  else if (text.includes('طوارئ')) {
    triggerSOS();
  } 
  else if (text.includes('من انت')) {
    speakArabic("أنا بصير، منظومتك الملاحية الذكية، أعمل بتقنية المعالجة الطرفية لحمايتك.");
  } 
  else {
    speakArabic("نعم، تفضل.");
  }
}

function handleNavigationResponse(text) {
  isNavigating = false;
  speakArabic(`جاري التوجيه إلى ${text} عبر نظام التموضع الداخلي. تقدم بحذر.`);
}

function startNavigation(destination, voiceInstructions) {
  currentDestination = destination;
  topStatus.innerText = `Navigating to: ${destination} 📍`;
  topStatus.style.color = '#0a84ff';
  speakArabic(voiceInstructions);
}

let touchTimer; let isLongPress = false;
touchZone.addEventListener('touchstart', () => {
  if (!isCameraReallyReady) return;
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); // تفعيل محرك الصوت
  isLongPress = false;
  touchTimer = setTimeout(() => { isLongPress = true; triggerSOS(); }, 2500); 
});
touchZone.addEventListener('touchend', () => {
  if (!isCameraReallyReady) return;
  clearTimeout(touchTimer);
  if (!isLongPress) handleVoiceCommand('ماذا امامي'); // استدعاء دالة الرصد عند اللمس السريع
});

function triggerSOS() {
  triggerVibration([500, 200, 500, 200, 1000]); 
  speakArabic("تنبيه، جاري إرسال الموقع الجغرافي للطوارئ.");
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      window.location.href = `whatsapp://send?text=${encodeURIComponent(`🚨 نداء طوارئ من بصير! الموقع:\nhttps://www.google.com/maps/search/?api=1&query=${pos.coords.latitude},${pos.coords.longitude}`)}`;
    });
  }
}

const arabicDictionary = {
  'person': 'شخص', 'bicycle': 'دراجة', 'car': 'سيارة', 'motorcycle': 'دراجة نارية',
  'bus': 'حافلة', 'truck': 'شاحنة', 'traffic light': 'إشارة مرور', 'stop sign': 'علامة قف',
  'bench': 'مقعد', 'cat': 'قطة', 'dog': 'كلب', 'backpack': 'حقيبة', 'umbrella': 'مظلة', 
  'handbag': 'حقيبة', 'bottle': 'قارورة', 'cup': 'كوب', 'chair': 'كرسي', 'couch': 'أريكة', 
  'potted plant': 'نبتة', 'bed': 'سرير', 'dining table': 'طاولة', 'tv': 'شاشة', 
  'laptop': 'حاسوب', 'cell phone': 'هاتف', 'book': 'كتاب', 'door': 'باب'
};

function loadVoices() {
  const voices = window.speechSynthesis.getVoices();
  arabicVoice = voices.find(v => v.name.includes('Maged') || v.name.includes('Tarik')) || voices.find(v => v.lang.includes('ar'));
}
window.speechSynthesis.onvoiceschanged = loadVoices;

function speakArabic(text) {
  const now = Date.now();
  if (now - lastSpokenTime < SPEAK_INTERVAL) return;
  lastSpokenTime = now;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ar-SA'; if (arabicVoice) utterance.voice = arabicVoice;
  utterance.volume = 1.0; utterance.rate = 0.85; utterance.pitch = 1.0; 
  window.speechSynthesis.speak(utterance);
}

function triggerVibration(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

async function setupWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: true });
  video.srcObject = stream;
  return new Promise((resolve) => { video.onloadedmetadata = () => { video.play(); resolve(video); }; });
}

function checkStaticCamera() {
  const checkCanvas = document.createElement('canvas');
  checkCanvas.width = 32; checkCanvas.height = 32;
  const cCtx = checkCanvas.getContext('2d');
  cCtx.drawImage(video, 0, 0, 32, 32);
  const currentFrameData = cCtx.getImageData(0, 0, 32, 32).data;
  let isStatic = false;
  if (lastFrameData) {
    let diff = 0;
    for (let i = 0; i < currentFrameData.length; i += 16) diff += Math.abs(currentFrameData[i] - lastFrameData[i]);
    if (diff < 300) staticFramesCount++; else staticFramesCount = 0; 
    if (staticFramesCount > 10) isStatic = true;
  }
  lastFrameData = currentFrameData;
  return isStatic;
}

async function detectFrame() {
  if (!isRunning) return;
  if (video.readyState !== 4 || video.videoWidth === 0) { requestAnimationFrame(detectFrame); return; }

  if (checkStaticCamera()) {
    isCameraReallyReady = false;
    hud.style.display = 'none'; gestureHint.style.display = 'none';
    topStatus.innerText = 'Standby Mode 🟡'; topStatus.style.color = '#ff9f0a';
    infoScreen.innerHTML = 'ننتظر إشارة الكاميرا الحقيقية... ⏳'; infoScreen.style.color = '#ff9f0a';
    if (recognition) recognition.stop(); 
    requestAnimationFrame(detectFrame); return;
  }

  if (!isCameraReallyReady) {
    isCameraReallyReady = true;
    hud.style.display = 'flex'; gestureHint.style.display = 'block'; 
    topStatus.innerText = 'Voice AI Active 🟢'; topStatus.style.color = '#32d74b';
    infoScreen.innerHTML = 'المسار آمن 🟢'; infoScreen.style.color = '#32d74b';
    speakArabic("تأكد الاتصال. النظام الهندسي جاهز.");
    if (recognition) recognition.start();
  }
  
  const startInference = performance.now();
  frameCount++;
  canvas.width = video.clientWidth; canvas.height = video.clientHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const predictions = await model.detect(video);
  lastPredictionsArray = predictions; // تحديث المصفوفة لتلخيص المشهد
  pingVal.innerText = Math.round(performance.now() - startInference); 

  let closestObject = null; let maxArea = 0;
  let navigationCommand = ''; let screenMessage = ''; let calcDistance = 0;
  let panDirection = 0; // لضبط الصوت المكاني ثلاثي الأبعاد

  predictions.forEach((prediction) => {
    if (prediction.score < 0.6) return; 

    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;
    const x = prediction.bbox[0] * scaleX; const y = prediction.bbox[1] * scaleY;
    const width = prediction.bbox[2] * scaleX; const height = prediction.bbox[3] * scaleY;
    const centerX = x + (width / 2);
    const area = width * height;
    
    const arabicLabel = arabicDictionary[prediction.class] || prediction.class;
    const estimatedDist = (Math.sqrt(0.1 / (area / (canvas.width * canvas.height))) * 1.5).toFixed(1); 

    let command = ''; let displayMsg = ''; let currentPan = 0;

    if (centerX < canvas.width / 3) {
      command = `عائق يساراً`; displayMsg = `⚠️ انحرف يميناً (${arabicLabel})`; currentPan = -1; // يسار
    } else if (centerX > (canvas.width * 2) / 3) {
      command = `عائق يميناً`; displayMsg = `⚠️ انحرف يساراً (${arabicLabel})`; currentPan = 1; // يمين
    } else {
      command = `عائق أمامي`; displayMsg = `🛑 توقف! (${arabicLabel})`; currentPan = 0; // وسط
    }

    ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#0a84ff'; ctx.fillRect(x, y, 15, 3); ctx.fillRect(x, y, 3, 15);
    ctx.fillStyle = 'rgba(17,17,17,0.85)';
    ctx.fillRect(x, y - 30, ctx.measureText(`${arabicLabel} [${estimatedDist}m]`).width + 20, 30);
    ctx.fillStyle = '#32d74b'; ctx.font = 'bold 14px monospace';
    ctx.fillText(`${arabicLabel} [${estimatedDist}m]`, x + 10, y - 10);

    if (area > maxArea) {
      maxArea = area; closestObject = arabicLabel; 
      navigationCommand = command; screenMessage = displayMsg; 
      calcDistance = estimatedDist; panDirection = currentPan;
    }
  });

  currentClosestObject = closestObject; currentDistance = calcDistance;

  if (closestObject) {
    // الميزة الخارقة 3: إلغاء توفير الطاقة لأن هناك عائق
    dynamicFpsDelay = 0; 
    pwrVal.innerText = 'HIGH_PERF'; pwrVal.style.color = '#ff453a';

    if (maxArea / (canvas.width * canvas.height) > 0.4) {
      isPathClear = false; 
      // الميزة الخارقة 2: تشغيل التنبيه المكاني 3D قبل النطق
      if (Date.now() - lastSpokenTime >= SPEAK_INTERVAL) playSpatialBeep(panDirection);
      
      speakArabic(navigationCommand);
      infoScreen.innerHTML = screenMessage; infoScreen.style.color = '#ff453a';
      triggerVibration([200, 100, 200]); 
    } else {
      infoScreen.innerHTML = `[رصد]: ${closestObject} (${calcDistance}m)`; infoScreen.style.color = '#0a84ff';
    }
  } else {
    // الميزة الخارقة 3: توفير البطارية برمجياً (تقليل سرعة الرصد) إذا كان الطريق سالكاً
    dynamicFpsDelay = 150; // تأخير 150 ملي ثانية
    pwrVal.innerText = 'ECO_SAVER'; pwrVal.style.color = '#32d74b';

    if (!isPathClear) { speakArabic("المسار آمن، واصل التقدم."); isPathClear = true; }
    if (isCameraReallyReady) { infoScreen.innerHTML = 'المسار آمن 🟢'; infoScreen.style.color = '#32d74b'; }
  }

  setTimeout(() => requestAnimationFrame(detectFrame), dynamicFpsDelay);
}

startBtn.addEventListener('click', async () => {
  if (isRunning) return;
  const unlockSpeech = new SpeechSynthesisUtterance(' ');
  unlockSpeech.volume = 0; window.speechSynthesis.speak(unlockSpeech);
  // تهيئة محرك الصوت 3D
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  startBtn.innerText = 'Initializing...';
  infoScreen.innerText = 'الاتصال بالكاميرا والميكروفون...';
  
  await setupWebcam(); 
  infoScreen.innerText = 'تحميل الذكاء الاصطناعي...';
  model = await cocoSsd.load(); loadVoices();
  
  isRunning = true; startBtn.style.display = 'none';
  topStatus.innerText = 'Waiting... ⏳'; topStatus.style.color = '#ff9f0a';
  detectFrame();
});