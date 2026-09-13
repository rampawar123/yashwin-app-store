// ==========================================
// क्रिक युवा (Cric Yuva) - सर्विस वर्कर फिक्स
// फ़ाइल का नाम: sw.js (Cache Clear Engine)
// ==========================================

const CACHE_NAME = 'cric-yuva-v2'; // नया वर्जन ताकि पुराना अटका कोड हट जाए
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './phase-engine.js',
    './storage.js',
    './db.js',
    './cric-yuva-logo.png',
    './manifest.webmanifest'
];

// इंस्टॉल इवेंट - नए एसेट्स को स्टोर करना
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting()) // तुरंत नया कोड लागू करें
    );
});

// एक्टिवेट इवेंट - पुराने अटके हुए कैशे को पूरी तरह डिलीट करना
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log("पुराना खराब कैशे हटाया जा रहा है:", key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// फेच इवेंट - ऑफलाइन सपोर्ट के लिए
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
