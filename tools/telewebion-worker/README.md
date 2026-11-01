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
3. Test im Browser: `https://iribtv.<dein-name>.workers.dev/tv1/1080p` zeigt Text, der mit `#EXTM3U` beginnt
   (Chrome bietet die Datei evtl. zum Download an – auch das heißt: läuft).
4. Die Adresse (`https://iribtv.<dein-name>.workers.dev`) in `tizen-app/js/config.js` bei `liveProxy` eintragen
   und ein neues Release bauen.

## IRIB TV3 und IRIB Varzesh

Telewebion liefert die Videostücke dieser beiden Sender nur an iranische IP-Adressen (HTTP 451; geprüft am 01.11.2026
von einem deutschen Anschluss aus, auch die `.net`-Server leiten auf gesperrte `.ir`-Server um). Mit einem eigenen
Server in Iran geht es trotzdem:

1. `iran-relay.nginx.conf` auf dem Server in Iran einrichten (Anleitung oben in der Datei).
2. In `worker.js` bei `IRAN_RELAY` die Adresse eintragen, z. B. `http://<server-ip>:8080/tw`, und den Worker neu deployen.

Dann holt nur für TV3 und Varzesh der Server in Iran die Videostücke (ca. 3–7 Mbit/s pro Fernseher); alle anderen
Sender laufen weiter direkt. Die Sperre hat Übertragungsrechte als Grund (vor allem Fußball) – das Umgehen kann gegen
die Nutzungsbedingungen von Telewebion verstoßen.

Ohne Server in Iran: **Telewebion Sport 1, 2 und 3** (Kategorie „ورزش“) laufen von Deutschland aus in 1080p.
