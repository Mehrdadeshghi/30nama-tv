# Telewebion-Helfer für IRIB-Sender (Samsung)

Die IRIB-Sender (Shabake 1–5, Nasim, Ofogh, IRINN …) kommen außerhalb Irans nur über **Telewebion**.
Deren Wiedergabelisten enthalten eine 16-stellige Folgenummer (`EXT-X-MEDIA-SEQUENCE`). Der Samsung-Player
(AVPlay) speichert sie als 32-Bit-Zahl: Er zeigt ein Bild und bleibt dann stehen.

`worker.js` (von [shayanline/iptv-iran](https://github.com/shayanline/iptv-iran), MIT) läuft als kostenloser
Cloudflare Worker, schreibt nur die Wiedergabeliste um und lässt das Video direkt von Telewebion kommen.
Der Fernseher lädt die Liste etwa alle 10 Sekunden neu – das passt bequem in die kostenlosen 100.000 Anfragen pro Tag.

## Einrichten (einmalig, ca. 5 Minuten)

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker** → Name z. B. `iribtv` → **Deploy**.
2. **Edit code** → den ganzen Inhalt durch `worker.js` ersetzen → **Deploy**.
3. Test im Browser: `https://iribtv.<dein-name>.workers.dev/tv1/1080p` zeigt Text, der mit `#EXTM3U` beginnt.
4. Die Adresse (`https://iribtv.<dein-name>.workers.dev`) in `tizen-app/js/config.js` bei `liveProxy` eintragen
   und ein neues Release bauen.

IRIB TV3 und IRIB Varzesh sind von Telewebion selbst nur für iranische IP-Adressen freigegeben; daran ändert
auch der Helfer nichts.
