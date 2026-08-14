const CACHE_NAME = "yashwin-app-store-v1";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./calculator.html",
  "./app-details.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];


self.addEventListener("install", event => {

  event.waitUntil(

    caches.open(CACHE_NAME).then(cache => {

      return cache.addAll(FILES_TO_CACHE);

    })

  );

  self.skipWaiting();

});


self.addEventListener("activate", event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))

      );

    })

  );

  self.clients.claim();

});


self.addEventListener("fetch", event => {

  event.respondWith(

    caches.match(event.request).then(cached => {

      if (cached) {
        return cached;
      }

      return fetch(event.request).then(response => {

        if (
          !response ||
          response.status !== 200 ||
          response.type === "opaque"
        ) {
          return response;
        }

        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, copy);
        });

        return response;

      }).catch(() => {

        return caches.match("./index.html");

      });

    })

  );

});
