# iPhone and Mobile Testing

## Start a host-accessible server

Connect the Mac and iPhone to the same Wi-Fi, then run:

```bash
npm run game:dev
```

Vite binds to `0.0.0.0:5173`. The wrapper prints one or more local-network URLs,
for example:

```text
Mobile / LAN: http://10.0.0.189:5173
```

Open that exact URL in iPhone Safari or Chrome. `localhost` on the phone points
to the phone and will not reach the Mac.

## Find the Mac address manually

If no LAN URL prints:

```bash
ipconfig getifaddr en0
```

If the Mac uses another adapter, inspect **System Settings → Network → Wi-Fi →
Details** and use the IPv4 address. Open:

```text
http://<mac-ip>:5173
```

## Test checklist

- Portrait and landscape resizing
- No horizontal clipping on title or character selection
- Guest button and Deploy Droid respond to touch
- All four D-pad directions move the character
- ACT opens and advances Dr. Halogen dialogue
- BAG opens and closes inventory
- HUD text stays inside the viewport
- Dialogue remains readable above the bottom safe area
- Battle buttons fit and process a turn
- Rotating the device keeps the canvas responsive
- Backgrounding and returning does not corrupt the local save

The implementation uses `100dvh`, disables browser overscroll, requests
nearest-neighbor canvas rendering, and binds UI hitboxes to fixed camera space.

## Firewall and connection troubleshooting

- Allow Node/Vite through the macOS firewall when prompted.
- Disable VPNs, guest-network isolation, or iCloud Private Relay temporarily if
  local IP traffic is blocked.
- Confirm both devices are on the same SSID and subnet.
- Try the LAN URL from another desktop browser to distinguish a Mac firewall
  problem from an iPhone browser problem.
- Keep the Terminal process running; closing it stops Vite.
- Corporate and public Wi-Fi commonly blocks device-to-device traffic. Use a
  trusted home network or personal hotspot.

## Wallet expectations

Guest mode is the supported local mobile path. The standalone game intentionally
does not launch Privy or choose a wallet for the user. Real holder testing waits
for the approved host bridge so wallet choice and authentication remain owned by
the existing D.Y.O.O.R site.

## Device-emulated verification

The branch includes `apps/game/scripts/browser-smoke.ts` for the development
team. With the dev server and a Chrome DevTools endpoint running, it verifies a
390×844 viewport at device pixel ratio 3, captures title/select/world/dialogue/
battle states, checks guest and holder emission rates, exercises touch hitboxes,
and fails on browser errors. The captured battle frame also verifies the
high-detail player and Corrupted Scout pilot path. It is a supplement to—not a
replacement for—physical iPhone testing.
